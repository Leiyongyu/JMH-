import { BadRequestException, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

@Injectable()
export class EbayTestCacheService {
  constructor(private readonly ds: DataSource) {}

  private normSku(sku: string): string {
    const s = String(sku ?? '').trim();
    if (!s) throw new BadRequestException('缺少 sku（用于存储）');
    return s;
  }

  private tryParseJson<T>(v: unknown, fallback: T): T {
    if (v === null || v === undefined) return fallback;
    if (typeof v === 'object') return v as T;
    const s = String(v ?? '').trim();
    if (!s) return fallback;
    try {
      return JSON.parse(s) as T;
    } catch {
      return fallback;
    }
  }

  async getBrowseBySku(skuRaw: string): Promise<{
    sku: string;
    itemId: string | null;
    marketplaceId: string;
    basic: {
      title: string | null;
      priceValue: string | null;
      priceCurrency: string | null;
      condition: string | null;
      sellerUsername: string | null;
      availabilityStatus: string | null;
      itemWebUrl: string | null;
    };
    specifics: Array<{ name: string; value: string }>;
    fetchedAt: string;
    updatedAt: string;
  } | null> {
    const sku = this.normSku(skuRaw);
    try {
      const rows = (await this.ds.query(
        `
          SELECT
            sku,
            item_id,
            marketplace_id,
            item_web_url,
            title,
            price_value,
            price_currency,
            \`condition\`,
            seller_username,
            availability_status,
            specifics_json,
            fetched_at,
            updated_at
          FROM ebay_cached_item_details
          WHERE sku = ?
          LIMIT 1
        `,
        [sku],
      )) as Array<Record<string, unknown>>;
      const r = rows?.[0];
      if (!r) return null;
      return {
        sku: String(r.sku),
        itemId: r.item_id ? String(r.item_id) : null,
        marketplaceId: String(r.marketplace_id ?? 'EBAY_US'),
        basic: {
          title: r.title ? String(r.title) : null,
          priceValue: r.price_value !== null && r.price_value !== undefined ? String(r.price_value) : null,
          priceCurrency: r.price_currency ? String(r.price_currency) : null,
          condition: r.condition ? String(r.condition) : null,
          sellerUsername: r.seller_username ? String(r.seller_username) : null,
          availabilityStatus: r.availability_status ? String(r.availability_status) : null,
          itemWebUrl: r.item_web_url ? String(r.item_web_url) : null,
        },
        specifics: this.tryParseJson(r.specifics_json, [] as Array<{ name: string; value: string }>),
        fetchedAt: String(r.fetched_at),
        updatedAt: String(r.updated_at),
      };
    } catch (err: unknown) {
      const code = String((err as { code?: unknown })?.code ?? '');
      if (code === 'ER_NO_SUCH_TABLE') return null;
      throw err;
    }
  }

  async getTradingBySku(skuRaw: string): Promise<{
    sku: string;
    itemId: string | null;
    siteId: string | null;
    vehicles: {
      totalCount: number;
      items: any[];
      rawSample: any[];
    };
    specifics: Array<{ name: string; value: string }>;
    fetchedAt: string;
    updatedAt: string;
  } | null> {
    const sku = this.normSku(skuRaw);
    try {
      const rows = (await this.ds.query(
        `
          SELECT
            sku,
            item_id,
            site_id,
            total_count,
            vehicles_json,
            raw_sample_json,
            specifics_json,
            fetched_at,
            updated_at
          FROM ebay_cached_item_fitments
          WHERE sku = ?
          LIMIT 1
        `,
        [sku],
      )) as Array<Record<string, unknown>>;
      const r = rows?.[0];
      if (!r) return null;
      return {
        sku: String(r.sku),
        itemId: r.item_id ? String(r.item_id) : null,
        siteId: r.site_id ? String(r.site_id) : null,
        vehicles: {
          totalCount: Number(r.total_count ?? 0) || 0,
          items: this.tryParseJson(r.vehicles_json, [] as any[]),
          rawSample: this.tryParseJson(r.raw_sample_json, [] as any[]),
        },
        specifics: this.tryParseJson(r.specifics_json, [] as Array<{ name: string; value: string }>),
        fetchedAt: String(r.fetched_at),
        updatedAt: String(r.updated_at),
      };
    } catch (err: unknown) {
      const code = String((err as { code?: unknown })?.code ?? '');
      if (code === 'ER_NO_SUCH_TABLE') return null;
      throw err;
    }
  }

  async saveBrowse(args: {
    sku: string;
    itemId: string | null;
    marketplaceId: string;
    itemWebUrl: string | null;
    title: string | null;
    priceValue: string | null;
    priceCurrency: string | null;
    condition: string | null;
    sellerUsername: string | null;
    availabilityStatus: string | null;
    specifics: Array<{ name: string; value: string }>;
    raw: unknown;
  }): Promise<void> {
    const sku = this.normSku(args.sku);
    try {
      await this.ds.query(
        `
          INSERT INTO ebay_cached_item_details (
            id,
            sku, item_id, marketplace_id, item_web_url,
            title, price_value, price_currency, \`condition\`,
            seller_username, availability_status,
            specifics_json, raw_json,
            fetched_at, updated_at
          ) VALUES (
            UUID(),
            ?, ?, ?, ?,
            ?, ?, ?, ?,
            ?, ?,
            CAST(? AS JSON), CAST(? AS JSON),
            CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
          )
          ON DUPLICATE KEY UPDATE
            item_id = VALUES(item_id),
            marketplace_id = VALUES(marketplace_id),
            item_web_url = VALUES(item_web_url),
            title = VALUES(title),
            price_value = VALUES(price_value),
            price_currency = VALUES(price_currency),
            \`condition\` = VALUES(\`condition\`),
            seller_username = VALUES(seller_username),
            availability_status = VALUES(availability_status),
            specifics_json = VALUES(specifics_json),
            raw_json = VALUES(raw_json),
            fetched_at = VALUES(fetched_at),
            updated_at = VALUES(updated_at)
        `,
        [
          sku,
          args.itemId,
          args.marketplaceId,
          args.itemWebUrl,
          args.title,
          args.priceValue,
          args.priceCurrency,
          args.condition,
          args.sellerUsername,
          args.availabilityStatus,
          JSON.stringify(args.specifics ?? []),
          JSON.stringify(args.raw ?? null),
        ],
      );
    } catch (err: unknown) {
      const code = String((err as { code?: unknown })?.code ?? '');
      if (code === 'ER_NO_SUCH_TABLE') throw new BadRequestException('缓存表不存在，请先创建 ebay_cached_item_details');
      throw err;
    }
  }

  async saveTrading(args: {
    sku: string;
    itemId: string | null;
    siteId: string | null;
    totalCount: number;
    vehicles: unknown;
    rawSample: unknown;
    specifics: Array<{ name: string; value: string }>;
  }): Promise<void> {
    const sku = this.normSku(args.sku);
    try {
      await this.ds.query(
        `
          INSERT INTO ebay_cached_item_fitments (
            id,
            sku, item_id, site_id,
            total_count,
            vehicles_json, raw_sample_json, specifics_json,
            fetched_at, updated_at
          ) VALUES (
            UUID(),
            ?, ?, ?,
            ?,
            CAST(? AS JSON), CAST(? AS JSON), CAST(? AS JSON),
            CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
          )
          ON DUPLICATE KEY UPDATE
            item_id = VALUES(item_id),
            site_id = VALUES(site_id),
            total_count = VALUES(total_count),
            vehicles_json = VALUES(vehicles_json),
            raw_sample_json = VALUES(raw_sample_json),
            specifics_json = VALUES(specifics_json),
            fetched_at = VALUES(fetched_at),
            updated_at = VALUES(updated_at)
        `,
        [
          sku,
          args.itemId,
          args.siteId,
          Number.isFinite(args.totalCount) ? args.totalCount : 0,
          JSON.stringify(args.vehicles ?? []),
          JSON.stringify(args.rawSample ?? []),
          JSON.stringify(args.specifics ?? []),
        ],
      );
    } catch (err: unknown) {
      const code = String((err as { code?: unknown })?.code ?? '');
      if (code === 'ER_NO_SUCH_TABLE') throw new BadRequestException('缓存表不存在，请先创建 ebay_cached_item_fitments');
      throw err;
    }
  }
}
