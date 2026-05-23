import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';
import { EbayProduct } from './ebay-product.entity';
import { EbaySkuPriceSelection } from './ebay-sku-price-selection.entity';
import { SyncService } from '../sync/sync.service';
import { UpdateEbayProductDto } from '../admin/dto/update-ebay-product.dto';
import { EbayItemPageService } from './scrape/ebay-item-page.service';
import { EbayBrowseService } from '../ebay/ebay-browse.service';
import { EbayUrlTestService } from '../ebay/ebay-url-test.service';
import { EbayTestCacheService } from '../ebay/ebay-test-cache.service';
import { extractLegacyItemIdFromItemUrl, marketplaceIdFromUrl } from '../ebay/ebay.util';
import ExcelJS from 'exceljs';
import { InventoryLine } from '../inventory/inventory-line.entity';
import { JwtUser } from '../common/current-user.decorator';
import { AccessControlService } from '../access/access-control.service';

export interface ProductListQuery {
  keyword?: string;
  sortBy?: 'stockQty' | 'price' | 'sku' | 'syncedAt';
  sortOrder?: 'ASC' | 'DESC';
  page?: number;
  pageSize?: number;
}

@Injectable()
export class ProductsService {
  private mainImageColCache: { at: number; value: boolean } | null = null;
  private mainImageUrlsColCache: { at: number; value: boolean } | null = null;

  constructor(
    @InjectRepository(EbayProduct) private readonly repo: Repository<EbayProduct>,
    @InjectRepository(EbaySkuPriceSelection) private readonly selectionRepo: Repository<EbaySkuPriceSelection>,
    @InjectRepository(InventoryLine) private readonly invRepo: Repository<InventoryLine>,
    private readonly ds: DataSource,
    private readonly sync: SyncService,
    private readonly ebayPage: EbayItemPageService,
    private readonly ebayBrowse: EbayBrowseService,
    private readonly ebayUrlTest: EbayUrlTestService,
    private readonly ebayTestCache: EbayTestCacheService,
    private readonly access: AccessControlService,
  ) {}

  private async hasMainImageCol(): Promise<boolean> {
    const now = Date.now();
    if (this.mainImageColCache && now - this.mainImageColCache.at < 60_000) return this.mainImageColCache.value;
    const rows = await this.ds.query(
      `SELECT 1 AS one FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='ebay_products_main' AND COLUMN_NAME='image_url' LIMIT 1`,
    );
    const value = Boolean(rows?.[0]?.one);
    this.mainImageColCache = { at: now, value };
    return value;
  }

  private async hasMainImageUrlsCol(): Promise<boolean> {
    const now = Date.now();
    if (this.mainImageUrlsColCache && now - this.mainImageUrlsColCache.at < 60_000) return this.mainImageUrlsColCache.value;
    const rows = await this.ds.query(
      `SELECT 1 AS one FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='ebay_products_main' AND COLUMN_NAME='image_urls' LIMIT 1`,
    );
    const value = Boolean(rows?.[0]?.one);
    this.mainImageUrlsColCache = { at: now, value };
    return value;
  }

  private coerceJsonObject(input: unknown): Record<string, unknown> | null {
    if (input === null || input === undefined) return null;
    if (typeof input === 'object') return input as Record<string, unknown>;
    if (typeof input === 'string') {
      const s = input.trim();
      if (!s) return null;
      try {
        const v = JSON.parse(s);
        if (v && typeof v === 'object') return v as Record<string, unknown>;
        return null;
      } catch {
        return null;
      }
    }
    return null;
  }

  private coerceJsonArray(input: unknown): unknown[] | null {
    if (input === null || input === undefined) return null;
    if (Array.isArray(input)) return input;
    if (typeof input === 'string') {
      const s = input.trim();
      if (!s) return null;
      try {
        const v = JSON.parse(s);
        if (Array.isArray(v)) return v;
        return null;
      } catch {
        return null;
      }
    }
    return null;
  }

  async list(q: ProductListQuery, user: JwtUser) {
    const page = Math.max(1, Number(q.page ?? 1));
    const pageSize = Math.min(100, Math.max(1, Number(q.pageSize ?? 20)));
    const kw = q.keyword?.trim();
    const kwNorm = kw ? kw.trim().toLowerCase() : '';
    const order = String(q.sortOrder ?? 'DESC').toUpperCase() === 'ASC' ? 'ASC' : 'DESC';
    const sortBy = q.sortBy ?? 'stockQty';
    const whereParts: string[] = [];
    const whereParams: unknown[] = [];
    if (user.role !== 'ADMIN') {
      const groupIds = await this.access.getUserGroupIds(user.sub);
      if (groupIds.length > 0) {
        whereParts.push(`(
          NOT EXISTS (SELECT 1 FROM ebay_product_visibility_groups pvg WHERE pvg.product_id = p.id)
          OR EXISTS (SELECT 1 FROM ebay_product_visibility_groups pvg2 WHERE pvg2.product_id = p.id AND pvg2.group_id IN (?))
        )`);
        whereParams.push(groupIds);
      } else {
        whereParts.push(`(
          NOT EXISTS (SELECT 1 FROM ebay_product_visibility_groups pvg WHERE pvg.product_id = p.id)
        )`);
      }
    }
    if (kw) {
      whereParts.push(`(
        (p.sku_norm COLLATE utf8mb4_unicode_ci) LIKE (? COLLATE utf8mb4_unicode_ci)
        OR LOWER(COALESCE(p.title, '')) LIKE LOWER(?)
      )`);
      whereParams.push(`%${kwNorm}%`, `%${kw}%`);
    }
    const whereSql = whereParts.length ? `WHERE ${whereParts.join(' AND ')}` : '';

    const sortableMap: Record<string, string> = {
      stockQty: 'COALESCE(inv.availableQty, 0)',
      price: 'CAST(COALESCE(s.price, 0) AS DECIMAL(14,2))',
      sku: 'p.sku',
      syncedAt: 'COALESCE(p.updated_at, p.synced_at)',
    };
    const sortable = sortableMap[String(sortBy)] ?? sortableMap.stockQty;
    const orderSql = `${sortable} ${order}, p.sku ASC`;

    const totalRow = await this.ds.query(
      `
      SELECT COUNT(1) AS c
      FROM (
        SELECT
          SUBSTRING_INDEX(LOWER(TRIM(sku)), '-', 2) AS prefix_norm,
          MAX(COALESCE(price, 0)) AS price
        FROM ebay_sku_price_selections
        GROUP BY SUBSTRING_INDEX(LOWER(TRIM(sku)), '-', 2)
      ) s
      INNER JOIN (
        SELECT *
        FROM (
          SELECT
            p.*,
            LOWER(TRIM(p.sku)) AS sku_norm,
            SUBSTRING_INDEX(LOWER(TRIM(p.sku)), '-', 2) AS prefix_norm,
            ROW_NUMBER() OVER (PARTITION BY LOWER(TRIM(p.sku)) ORDER BY p.updated_at DESC, p.created_at DESC) AS rn
          FROM ebay_products p
        ) t
        WHERE t.rn = 1
      ) p
        ON p.prefix_norm COLLATE utf8mb4_unicode_ci = (s.prefix_norm COLLATE utf8mb4_unicode_ci)
      ${whereSql}
      `,
      whereParams,
    );
    const total = Number(totalRow?.[0]?.c ?? 0);

    const offset = (page - 1) * pageSize;
    const rows = (await this.ds.query(
      `
      SELECT
        p.id AS id,
        TRIM(p.sku) AS sku,
        p.title AS title,
        COALESCE(p.item_url, '') AS itemUrl,
        COALESCE(p.status, 'ACTIVE') AS status,
        p.raw_payload AS rawPayload,
        CAST(COALESCE(p.price, 0) AS CHAR) AS price,
        COALESCE(NULLIF(TRIM(p.currency), ''), 'USD') AS currency,
        CAST(COALESCE(s.price, 0) AS CHAR) AS rmbPrice,
        COALESCE(inv.availableQty, 0) AS stockQty,
        COALESCE(p.updated_at, p.synced_at) AS syncedAt
      FROM (
        SELECT
          SUBSTRING_INDEX(LOWER(TRIM(sku)), '-', 2) AS prefix_norm,
          MAX(COALESCE(price, 0)) AS price
        FROM ebay_sku_price_selections
        GROUP BY SUBSTRING_INDEX(LOWER(TRIM(sku)), '-', 2)
      ) s
      INNER JOIN (
        SELECT *
        FROM (
          SELECT
            p.*,
            LOWER(TRIM(p.sku)) AS sku_norm,
            SUBSTRING_INDEX(LOWER(TRIM(p.sku)), '-', 2) AS prefix_norm,
            ROW_NUMBER() OVER (PARTITION BY LOWER(TRIM(p.sku)) ORDER BY p.updated_at DESC, p.created_at DESC) AS rn
          FROM ebay_products p
        ) t
        WHERE t.rn = 1
      ) p
        ON p.prefix_norm COLLATE utf8mb4_unicode_ci = (s.prefix_norm COLLATE utf8mb4_unicode_ci)
      LEFT JOIN (
        SELECT sku, SUM(available_qty) AS availableQty
        FROM inventory_lines
        WHERE platform='LINGXING'
          AND warehouse_name IS NOT NULL
          AND TRIM(warehouse_name) <> ''
        GROUP BY sku
      ) inv
        ON (LOWER(TRIM(inv.sku)) COLLATE utf8mb4_unicode_ci) = (p.sku_norm COLLATE utf8mb4_unicode_ci)
      ${whereSql}
      ORDER BY ${orderSql}
      LIMIT ? OFFSET ?
      `,
      whereParams.concat([pageSize, offset]),
    )) as any[];

    const items = rows.map((r) => {
      const syncedAt = (r as { syncedAt?: unknown })?.syncedAt;
      const normalizedSyncedAt =
        syncedAt instanceof Date
          ? syncedAt.toISOString()
          : typeof syncedAt === 'string'
            ? syncedAt
            : syncedAt === null || syncedAt === undefined
              ? new Date(0).toISOString()
              : String(syncedAt);

      const rawObj = this.coerceJsonObject((r as any).rawPayload) ?? null;
      const mergedRaw = rawObj ? { ...rawObj } : {};
      const stockQty = Number((r as any).stockQty ?? 0);

      return {
        id: String((r as any).id ?? ''),
        sku: String((r as any).sku ?? ''),
        title: (r as any).title === null || (r as any).title === undefined ? null : String((r as any).title),
        stockQty,
        availableQty: stockQty,
        price: String((r as any).price ?? '0'),
        currency: String((r as any).currency ?? 'USD'),
        rmbPrice: (r as any).rmbPrice === null || (r as any).rmbPrice === undefined ? null : String((r as any).rmbPrice),
        itemUrl: (r as any).itemUrl === null || (r as any).itemUrl === undefined ? null : String((r as any).itemUrl),
        syncedAt: normalizedSyncedAt,
        status: (r as any).status === null || (r as any).status === undefined ? 'ACTIVE' : String((r as any).status),
        rawPayload: Object.keys(mergedRaw).length ? mergedRaw : null,
      } as unknown as EbayProduct & { availableQty?: number | null };
    });

    let lastSyncedAt = await this.sync.lastSuccessAt('EBAY_PRODUCT');
    if (!lastSyncedAt) {
      const raw = await this.repo
        .createQueryBuilder('p')
        .select('MAX(p.syncedAt)', 'max')
        .getRawOne<{ max?: string | Date | null }>();
      const max = raw?.max ?? null;
      if (max instanceof Date) lastSyncedAt = max;
      else if (typeof max === 'string' && max.trim()) {
        const d = new Date(max);
        if (!Number.isNaN(d.getTime())) lastSyncedAt = d;
      }
    }
    return { items, total, page, pageSize, lastSyncedAt };
  }

  private pickImageUrlsFromRaw(raw: Record<string, unknown>): string[] {
    const urls: string[] = [];
    const add = (u: unknown) => {
      if (typeof u === 'string' && u.trim()) urls.push(u.trim());
    };

    add(raw.picture_url);
    add(raw.pictureUrl);
    add(raw.main_image);
    add(raw.mainImage);
    if (raw.image && typeof raw.image === 'object') {
      add((raw.image as Record<string, unknown>).imageUrl);
    } else {
      add(raw.image);
    }
    add(raw.image_url);
    add(raw.imageUrl);

    const arrays = [raw.picture_urls, raw.pictureUrls, raw.images, raw.image_urls, raw.imageUrls, raw.image_list, raw.imageList, raw.gallery, raw.galleryUrls];
    for (const arr of arrays) {
      if (Array.isArray(arr)) {
        for (const it of arr) add(it);
      }
    }
    if (Array.isArray(raw.additionalImages)) {
      for (const it of raw.additionalImages) {
        if (it && typeof it === 'object') add((it as Record<string, unknown>).imageUrl);
      }
    }

    return Array.from(new Set(urls)).slice(0, 24);
  }

  async getEbayBySku(sku: string): Promise<EbayProduct & { availableQty?: number | null }> {
    const skuNorm = String(sku ?? '').trim().toLowerCase();
    if (!skuNorm) throw new NotFoundException('商品不存在');

    const rows = (await this.ds.query(
      `
      SELECT
        p.id AS id,
        TRIM(p.sku) AS sku,
        p.title AS title,
        COALESCE(p.item_url, '') AS itemUrl,
        COALESCE(p.status, 'ACTIVE') AS status,
        p.raw_payload AS rawPayload,
        CAST(COALESCE(p.price, 0) AS CHAR) AS price,
        COALESCE(NULLIF(TRIM(p.currency), ''), 'USD') AS currency,
        CAST(COALESCE(s.price, 0) AS CHAR) AS rmbPrice,
        COALESCE(inv.availableQty, 0) AS stockQty,
        COALESCE(p.updated_at, p.synced_at) AS syncedAt
      FROM ebay_products p
      INNER JOIN (
        SELECT
          SUBSTRING_INDEX(LOWER(TRIM(sku)), '-', 2) AS prefix_norm,
          MAX(COALESCE(price, 0)) AS price
        FROM ebay_sku_price_selections
        GROUP BY SUBSTRING_INDEX(LOWER(TRIM(sku)), '-', 2)
      ) s
        ON (SUBSTRING_INDEX(LOWER(TRIM(p.sku)), '-', 2) COLLATE utf8mb4_unicode_ci) = (s.prefix_norm COLLATE utf8mb4_unicode_ci)
      LEFT JOIN (
        SELECT sku, SUM(available_qty) AS availableQty
        FROM inventory_lines
        WHERE platform='LINGXING'
          AND warehouse_name IS NOT NULL
          AND TRIM(warehouse_name) <> ''
        GROUP BY sku
      ) inv
        ON (LOWER(TRIM(inv.sku)) COLLATE utf8mb4_unicode_ci) = (LOWER(TRIM(p.sku)) COLLATE utf8mb4_unicode_ci)
      WHERE (LOWER(TRIM(p.sku)) COLLATE utf8mb4_unicode_ci) = (? COLLATE utf8mb4_unicode_ci)
      ORDER BY p.updated_at DESC, p.created_at DESC
      `,
      [skuNorm],
    )) as any[];

    if (!rows.length) throw new NotFoundException('商品不存在');

    const base = rows[0];
    const rawObjs = rows
      .map((r) => this.coerceJsonObject((r as any).rawPayload))
      .filter((x): x is Record<string, unknown> => Boolean(x));

    const mergedRaw: Record<string, unknown> = rawObjs[0] ? { ...rawObjs[0] } : {};
    const imageUrls = Array.from(new Set(rawObjs.flatMap((x) => this.pickImageUrlsFromRaw(x)))).slice(0, 24);
    if (imageUrls.length) {
      if (mergedRaw.images === undefined) mergedRaw.images = imageUrls;
      if (mergedRaw.picture_urls === undefined) mergedRaw.picture_urls = imageUrls;
      if (mergedRaw.image_urls === undefined) mergedRaw.image_urls = imageUrls;
      if (mergedRaw.imageUrl === undefined) mergedRaw.imageUrl = imageUrls[0];
      if (mergedRaw.image_url === undefined) mergedRaw.image_url = imageUrls[0];
    }

    const syncedAt = (base as { syncedAt?: unknown })?.syncedAt;
    const normalizedSyncedAt =
      syncedAt instanceof Date
        ? syncedAt.toISOString()
        : typeof syncedAt === 'string'
          ? syncedAt
          : syncedAt === null || syncedAt === undefined
            ? new Date(0).toISOString()
            : String(syncedAt);

    const stockQty = Number((base as any).stockQty ?? 0);
    return {
      id: String((base as any).id ?? ''),
      sku: String((base as any).sku ?? ''),
      title: (base as any).title === null || (base as any).title === undefined ? null : String((base as any).title),
      stockQty,
      availableQty: stockQty,
      price: String((base as any).price ?? '0'),
      currency: String((base as any).currency ?? 'USD'),
      rmbPrice: (base as any).rmbPrice === null || (base as any).rmbPrice === undefined ? null : String((base as any).rmbPrice),
      itemUrl: (base as any).itemUrl === null || (base as any).itemUrl === undefined ? null : String((base as any).itemUrl),
      syncedAt: normalizedSyncedAt,
      status: (base as any).status === null || (base as any).status === undefined ? 'ACTIVE' : String((base as any).status),
      rawPayload: Object.keys(mergedRaw).length ? mergedRaw : null,
    } as unknown as EbayProduct & { availableQty?: number | null };
  }

  private async ebayItemUrlBySku(sku: string): Promise<string> {
    const skuNorm = String(sku ?? '').trim().toLowerCase();
    if (!skuNorm) throw new NotFoundException('商品不存在');

    const rows = (await this.ds.query(
      `
      SELECT
        COALESCE(NULLIF(TRIM(p.item_url), ''), '') AS itemUrl
      FROM ebay_products p
      INNER JOIN (
        SELECT
          SUBSTRING_INDEX(LOWER(TRIM(sku)), '-', 2) AS prefix_norm,
          MAX(COALESCE(price, 0)) AS price
        FROM ebay_sku_price_selections
        GROUP BY SUBSTRING_INDEX(LOWER(TRIM(sku)), '-', 2)
      ) s
        ON (SUBSTRING_INDEX(LOWER(TRIM(p.sku)), '-', 2) COLLATE utf8mb4_unicode_ci) = (s.prefix_norm COLLATE utf8mb4_unicode_ci)
      WHERE (LOWER(TRIM(p.sku)) COLLATE utf8mb4_unicode_ci) = (? COLLATE utf8mb4_unicode_ci)
      ORDER BY p.updated_at DESC, p.created_at DESC
      `,
      [skuNorm],
    )) as Array<{ itemUrl?: string | null }>;

    for (const r of rows) {
      const itemUrl = String(r?.itemUrl ?? '').trim();
      if (!itemUrl) continue;
      return itemUrl;
    }

    throw new NotFoundException('该商品未找到可用的 item_url');
  }

  private async refreshBrowseFromEbay(args: { sku: string; timeoutMs?: number }) {
    const sku = String(args.sku ?? '').trim();
    const itemUrl = await this.ebayItemUrlBySku(sku);
    const res = await this.ebayUrlTest.browseByUrl(itemUrl, { timeoutMs: args.timeoutMs });
    await this.ebayTestCache.saveBrowse({
      sku,
      itemId: res.itemId ?? null,
      marketplaceId: res.marketplaceId,
      itemWebUrl: res.basic?.itemWebUrl ?? null,
      title: res.basic?.title ?? null,
      priceValue: res.basic?.priceValue ?? null,
      priceCurrency: res.basic?.priceCurrency ?? null,
      condition: res.basic?.condition ?? null,
      sellerUsername: res.basic?.sellerUsername ?? null,
      availabilityStatus: res.basic?.availabilityStatus ?? null,
      specifics: res.specifics ?? [],
      raw: res,
    });
    return res;
  }

  private async refreshFitmentFromEbay(args: { sku: string; timeoutMs?: number; lite?: boolean }) {
    const sku = String(args.sku ?? '').trim();
    const itemUrl = await this.ebayItemUrlBySku(sku);
    const res = await this.ebayUrlTest.tradingFitmentByUrl(itemUrl, { timeoutMs: args.timeoutMs, lite: args.lite });
    await this.ebayTestCache.saveTrading({
      sku,
      itemId: res.itemId ?? null,
      siteId: res.siteId ?? null,
      totalCount: res.vehicles?.totalCount ?? 0,
      vehicles: res.vehicles?.items ?? [],
      rawSample: res.vehicles?.rawSample ?? [],
      specifics: res.specifics ?? [],
    });
    return res;
  }

  async getEbayOfficialLiveBrowseBySku(args: { sku: string; timeoutMs?: number; refreshMode?: 'background' | null }) {
    const sku = String(args.sku ?? '').trim();
    const cached = await this.ebayTestCache.getBrowseBySku(sku);
    if (cached) {
      if (args.refreshMode === 'background') {
        void this.refreshBrowseFromEbay({ sku, timeoutMs: args.timeoutMs }).catch(() => undefined);
      }
      return {
        url: cached.basic.itemWebUrl ?? '',
        itemId: cached.itemId ?? '',
        marketplaceId: cached.marketplaceId,
        basic: cached.basic,
        specifics: cached.specifics,
        cached: true,
        refreshQueued: args.refreshMode === 'background',
      };
    }

    const res = await this.refreshBrowseFromEbay({ sku, timeoutMs: args.timeoutMs });
    return { ...res, cached: false, refreshQueued: false };
  }

  async getEbayOfficialLiveFitmentBySku(args: { sku: string; timeoutMs?: number; lite?: boolean; refreshMode?: 'background' | null }) {
    const sku = String(args.sku ?? '').trim();
    const cached = await this.ebayTestCache.getTradingBySku(sku);
    if (cached) {
      if (args.refreshMode === 'background') {
        void this.refreshFitmentFromEbay({ sku, timeoutMs: args.timeoutMs, lite: args.lite }).catch(() => undefined);
      }
      return {
        url: '',
        itemId: cached.itemId ?? '',
        siteId: cached.siteId ?? '',
        vehicles: cached.vehicles,
        specifics: cached.specifics,
        vehiclesError: null,
        cached: true,
        refreshQueued: args.refreshMode === 'background',
      };
    }

    try {
      const res = await this.refreshFitmentFromEbay({ sku, timeoutMs: args.timeoutMs, lite: args.lite });
      return { ...res, vehiclesError: null, cached: false, refreshQueued: false };
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { message?: string } } })?.response?.data?.message ??
        (err as { message?: string })?.message ??
        'Trading API 失败';
      return {
        url: '',
        itemId: '',
        siteId: '',
        vehicles: { totalCount: 0, items: [], rawSample: [] as Array<Record<string, string>> },
        specifics: [],
        vehiclesError: String(msg),
        cached: false,
        refreshQueued: false,
      };
    }
  }

  async getEbayOfficialLiveBySku(sku: string) {
    const [browseRes, fitmentRes] = await Promise.allSettled([
      this.getEbayOfficialLiveBrowseBySku({ sku }),
      this.getEbayOfficialLiveFitmentBySku({ sku, lite: true }),
    ]);

    const browse = browseRes.status === 'fulfilled' ? browseRes.value : null;
    const fitment = fitmentRes.status === 'fulfilled' ? fitmentRes.value : null;
    const vehiclesError =
      fitment && (fitment as any)?.vehiclesError ? String((fitment as any).vehiclesError) : fitmentRes.status === 'rejected' ? '适配车型加载失败' : null;

    if (!browse && !fitment) {
      throw new NotFoundException('商品细节与适配车型均加载失败');
    }

    const normKey = (s: string) =>
      String(s || '')
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '');

    const map = new Map<string, { name: string; value: string }>();
    for (const it of browse?.specifics ?? []) {
      const k = normKey(it.name);
      if (!k) continue;
      if (!map.has(k)) map.set(k, it);
    }
    for (const it of (fitment as any)?.specifics ?? []) {
      const k = normKey(it.name);
      if (!k) continue;
      if (!map.has(k)) map.set(k, it);
    }

    return {
      url: browse?.url ?? (fitment as any)?.url ?? '',
      siteId: (fitment as any)?.siteId ?? '',
      itemId: browse?.itemId ?? (fitment as any)?.itemId ?? '',
      marketplaceId: browse?.marketplaceId ?? 'EBAY_US',
      basic:
        browse?.basic ??
        ({
          title: null,
          priceValue: null,
          priceCurrency: null,
          condition: null,
          sellerUsername: null,
          availabilityStatus: null,
          itemWebUrl: null,
        } as any),
      vehicles: (fitment as any)?.vehicles ?? { totalCount: 0, items: [], rawSample: [] },
      vehiclesError,
      specifics: Array.from(map.values()),
    };
  }

  async applySkuPricesFromSelection(priceMap: Map<string, string>): Promise<{ updated: number; notFound: number; notFoundSkus: string[] }> {
    const entries = Array.from(priceMap.entries()).filter(([sku]) => String(sku).trim());
    if (entries.length === 0) return { updated: 0, notFound: 0, notFoundSkus: [] };

    // 按前缀匹配（与列表页 INNER JOIN 规则一致）
    const prefixToPrice = new Map<string, string>();
    for (const [sku, price] of entries) {
      const parts = String(sku).trim().split('-');
      const prefix = parts.slice(0, 2).join('-').toLowerCase();
      if (!prefixToPrice.has(prefix)) prefixToPrice.set(prefix, price);
    }
    const prefixes = Array.from(prefixToPrice.keys());

    const matched = prefixes.length > 0
      ? await this.repo
          .createQueryBuilder('p')
          .where("LOWER(SUBSTRING_INDEX(TRIM(p.sku), '-', 2)) IN (:...prefixes)", { prefixes })
          .getMany()
      : [];

    const matchedPrefixes = new Set(
      matched.map((p) => {
        const parts = String(p.sku).trim().split('-');
        return parts.slice(0, 2).join('-').toLowerCase();
      }),
    );
    const notFoundSkus = Array.from(priceMap.keys()).filter((s) => {
      const parts = String(s).trim().split('-');
      return !matchedPrefixes.has(parts.slice(0, 2).join('-').toLowerCase());
    });

    for (const p of matched) {
      const parts = String(p.sku).trim().split('-');
      const prefix = parts.slice(0, 2).join('-').toLowerCase();
      const price = prefixToPrice.get(prefix);
      if (price !== undefined) p.price = price;
    }
    await this.repo.save(matched);
    return { updated: matched.length, notFound: notFoundSkus.length, notFoundSkus };
  }

  async adminExportEbayProducts(): Promise<Array<{ sku: string; price: string }>> {
    const rows = await this.repo
      .createQueryBuilder('p')
      .select(['p.sku AS sku', 'p.price AS price'])
      .orderBy('p.sku', 'ASC')
      .getRawMany<{ sku: string; price: string }>();
    return rows.map((r) => ({ sku: String(r.sku), price: String(r.price) }));
  }

  private normalizeCurrency(input: string): string {
    return String(input || '')
      .trim()
      .toUpperCase();
  }

  private normalizeSku(input: string): string {
    return String(input || '').trim();
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

  async adminImportEbayPricesFromXlsx(
    buf: Buffer,
  ): Promise<{
    totalRows: number;
    updated: number;
    notFound: number;
    invalid: number;
    details: Array<{ row: number; sku?: string; currency?: string; status: string; message?: string }>;
  }> {
    const wb = new ExcelJS.Workbook();
    await (wb.xlsx as unknown as { load: (data: unknown) => Promise<unknown> }).load(buf);
    const ws = wb.worksheets[0];
    if (!ws) {
      return { totalRows: 0, updated: 0, notFound: 0, invalid: 0, details: [{ row: 0, status: 'INVALID', message: 'Excel 无工作表' }] };
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
    const colCurrency = headerIndex(['currency', '货币类型', '币种']);
    const colOld = headerIndex(['原价格', 'old price', 'old_price', 'oldprice']);
    const colNew = headerIndex(['调整后的价格', 'new price', 'new_price', 'newprice', '调整价格']);

    const hasHeader = colSku > 0 && colCurrency > 0 && colNew > 0;
    const skuCol = hasHeader ? colSku : 1;
    const currencyCol = hasHeader ? colCurrency : 2;
    const oldCol = hasHeader ? colOld : 3;
    const newCol = hasHeader ? colNew : 4;
    const startRow = hasHeader ? 2 : 1;

    let totalRows = 0;
    let updated = 0;
    let notFound = 0;
    let invalid = 0;
    const details: Array<{ row: number; sku?: string; currency?: string; status: string; message?: string }> = [];

    for (let r = startRow; r <= ws.rowCount; r++) {
      const row = ws.getRow(r);
      const sku = this.normalizeSku(row.getCell(skuCol).value as unknown as string);
      const currency = this.normalizeCurrency(row.getCell(currencyCol).value as unknown as string);
      const newPrice = this.coercePrice(row.getCell(newCol).value);
      const oldPrice = oldCol > 0 ? this.coercePrice(row.getCell(oldCol).value) : null;

      const isEmptyRow = !sku && !currency && !newPrice;
      if (isEmptyRow) continue;

      totalRows += 1;
      if (!sku || !currency || !newPrice) {
        invalid += 1;
        details.push({ row: r, sku: sku || undefined, currency: currency || undefined, status: 'INVALID', message: '缺少 SKU/货币/调整后价格' });
        continue;
      }

      const existed = await this.repo.findOne({ where: { sku, currency } });
      if (!existed) {
        notFound += 1;
        details.push({ row: r, sku, currency, status: 'NOT_FOUND', message: '未找到 SKU+币种 对应商品' });
        continue;
      }

      existed.price = newPrice;
      await this.repo.save(existed);
      updated += 1;
      details.push({ row: r, sku, currency, status: 'UPDATED', message: oldPrice ? `原价 ${oldPrice} -> ${newPrice}` : `更新为 ${newPrice}` });
    }

    return { totalRows, updated, notFound, invalid, details };
  }

  async findBySku(sku: string): Promise<EbayProduct> {
    const product = await this.repo.findOne({ where: { sku } });
    if (!product) throw new NotFoundException(`未找到 SKU=${sku}`);
    const selection = await this.selectionRepo.findOne({ where: { sku } });
    (product as unknown as { rmbPrice?: string | null }).rmbPrice = selection ? String(selection.price) : null;
    return product;
  }

  async updateBySku(sku: string, patch: UpdateEbayProductDto): Promise<EbayProduct> {
    const product = await this.repo.findOne({ where: { sku } });
    if (!product) throw new NotFoundException(`未找到 SKU=${sku}`);

    if (patch.title !== undefined) product.title = patch.title;
    if (patch.currency !== undefined) product.currency = patch.currency;
    if (patch.price !== undefined) product.price = String(patch.price);
    if (patch.stockQty !== undefined) product.stockQty = patch.stockQty;
    if (patch.itemUrl !== undefined) product.itemUrl = patch.itemUrl;
    if (patch.status !== undefined) product.status = patch.status;
    if (patch.rawPayload !== undefined) product.rawPayload = patch.rawPayload;

    await this.repo.save(product);
    return product;
  }

  async scrapeBySku(sku: string) {
    const product = await this.repo.findOne({ where: { sku } });
    if (!product) throw new NotFoundException(`未找到 SKU=${sku}`);
    if (!product.itemUrl) throw new NotFoundException(`SKU=${sku} 未配置 itemUrl`);
    return this.ebayPage.scrape(product.itemUrl);
  }

  async refreshFromEbayApiBySku(sku: string): Promise<EbayProduct> {
    const product = await this.repo.findOne({ where: { sku } });
    if (!product) throw new NotFoundException(`未找到 SKU=${sku}`);
    if (!product.itemUrl) throw new NotFoundException(`SKU=${sku} 未配置 itemUrl`);

    const legacyItemId = extractLegacyItemIdFromItemUrl(product.itemUrl);
    const marketplaceId = marketplaceIdFromUrl(product.itemUrl);
    const item = await this.ebayBrowse.getItemByLegacyId({ legacyItemId, marketplaceId });

    const images = [item.image?.imageUrl, ...(item.additionalImages ?? []).map((x) => x?.imageUrl)]
      .filter((u): u is string => typeof u === 'string' && !!u.trim())
      .map((u) => u.trim());
    const uniqueImages = Array.from(new Set(images)).slice(0, 24);

    const raw = (product.rawPayload ?? {}) as Record<string, unknown>;
    const merged = {
      ...raw,
      images: uniqueImages,
      picture_urls: uniqueImages,
      ebayApi: {
        itemId: item.itemId,
        legacyItemId: item.legacyItemId ?? legacyItemId,
        marketplaceId,
        itemWebUrl: item.itemWebUrl,
        title: item.title,
        shortDescription: item.shortDescription,
        fetchedAt: new Date().toISOString(),
      },
    } as Record<string, unknown>;

    const patch: UpdateEbayProductDto = { rawPayload: merged };
    if (item.title && !product.title) patch.title = item.title;
    if (item.price?.value && item.price?.currency && (!product.price || product.price === '0')) {
      patch.price = String(item.price.value);
      patch.currency = String(item.price.currency);
    }
    return this.updateBySku(sku, patch);
  }

  async upsertMany(
    items: Array<{
      sku: string;
      title: string | null;
      stockQty: number;
      price: string;
      currency: string;
      itemUrl: string | null;
      lingxingProductId: string | null;
      rawPayload: Record<string, unknown>;
    }>,
    syncedAt: Date,
    opts?: { updatePrice?: boolean },
  ): Promise<number> {
    if (items.length === 0) return 0;
    const updatePrice = opts?.updatePrice !== false;
    const rows = items.map((it) => ({ ...it, syncedAt })) as unknown as QueryDeepPartialEntity<EbayProduct>[];
    const updateCols = [
      'title',
      'stock_qty',
      ...(updatePrice ? (['price'] as const) : []),
      'currency',
      'item_url',
      'lingxing_product_id',
      'status',
      'raw_payload',
      'synced_at',
      'updated_at',
    ];
    await this.repo
      .createQueryBuilder()
      .insert()
      .into(EbayProduct)
      .values(rows)
      .orUpdate(
        updateCols as unknown as string[],
        ['sku'],
      )
      .execute();
    return rows.length;
  }

  async upsertSkuPrices(
    items: Array<{ sku: string; price: string }>,
    touchedAt: Date,
  ): Promise<number> {
    if (items.length === 0) return 0;
    const rows = items.map((it) => ({
      sku: it.sku,
      price: it.price,
      currency: 'USD',
      stockQty: 0,
      status: 'ACTIVE',
      syncedAt: touchedAt,
      title: null,
      itemUrl: null,
      lingxingProductId: null,
      rawPayload: null,
    })) as unknown as QueryDeepPartialEntity<EbayProduct>[];

    await this.repo
      .createQueryBuilder()
      .insert()
      .into(EbayProduct)
      .values(rows)
      .orUpdate(['price', 'status', 'synced_at', 'updated_at'], ['sku'])
      .execute();
    return rows.length;
  }

  /** 将本次未同步到的历史 ACTIVE 行置为 INACTIVE（实现“仅保留在售”视图） */
  async markNotSyncedAsInactive(syncedAt: Date): Promise<void> {
    await this.repo
      .createQueryBuilder()
      .update(EbayProduct)
      .set({
        status: 'INACTIVE',
        updatedAt: () => 'CURRENT_TIMESTAMP',
      })
      .where('status = :active AND synced_at < :syncedAt', {
        active: 'ACTIVE',
        syncedAt,
      })
      .execute();
  }
}
