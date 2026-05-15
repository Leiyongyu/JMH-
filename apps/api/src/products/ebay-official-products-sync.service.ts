import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { EbayBrowseService } from '../ebay/ebay-browse.service';
import type { EbayMarketplaceId } from '../ebay/ebay.types';
import { SyncService } from '../sync/sync.service';
import type { SyncRun } from '../sync/sync-run.entity';
import { EbayProduct } from './ebay-product.entity';

type EbayItemJson = Record<string, unknown> & {
  legacyItemId?: unknown;
  title?: unknown;
  itemWebUrl?: unknown;
  shortDescription?: unknown;
  price?: unknown;
  condition?: unknown;
  conditionId?: unknown;
  brand?: unknown;
  gtin?: unknown;
  categoryPath?: unknown;
  categoryId?: unknown;
  seller?: unknown;
  localizedAspects?: unknown;
  description?: unknown;
};

@Injectable()
export class EbayOfficialProductsSyncService {
  private readonly logger = new Logger(EbayOfficialProductsSyncService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly sync: SyncService,
    private readonly ds: DataSource,
    private readonly browse: EbayBrowseService,
    @InjectRepository(EbayProduct) private readonly productRepo: Repository<EbayProduct>,
  ) {}

  private getCfg(key: string): string {
    return this.config.get<string>(key)?.trim() || process.env[key]?.trim() || '';
  }

  private validateConfig(): void {
    const id = this.getCfg('EBAY_CLIENT_ID');
    const secret = this.getCfg('EBAY_CLIENT_SECRET');
    if (!id || !secret) {
      throw new ServiceUnavailableException('eBay API 未配置（EBAY_CLIENT_ID / EBAY_CLIENT_SECRET 为空），请先在 .env 中填写并重启 API');
    }
  }

  async triggerRun(triggeredBy?: string | null, args?: { skus?: string[] | null }): Promise<SyncRun> {
    this.validateConfig();
    const run = await this.sync.start('EBAY_OFFICIAL_PRODUCT', triggeredBy);
    this.executeRun(run, args?.skus ?? null).catch((err) => this.logger.error(`后台同步异常: ${err.message}`));
    return run;
  }

  async run(triggeredBy?: string | null, args?: { skus?: string[] | null }): Promise<SyncRun> {
    this.validateConfig();
    const run = await this.sync.start('EBAY_OFFICIAL_PRODUCT', triggeredBy);
    await this.executeRun(run, args?.skus ?? null);
    return run;
  }

  private normalizeSkus(input: string[] | null): string[] {
    if (!input?.length) return [];
    const cleaned = input.map((s) => String(s ?? '').trim()).filter(Boolean);
    return Array.from(new Set(cleaned));
  }

  private async executeRun(run: SyncRun, skus: string[] | null): Promise<void> {
    let success = 0;
    let errors = 0;

    try {
      const products = await this.productRepo
        .createQueryBuilder('p')
        .select(['p.sku AS sku', 'p.itemUrl AS url'])
        .where('p.itemUrl IS NOT NULL')
        .andWhere('TRIM(p.itemUrl) <> \'\'')
        .orderBy('p.updatedAt', 'DESC')
        .getRawMany<{ sku: string; url: string }>();

      const skuFilter = this.normalizeSkus(skus);
      const skuSet = skuFilter.length ? new Set(skuFilter) : null;
      const pickedSource = skuSet ? products.filter((p) => skuSet.has(String(p.sku ?? '').trim())) : products;
      const limit = Number(this.getCfg('EBAY_OFFICIAL_SYNC_LIMIT') || '0');
      const picked = Number.isFinite(limit) && limit > 0 ? pickedSource.slice(0, limit) : pickedSource;
      const total = picked.length;
      await this.sync.updateProgress(run, { totalCount: total, processedCount: 0, successCount: 0, errorCount: 0 });
      if (total === 0) {
        await this.sync.finish(run, { status: 'SUCCESS', successCount: 0, errorCount: 0 });
        return;
      }

      const mainCols = await this.tableColumns('ebay_products_main');
      const detailCols = await this.tableColumns('ebay_product_details');
      const vehicleCols = await this.tableColumns('ebay_product_vehicles');

      const mainRows: Array<Record<string, unknown>> = [];
      const detailRows: Array<Record<string, unknown>> = [];
      const vehicleRows: Array<Record<string, unknown>> = [];
      const detailSkus: string[] = [];

      let processed = 0;
      for (const s of picked) {
        processed += 1;
        const url = String(s.url ?? '').trim();
        const sku = String(s.sku ?? '').trim();
        const legacyItemId = parseLegacyItemId(url);
        const marketplaceId = parseMarketplaceId(url);

        if (!sku || !url || !legacyItemId || !marketplaceId) {
          errors += 1;
          await this.sync.updateProgress(run, {
            processedCount: processed,
            successCount: success,
            errorCount: errors,
            detailSummary: sku ? `跳过 ${sku}` : undefined,
          });
          continue;
        }

        const item = await this.safeFetchItem({ legacyItemId, marketplaceId });
        if (!item) {
          errors += 1;
          await this.sync.updateProgress(run, {
            processedCount: processed,
            successCount: success,
            errorCount: errors,
            detailSummary: `下架/异常 ${sku}`,
          });
          continue;
        }

        const main = extractProductMain(item, { sku, itemWebUrlFromSource: url });
        if (!main.item_id || !main.title || main.price_value === null || !main.price_currency) {
          errors += 1;
          await this.sync.updateProgress(run, {
            processedCount: processed,
            successCount: success,
            errorCount: errors,
            detailSummary: `缺字段 ${sku}`,
          });
          continue;
        }

        mainRows.push(pickColumns(main as Record<string, unknown>, mainCols));
        for (const d of extractProductDetails(item, sku, main.item_id)) {
          detailRows.push(pickColumns(d as Record<string, unknown>, detailCols));
        }
        for (const v of extractVehicles(item, sku, main.item_id, vehicleCols)) {
          vehicleRows.push(pickColumns(v as Record<string, unknown>, vehicleCols));
        }

        success += 1;
        detailSkus.push(sku);
        if (detailSkus.length > 5) detailSkus.shift();

        if (processed % 10 === 0 || processed === total) {
          await this.sync.updateProgress(run, {
            processedCount: processed,
            successCount: success,
            errorCount: errors,
            detailSummary: detailSkus.join(', '),
          });
        }
      }

      await this.ds.transaction(async (manager) => {
        await manager.query('DELETE FROM ebay_product_details');
        await manager.query('DELETE FROM ebay_product_vehicles');
        await manager.query('DELETE FROM ebay_products_main');

        await bulkInsert(manager, 'ebay_products_main', mainRows);
        await bulkInsert(manager, 'ebay_product_details', detailRows);
        await bulkInsert(manager, 'ebay_product_vehicles', vehicleRows);
      });

      await this.sync.finish(run, { status: 'SUCCESS', successCount: success, errorCount: errors });
    } catch (err) {
      const msg = (err as Error).message;
      await this.sync.finish(run, { status: 'FAILED', successCount: success, errorCount: errors, errorMessage: msg });
    }
  }

  private async safeFetchItem(args: { legacyItemId: string; marketplaceId: EbayMarketplaceId }): Promise<EbayItemJson | null> {
    try {
      const data = (await this.browse.getItemByLegacyId(args)) as unknown as EbayItemJson;
      const id = toText(data.legacyItemId) ?? '';
      const title = toText(data.title) ?? '';
      if (!id || !title) return null;
      return data;
    } catch {
      return null;
    }
  }

  private async tableColumns(table: string): Promise<Set<string>> {
    const rows = await this.ds.query(
      `SELECT COLUMN_NAME AS name FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
      [table],
    );
    return new Set((rows as Array<{ name?: unknown }>).map((r) => String(r.name ?? '').trim()).filter(Boolean));
  }
}

function pickColumns(row: Record<string, unknown>, cols: Set<string>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(row)) {
    if (cols.has(k)) out[k] = row[k];
  }
  return out;
}

async function bulkInsert(
  manager: { query: (sql: string, params?: unknown[]) => Promise<unknown> },
  table: string,
  rows: Array<Record<string, unknown>>,
): Promise<void> {
  if (!rows.length) return;
  const chunkSize = 200;
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    const cols = Array.from(new Set(chunk.flatMap((r) => Object.keys(r)).filter((k) => k !== 'id'))).sort();
    if (!cols.length) return;

    const quotedCols = cols.map((c) => `\`${c}\``).join(', ');
    const rowPlaceholders = `(${cols.map(() => '?').join(', ')})`;
    const sql =
      `INSERT INTO \`${table}\` (${quotedCols}) VALUES ` +
      chunk.map(() => rowPlaceholders).join(', ');

    const params: unknown[] = [];
    for (const r of chunk) {
      for (const c of cols) params.push(r[c] === undefined ? null : r[c]);
    }
    await manager.query(sql, params);
  }
}

function toText(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s ? s : null;
}

function toNum(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === 'number' ? v : Number(String(v).replace(/,/g, '').trim());
  if (!Number.isFinite(n)) return null;
  return n;
}

function parseLegacyItemId(url: string): string | null {
  const s = String(url || '').trim();
  if (!s) return null;
  const m = s.match(/\/itm\/(\d{6,})(?:[/?]|$)/i);
  if (m?.[1]) return m[1];
  const m3 = s.match(/\/itm\/[^?]*?\/(\d{6,})(?:[/?]|$)/i);
  if (m3?.[1]) return m3[1];
  const m4 = s.match(/\/itm\/[^?]*?-(\d{6,})(?:[/?]|$)/i);
  if (m4?.[1]) return m4[1];
  const m5 = s.match(/\/(\d{6,})(?:[/?]|$)/i);
  if (m5?.[1]) return m5[1];
  const m2 = s.match(/[?&]item=(\d{6,})/i);
  if (m2?.[1]) return m2[1];
  return null;
}

function parseMarketplaceId(url: string): EbayMarketplaceId | null {
  const s = String(url || '').trim().toLowerCase();
  if (!s) return null;
  if (s.includes('ebay.de')) return 'EBAY_DE';
  if (s.includes('ebay.co.uk')) return 'EBAY_GB';
  if (s.includes('ebay.fr')) return 'EBAY_FR';
  if (s.includes('ebay.it')) return 'EBAY_IT';
  if (s.includes('ebay.es')) return 'EBAY_ES';
  if (s.includes('ebay.ca')) return 'EBAY_CA';
  if (s.includes('ebay.com.au')) return 'EBAY_AU';
  if (s.includes('ebay.com')) return 'EBAY_US';
  return null;
}

function extractProductMain(
  data: EbayItemJson,
  args: { sku: string; itemWebUrlFromSource: string },
): {
  sku: string;
  item_id: string | null;
  title: string | null;
  short_description: string | null;
  price_value: number | null;
  price_currency: string | null;
  condition: string | null;
  condition_id: string | null;
  brand: string | null;
  gtin: string | null;
  category_path: string | null;
  category_id: string | null;
  seller_username: string | null;
  seller_feedback_score: number | null;
  seller_feedback_percentage: string | null;
  seller_account_type: string | null;
  item_web_url: string | null;
  image_url: string | null;
  image_urls: string | null;
  item_creation_date: Date | null;
  raw_json: string | null;
} {
  const seller = (data.seller ?? {}) as Record<string, unknown>;
  const price = (data.price ?? {}) as Record<string, unknown>;
  const itemId = toText(data.legacyItemId) ?? toText((data as any).itemId);
  const rawJson = safeJsonStringify(data);
  const imageUrls = pickEbayImageUrls(data);
  const imageUrl = imageUrls[0] ?? pickEbayImageUrl(data);
  return {
    sku: args.sku,
    item_id: itemId,
    title: toText(data.title),
    short_description: toText(data.shortDescription),
    price_value: toNum(price.value),
    price_currency: toText(price.currency),
    condition: toText(data.condition),
    condition_id: toText((data as any).conditionId),
    brand: toText(data.brand),
    gtin: toText((data as any).gtin),
    category_path: toText((data as any).categoryPath),
    category_id: toText((data as any).categoryId),
    seller_username: toText((seller as any).username),
    seller_feedback_score: toNum((seller as any).feedbackScore),
    seller_feedback_percentage: toText((seller as any).feedbackPercentage),
    seller_account_type: toText((seller as any).accountType),
    item_web_url: toText((data as any).itemWebUrl) ?? toText(args.itemWebUrlFromSource),
    image_url: imageUrl,
    image_urls: imageUrls.length ? safeJsonStringify(imageUrls) : null,
    item_creation_date: toDate((data as any).itemCreationDate),
    raw_json: rawJson,
  };
}

function extractProductDetails(
  data: EbayItemJson,
  sku: string,
  itemId: string,
): Array<{ sku: string; item_id: string; aspect_name: string; aspect_value: string; aspect_type: string }> {
  const list = Array.isArray(data.localizedAspects) ? (data.localizedAspects as unknown[]) : [];
  const out: Array<{ sku: string; item_id: string; aspect_name: string; aspect_value: string; aspect_type: string }> =
    [];
  const existed = new Set<string>();
  for (const it of list) {
    const a = (it ?? {}) as Record<string, unknown>;
    const name = toText(a.name) ?? '';
    if (!name) continue;
    const key = name.toLowerCase();
    if (existed.has(key)) continue;
    const rawVal = (a as any).value;
    const value =
      rawVal === null || rawVal === undefined
        ? ''
        : Array.isArray(rawVal)
          ? rawVal.map((x) => String(x ?? '').trim()).filter(Boolean).join(', ')
          : String(rawVal).trim();
    if (!value) continue;
    existed.add(key);
    out.push({
      sku,
      item_id: itemId,
      aspect_name: name,
      aspect_value: value,
      aspect_type: toText((a as any).type) ?? 'STRING',
    });
  }
  return out;
}

function extractVehicles(
  data: EbayItemJson,
  sku: string,
  itemId: string,
  tableCols: Set<string>,
): Array<Record<string, unknown>> {
  const html = toText((data as any).description) ?? '';
  if (!html) return [];
  const rows = parseVehicleTable(html);
  if (!rows.length) return [];

  const colType = firstColumn(tableCols, ['vehicle_type', 'type', 'typ']);
  const colEngine = firstColumn(tableCols, ['engine', 'motor']);
  const colRestrictions = firstColumn(tableCols, [
    'restriction',
    'restrictions',
    'limit_desc',
    'einschraenkungen',
    'einsaenkungen',
  ]);

  return rows.map((r) => {
    const row: Record<string, unknown> = {
      sku,
      item_id: itemId,
      brand: r.brand,
      model: r.model,
      year_range: r.yearRange,
      platform: r.platform,
    };
    if (colType) row[colType] = r.type;
    if (colEngine) row[colEngine] = r.engine;
    if (colRestrictions) row[colRestrictions] = r.restrictions;
    return row;
  });
}

function firstColumn(cols: Set<string>, candidates: string[]): string | null {
  for (const c of candidates) {
    if (cols.has(c)) return c;
  }
  return null;
}

function parseVehicleTable(html: string): Array<{
  brand: string;
  model: string;
  yearRange: string | null;
  platform: string | null;
  type: string | null;
  engine: string | null;
  restrictions: string | null;
}> {
  const tables = Array.from(html.matchAll(/<table\b[\s\S]*?<\/table>/gi)).map((m) => m[0]);
  const target = tables.find((t) => looksLikeVehicleTable(t)) ?? '';
  if (!target) return [];
  const trs = Array.from(target.matchAll(/<tr\b[\s\S]*?<\/tr>/gi)).map((m) => m[0]);
  const rows: string[][] = trs.map((tr) => {
    const cells = Array.from(tr.matchAll(/<(td|th)\b[\s\S]*?<\/\1>/gi)).map((m) => m[0]);
    return cells.map((c) => normalizeCellText(c));
  });
  const body = rows.filter((r) => r.length >= 7);
  if (!body.length) return [];

  const head = body[0].map((x) => x.toLowerCase());
  const headLooksLike = head.some((x) => x.includes('marke') || x.includes('modell') || x.includes('baujahr'));
  const dataRows = headLooksLike ? body.slice(1) : body;

  const out: Array<{
    brand: string;
    model: string;
    yearRange: string | null;
    platform: string | null;
    type: string | null;
    engine: string | null;
    restrictions: string | null;
  }> = [];

  for (const r of dataRows) {
    const brand = String(r[0] ?? '').trim();
    const model = String(r[1] ?? '').trim();
    if (!brand || !model) continue;
    out.push({
      brand,
      model,
      yearRange: toText(r[2]),
      platform: toText(r[3]),
      type: toText(r[4]),
      engine: toText(r[5]),
      restrictions: toText(r[6]),
    });
  }
  return out;
}

function looksLikeVehicleTable(tableHtml: string): boolean {
  const text = normalizeCellText(tableHtml).toLowerCase();
  const hits = [
    'marke',
    'modell',
    'baujahr',
    'plattform',
    'typ',
    'motor',
    'einschränkungen',
    'einschrankungen',
  ].filter((k) => text.includes(k)).length;
  return hits >= 4;
}

function normalizeCellText(html: string): string {
  return decodeHtmlEntities(
    String(html || '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|tr|td|th)>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim(),
  );
}

function decodeHtmlEntities(s: string): string {
  return String(s || '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, '\'');
}

function safeJsonStringify(input: unknown): string | null {
  try {
    return JSON.stringify(input ?? null);
  } catch {
    return null;
  }
}

function toDate(v: unknown): Date | null {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return Number.isFinite(v.getTime()) ? v : null;
  const s = String(v).trim();
  if (!s) return null;
  const d = new Date(s);
  if (!Number.isFinite(d.getTime())) return null;
  return d;
}

function pickEbayImageUrl(data: EbayItemJson): string | null {
  const img = (data as any).image;
  if (img && typeof img === 'object') {
    const u = toText((img as any).imageUrl);
    if (u) return u;
  }
  const add = (data as any).additionalImages;
  if (Array.isArray(add)) {
    for (const it of add) {
      if (it && typeof it === 'object') {
        const u = toText((it as any).imageUrl);
        if (u) return u;
      }
    }
  }
  return null;
}

function pickEbayImageUrls(data: EbayItemJson): string[] {
  const urls: string[] = [];
  const add = (u: unknown) => {
    const s = toText(u);
    if (!s) return;
    if (urls.includes(s)) return;
    urls.push(s);
  };

  const img = (data as any).image;
  if (img && typeof img === 'object') add((img as any).imageUrl);

  const addImgs = (data as any).additionalImages;
  if (Array.isArray(addImgs)) {
    for (const it of addImgs) {
      if (it && typeof it === 'object') add((it as any).imageUrl);
      if (urls.length >= 24) break;
    }
  }

  return urls.slice(0, 24);
}
