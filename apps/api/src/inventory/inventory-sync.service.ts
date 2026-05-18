import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  LingxingApiError,
  LingxingNotConfiguredError,
} from '../lingxing/lingxing.types';
import { LingxingHttpService } from '../lingxing/lingxing-http.service';
import {
  RawLingxingInventoryItem,
  mapInventoryItem,
} from '../lingxing/mappers/inventory.mapper';
import { InventoryService } from './inventory.service';
import { WarehousesSyncService } from '../warehouses/warehouses-sync.service';
import { WarehousesService } from '../warehouses/warehouses.service';
import { SyncService } from '../sync/sync.service';
import { SyncRun } from '../sync/sync-run.entity';
import { coerceLingxingListTotal, estimateSyncTotalCount } from '../sync/sync-progress.util';

function unwrapInventoryPayload(
  data: RawLingxingInventoryItem[] | Record<string, unknown> | undefined,
): RawLingxingInventoryItem[] {
  if (!data) return [];
  if (Array.isArray(data)) return data;
  const o = data as Record<string, unknown>;
  const directKeys = [
    'list', 'items', 'rows', 'records',
    'detail_list', 'detailList',
    'inventory_list', 'inventoryList',
    'inventory_detail_list', 'inventoryDetailList',
    'datas',
  ];
  for (const k of directKeys) {
    const v = o[k];
    if (Array.isArray(v)) return v as RawLingxingInventoryItem[];
  }
  const nested = o.data;
  if (nested !== undefined && nested !== data)
    return unwrapInventoryPayload(nested as RawLingxingInventoryItem[] | Record<string, unknown> | undefined);
  for (const v of Object.values(o)) {
    if (!Array.isArray(v) || v.length === 0) continue;
    const first = v[0];
    if (first !== null && typeof first === 'object' && !Array.isArray(first)) {
      return v as RawLingxingInventoryItem[];
    }
  }
  return [];
}

function parseWarehouseNameMap(raw: string): Record<string, string> {
  const s = (raw ?? '').trim();
  if (!s) return {};
  if (s.startsWith('{')) {
    try {
      const obj = JSON.parse(s) as Record<string, unknown>;
      const out: Record<string, string> = {};
      for (const [k, v] of Object.entries(obj)) {
        const kk = String(k ?? '').trim();
        const vv = String(v ?? '').trim();
        if (kk && vv) out[kk] = vv;
      }
      return out;
    } catch {
      return {};
    }
  }
  const out: Record<string, string> = {};
  const pairs = s.split(/[;,]/).map((x) => x.trim()).filter(Boolean);
  for (const p of pairs) {
    const idx = p.indexOf('=');
    if (idx <= 0) continue;
    const k = p.slice(0, idx).trim();
    const v = p.slice(idx + 1).trim();
    if (k && v) out[k] = v;
  }
  return out;
}

@Injectable()
export class InventorySyncService {
  private readonly logger = new Logger(InventorySyncService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly http: LingxingHttpService,
    private readonly inventory: InventoryService,
    private readonly warehousesSync: WarehousesSyncService,
    private readonly warehouses: WarehousesService,
    private readonly sync: SyncService,
  ) {}

  /** 异步触发同步：创建 run 后立即返回，后台执行 */
  async triggerRun(triggeredBy?: string | null): Promise<SyncRun> {
    this.validateConfig();
    const run = await this.sync.start('INVENTORY', triggeredBy);
    this.executeRun(run).catch((err) => this.logger.error(`后台同步异常: ${err.message}`));
    return run;
  }

  private async executeRun(run: SyncRun): Promise<void> {
    const getCfg = (key: string): string => this.config.get<string>(key)?.trim() || process.env[key]?.trim() || '';
    const apiPath = getCfg('LINGXING_INVENTORY_PATH') || '/erp/sc/routing/data/local_inventory/inventoryDetails';
    const pageSize = Number(getCfg('LINGXING_INVENTORY_PAGE_SIZE') || '200');
    const widOverride = getCfg('LINGXING_INVENTORY_WID');
    const skuFilter = getCfg('LINGXING_INVENTORY_SKU');
    await this.warehousesSync.run('inventory-sync');
    const overseas = await this.warehouses.listOverseas(5000);
    const warehouseNameMap: Record<string, string> = {};
    for (const w of overseas) {
      warehouseNameMap[String(w.wid)] = String(w.name ?? '').trim();
    }

    const activeWids = await this.warehouses.listActiveWids(20000);
    const activeWidSet = new Set(activeWids.map((x) => String(x)));
    const resolvedWids = (() => {
      const raw = String(widOverride ?? '').trim();
      if (!raw) return activeWids.map((x) => String(x));
      const parts = raw.split(',').map((x) => x.trim()).filter(Boolean);
      const filtered = parts.filter((x) => activeWidSet.has(x));
      return filtered.length > 0 ? filtered : activeWids.map((x) => String(x));
    })();

    if (resolvedWids.length === 0) {
      await this.sync.finish(run, { status: 'SUCCESS', successCount: 0 });
      this.logger.warn('库存同步跳过：lingxing_warehouses 无可用 wid');
      return;
    }

    const wid = resolvedWids.join(',');
    this.logger.log(`库存同步开始: path=${apiPath}, widCount=${resolvedWids.length}`);
    const syncedAt = new Date();
    let offset = 0;
    let success = 0;
    let detailSkus: string[] = [];
    let totalEstimate = 0;
    let pinnedApiTotal: number | undefined;

    try {
      for (;;) {
        const res = await this.http.request<RawLingxingInventoryItem[] | { list?: RawLingxingInventoryItem[] }>({
          method: 'POST',
          path: apiPath,
          body: {
            wid,
            offset,
            length: pageSize,
            sku: skuFilter || undefined,
          },
        });
        const pageApiTotal = coerceLingxingListTotal(res, res.data);
        if (pageApiTotal !== undefined) pinnedApiTotal = pageApiTotal;

        const list = unwrapInventoryPayload(
          res.data as RawLingxingInventoryItem[] | Record<string, unknown> | undefined,
        );
        if (!list || list.length === 0) {
          if (offset === 0) {
            this.logger.warn('Inventory sync: first page returned no rows.');
          }
          break;
        }

        const normalized = list
          .map((raw) => mapInventoryItem(raw, warehouseNameMap))
          .filter((x): x is NonNullable<ReturnType<typeof mapInventoryItem>> => x !== null);

        if (normalized.length > 0) {
          success += await this.inventory.upsertMany(normalized, syncedAt);
          for (const item of normalized) {
            if (detailSkus.length < 5) detailSkus.push(item.sku);
          }
        }

        // 每页更新进度（totalCount 供前端百分比）
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
          this.logger.warn(`Inventory sync: too many pages, stopping at offset=${offset}`);
          break;
        }
      }
      await this.inventory.refreshWarehouseNamesFromLingxingOverseas();
      await this.sync.finish(run, { status: 'SUCCESS', successCount: success });
      this.logger.log(`库存同步完成: 成功 ${success} 条`);
    } catch (err) {
      const msg =
        err instanceof LingxingNotConfiguredError || err instanceof LingxingApiError
          ? err.message
          : (err as Error).message;
      this.logger.error(`Inventory sync failed: ${msg}`);
      await this.sync.finish(run, {
        status: 'FAILED',
        successCount: success,
        errorMessage: msg,
      });
    }
  }

  /** 同步入口（供定时任务等调用） */
  async run(triggeredBy?: string | null): Promise<SyncRun> {
    this.validateConfig();
    const run = await this.sync.start('INVENTORY', triggeredBy);
    await this.executeRun(run);
    return run;
  }

  private validateConfig(): void {
    const getCfg = (key: string): string => this.config.get<string>(key)?.trim() || process.env[key]?.trim() || '';
    const appId = getCfg('LINGXING_APP_ID');
    const appSecret = getCfg('LINGXING_APP_SECRET');
    if (!appId || !appSecret) {
      throw new ServiceUnavailableException(
        '领星 API 未配置（LINGXING_APP_ID / LINGXING_APP_SECRET 为空）。如需同步功能，请在 .env 中填入凭据后重启 API。',
      );
    }
    if (!this.http.isConfigured()) {
      throw new ServiceUnavailableException(
        '领星 API 未正确配置，无法同步。请检查 .env 中的 LINGXING_APP_ID 与 LINGXING_APP_SECRET 后重启 API。',
      );
    }
  }
}
