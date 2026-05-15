import { BadGatewayException, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { LingxingHttpService } from '../lingxing/lingxing-http.service';
import {
  LingxingApiError,
  LingxingNotConfiguredError,
} from '../lingxing/lingxing.types';
import {
  RawLingxingEbayItem,
  mapEbayItem,
} from '../lingxing/mappers/ebay-product.mapper';
import { ProductsService } from './products.service';
import { SyncService } from '../sync/sync.service';
import { SyncRun } from '../sync/sync-run.entity';
import { coerceLingxingListTotal, estimateSyncTotalCount } from '../sync/sync-progress.util';
import ExcelJS from 'exceljs';
import { EbaySkuPriceSelection } from './ebay-sku-price-selection.entity';

@Injectable()
export class ProductsSyncService {
  private readonly logger = new Logger(ProductsSyncService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly http: LingxingHttpService,
    private readonly products: ProductsService,
    private readonly sync: SyncService,
    @InjectRepository(EbaySkuPriceSelection) private readonly selectionRepo: Repository<EbaySkuPriceSelection>,
  ) {}

  /** 异步触发同步：创建 run 后立即返回，后台执行 */
  async triggerRun(triggeredBy?: string | null): Promise<SyncRun> {
    this.validateConfig();
    const run = await this.sync.start('EBAY_PRODUCT', triggeredBy);
    this.executeRun(run).catch(() => {}); // fire-and-forget; error handled inside
    return run;
  }

  /** 仍在使用的同步入口（供定时任务等同步调用），验证并抛异常 */
  async run(triggeredBy?: string | null): Promise<SyncRun> {
    this.validateConfig();
    const run = await this.sync.start('EBAY_PRODUCT', triggeredBy);
    await this.executeRun(run);
    return run;
  }

  private validateConfig(): void {
    const getCfg = (key: string): string => this.config.get<string>(key)?.trim() || process.env[key]?.trim() || '';
    const appId = getCfg('LINGXING_APP_ID');
    const appSecret = getCfg('LINGXING_APP_SECRET');
    const sids = getCfg('LINGXING_EBAY_SIDS');
    if (!appId || !appSecret) {
      throw new ServiceUnavailableException(
        '领星 API 未配置（LINGXING_APP_ID / LINGXING_APP_SECRET 为空）。如需同步功能，请在 .env 中填入领星开放平台的凭据后重启 API。',
      );
    }
    if (!this.http.isConfigured()) {
      throw new ServiceUnavailableException(
        '领星 API 未正确配置，无法同步。请检查 .env 中的 LINGXING_APP_ID 与 LINGXING_APP_SECRET 后重启 API。',
      );
    }
    if (!sids) {
      throw new ServiceUnavailableException(
        'eBay 商品同步缺少店铺 ID（LINGXING_EBAY_SIDS）。请在 .env 中配置。',
      );
    }
  }

  private async executeRun(run: SyncRun): Promise<void> {
    const getCfg = (key: string): string => this.config.get<string>(key)?.trim() || process.env[key]?.trim() || '';
    // 与根目录 `get_ebay_products.py`、`get_stores.py` 对齐：basicOpen；旧版 routing 易导致领星返回「服务不存在」
    const path = getCfg('LINGXING_EBAY_PRODUCT_PATH') || '/basicOpen/multiplatform/ebay/list';
    const pageSize = Number(getCfg('LINGXING_EBAY_PAGE_SIZE') || '100');
    const sids = getCfg('LINGXING_EBAY_SIDS');
    const platformCodeSStr = getCfg('LINGXING_EBAY_PLATFORM_CODE_S');
    const mids = getCfg('LINGXING_EBAY_MIDS');
    let success = 0;
    let offset = 0;
    const syncedAt = new Date();
    const detailSkus: string[] = [];
    let totalEstimate = 0;
    let pinnedApiTotal: number | undefined;

    try {
      for (;;) {
        const body: Record<string, unknown> = {
          offset,
          length: pageSize,
          sids,
        };
        if (platformCodeSStr) {
          try { body.platformCodeS = JSON.parse(platformCodeSStr); } catch { /* ignore */ }
        }
        if (mids) {
          try { body.mids = JSON.parse(mids); } catch { /* ignore */ }
        }

        const res = await this.http.request<
          RawLingxingEbayItem[] | { list?: RawLingxingEbayItem[]; items?: RawLingxingEbayItem[] }
        >({
          method: 'POST',
          path,
          body,
        });
        const pageApiTotal = coerceLingxingListTotal(res, res.data);
        if (pageApiTotal !== undefined) pinnedApiTotal = pageApiTotal;

        const inner = res.data;
        const list: RawLingxingEbayItem[] = Array.isArray(inner)
          ? inner
          : inner?.list ?? inner?.items ?? [];

        /** 仅拉取在售：下架行不入库；同步完成后把本次未更新到的历史 ACTIVE 统一降为 INACTIVE */
        const normalized = list
          .map((raw) => mapEbayItem(raw))
          .filter((x): x is NonNullable<ReturnType<typeof mapEbayItem>> => x !== null)
          .filter((x) => (x.status ?? '').toUpperCase() === 'ACTIVE');

        if (normalized.length > 0) {
          const upserted = await this.products.upsertMany(normalized, syncedAt, { updatePrice: true });
          success += upserted;
          for (const item of normalized) {
            if (detailSkus.length < 5) detailSkus.push(item.sku);
          }
        }

        const processed = offset + list.length;
        totalEstimate = estimateSyncTotalCount({
          apiTotal: pinnedApiTotal,
          processed,
          pageSize,
          lastPageRows: list.length,
          previousEstimate: totalEstimate,
        });
        const detailSummary = detailSkus.length > 0 ? `最近: ${detailSkus.join(', ')}${detailSkus.length >= 5 ? '…' : ''}` : undefined;
        await this.sync.updateProgress(run, {
          processedCount: processed,
          totalCount: Math.max(totalEstimate, processed),
          successCount: success,
          errorCount: 0,
          detailSummary,
        });

        if (list.length < pageSize) break;
        offset += pageSize;
        if (offset > 100_000) {
          this.logger.warn(`Ebay product sync: too many pages, stopping at offset=${offset}`);
          break;
        }
      }
      await this.products.markNotSyncedAsInactive(syncedAt);
      await this.sync.finish(run, { status: 'SUCCESS', successCount: success });
      this.logger.log(`eBay同步完成: 成功 ${success} 条`);
    } catch (err) {
      const msg =
        err instanceof LingxingNotConfiguredError || err instanceof LingxingApiError
          ? err.message
          : (err as Error).message;
      this.logger.error(`Ebay product sync failed: ${msg}`);
      await this.sync.finish(run, {
        status: 'FAILED',
        successCount: success,
        errorMessage: msg,
      });
    }
  }

  private normalizeSku(input: unknown): string {
    return String(input ?? '').trim();
  }

  private coercePrice(input: unknown): string | null {
    if (input === null || input === undefined) return null;
    if (typeof input === 'number' && Number.isFinite(input)) return input.toFixed(2);
    const s = String(input).trim();
    if (!s) return null;
    const n = Number(s.replace(/,/g, ''));
    if (!Number.isFinite(n)) return null;
    return n.toFixed(2);
  }

  /**
   * 上传 SKU+价格 Excel 后：
   * 1) 从领星拉取指定 SKU 商品信息
   * 2) 用 Excel 价格覆盖
   * 3) 只保留这些 SKU 为 ACTIVE（其他 SKU 置为 INACTIVE）
   */
  async importSkuPriceXlsx(
    buf: Buffer,
    triggeredBy?: string | null,
  ): Promise<{
    totalRows: number;
    updated: number;
    notFound: number;
    invalid: number;
    details: Array<{ row: number; sku?: string; status: string; message?: string }>;
    skus: string[];
  }> {
    const wb = new ExcelJS.Workbook();
    await (wb.xlsx as unknown as { load: (data: unknown) => Promise<unknown> }).load(buf);
    const ws = wb.worksheets[0];
    if (!ws) {
      return {
        totalRows: 0,
        updated: 0,
        notFound: 0,
        invalid: 0,
        details: [{ row: 0, status: 'INVALID', message: 'Excel 无工作表' }],
        skus: [],
      };
    }

    const headerRow = ws.getRow(1);
    const headerValues = (headerRow.values as Array<string | number | null | undefined>)
      .slice(1)
      .map((v) => String(v ?? '').trim().toLowerCase());

    const headerIndex = (aliases: string[]) => {
      for (const a of aliases) {
        const i = headerValues.findIndex((h) => h === a.toLowerCase());
        if (i >= 0) return i + 1;
      }
      return -1;
    };

    const colSku = headerIndex(['sku']);
    const colPrice = headerIndex(['price', '价格', '售价', '销售价']);

    const hasHeader = colSku > 0 && colPrice > 0;
    const skuCol = hasHeader ? colSku : 1;
    const priceCol = hasHeader ? colPrice : 2;
    const startRow = hasHeader ? 2 : 1;

    let totalRows = 0;
    let invalid = 0;
    const details: Array<{ row: number; sku?: string; status: string; message?: string }> = [];
    const priceMap = new Map<string, string>();

    for (let r = startRow; r <= ws.rowCount; r++) {
      const row = ws.getRow(r);
      const sku = this.normalizeSku(row.getCell(skuCol).value as unknown as string);
      const price = this.coercePrice(row.getCell(priceCol).value);
      const isEmptyRow = !sku && !price;
      if (isEmptyRow) continue;
      totalRows += 1;
      if (!sku || !price) {
        invalid += 1;
        details.push({ row: r, sku: sku || undefined, status: 'INVALID', message: '缺少 SKU 或 价格' });
        continue;
      }
      priceMap.set(sku, price);
    }

    const skus = Array.from(priceMap.keys());
    if (skus.length === 0) {
      return {
        totalRows,
        updated: 0,
        notFound: 0,
        invalid,
        details,
        skus: [],
      };
    }

    await this.upsertSelections(priceMap);
    const result = await this.products.applySkuPricesFromSelection(priceMap);
    return {
      totalRows,
      updated: result.updated,
      notFound: result.notFound,
      invalid,
      details: details.concat(result.notFoundSkus.map((sku) => ({ row: 0, sku, status: 'NOT_FOUND', message: '本地商品库未找到该 SKU（请先同步 eBay 商品）' }))),
      skus,
    };
  }

  private async upsertSelections(priceMap: Map<string, string>): Promise<void> {
    const rows = Array.from(priceMap.entries()).map(([sku, price]) => ({ sku, price } as const));
    if (rows.length === 0) return;
    const qb = this.selectionRepo
      .createQueryBuilder()
      .insert()
      .into(EbaySkuPriceSelection)
      .values(rows as unknown as Array<Record<string, unknown>>)
      .orUpdate(['price', 'updated_at'], ['sku']);
    await qb.execute();
  }
}
