import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { XMLParser } from 'fast-xml-parser';
import { ebayAxiosConnectionOptions } from './ebay-axios-options';
import { EbayOAuthService } from './ebay-oauth.service';
import { EbayUserOAuthService } from './ebay-user-oauth.service';

type ItemSpecificRow = { name: string; value: string };

type VehicleRow = {
  Marke: string | null;
  Modell: string | null;
  Baujahr: string | null;
  Plattform: string | null;
  Typ: string | null;
  Motor: string | null;
  Einschraenkungen: string | null;
};

type BrowseBasic = {
  title: string | null;
  priceValue: string | null;
  priceCurrency: string | null;
  condition: string | null;
  sellerUsername: string | null;
  availabilityStatus: string | null;
  itemWebUrl: string | null;
};

type BrowseResult = {
  url: string;
  itemId: string;
  marketplaceId: string;
  basic: BrowseBasic;
  specifics: ItemSpecificRow[];
};

type TradingResult = {
  url: string;
  itemId: string;
  siteId: string;
  vehicles: {
    totalCount: number;
    items: VehicleRow[];
    rawSample: Array<Record<string, string>>;
  };
  specifics: ItemSpecificRow[];
};

@Injectable()
export class EbayUrlTestService {
  private readonly browseCache = new Map<string, { expiresAt: number; value: BrowseResult }>();
  private readonly tradingCache = new Map<string, { expiresAt: number; value: TradingResult }>();

  constructor(
    private readonly config: ConfigService,
    private readonly oauth: EbayOAuthService,
    private readonly userOAuth: EbayUserOAuthService,
  ) {}

  private env(): 'production' | 'sandbox' {
    const v = (this.config.get<string>('EBAY_ENV') ?? 'production').trim().toLowerCase();
    return v === 'sandbox' ? 'sandbox' : 'production';
  }

  private browseOrigin(): string {
    return this.env() === 'sandbox' ? 'https://api.sandbox.ebay.com' : 'https://api.ebay.com';
  }

  private tradingApiUrl(): string {
    return 'https://api.ebay.com/ws/api.dll';
  }

  private requireConfig(key: string): string {
    const v = this.config.get<string>(key);
    const s = String(v ?? '').trim();
    if (!s) throw new BadRequestException(`缺少配置：${key}`);
    return s;
  }

  private cleanUrl(url: string): string {
    let s = String(url || '');
    s = s.replace(/[\u200B-\u200D\uFEFF]/g, '').trim();
    s = s.replace(/^[`"'“”]+|[`"'“”]+$/g, '').trim();
    s = s.replace(/`/g, '').trim();
    if (!s) throw new BadRequestException('请输入链接');
    return s;
  }

  private itemIdFromUrl(url: string): string {
    const s = String(url || '').trim();
    const m = s.match(/\/itm\/(\d{9,20})(?:[/?]|$)/i);
    if (m?.[1]) return m[1];
    const m3 = s.match(/\/itm\/[^?]*?\/(\d{9,20})(?:[/?]|$)/i);
    if (m3?.[1]) return m3[1];
    const m4 = s.match(/\/itm\/[^?]*?-(\d{9,20})(?:[/?]|$)/i);
    if (m4?.[1]) return m4[1];
    const tail = s.match(/\/(\d{9,20})(?:[/?]|$)/);
    if (tail?.[1]) return tail[1];
    const q = s.match(/[?&]item=(\d{9,20})/i);
    if (q?.[1]) return q[1];
    throw new BadRequestException('无法从链接提取 ItemID');
  }

  private marketplaceIdFromUrl(url: string): string {
    const s = String(url || '').trim().toLowerCase();
    if (!s) return 'EBAY_US';
    if (s.includes('ebay.de')) return 'EBAY_DE';
    if (s.includes('ebay.co.uk')) return 'EBAY_GB';
    if (s.includes('ebay.fr')) return 'EBAY_FR';
    if (s.includes('ebay.it')) return 'EBAY_IT';
    if (s.includes('ebay.es')) return 'EBAY_ES';
    if (s.includes('ebay.ca')) return 'EBAY_CA';
    if (s.includes('ebay.com.au')) return 'EBAY_AU';
    return 'EBAY_US';
  }

  private siteIdFromUrl(url: string): string {
    const s = String(url || '').toLowerCase();
    if (s.includes('ebay.de')) return '77';
    if (s.includes('ebay.co.uk')) return '3';
    if (s.includes('ebay.fr')) return '71';
    if (s.includes('ebay.it')) return '101';
    if (s.includes('ebay.es')) return '186';
    if (s.includes('ebay.ca')) return '2';
    if (s.includes('ebay.com.au')) return '15';
    return '0';
  }

  private toText(v: unknown): string | null {
    if (v === null || v === undefined) return null;
    const s = String(v).trim();
    return s ? s : null;
  }

  private asArray<T>(v: T | T[] | undefined | null): T[] {
    if (v === null || v === undefined) return [];
    return Array.isArray(v) ? v : [v];
  }

  private normKey(s: string): string {
    return String(s || '')
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '');
  }

  private pickByNorm(raw: Record<string, string>, norms: string[]): string | null {
    const candidates = norms.map((n) => this.normKey(n)).filter(Boolean);
    const entries = Object.entries(raw).filter(([, v]) => Boolean(v));
    for (const cand of candidates) {
      for (const [k, v] of entries) {
        const nk = this.normKey(k);
        if (nk === cand || nk.includes(cand)) return v;
      }
    }
    return null;
  }

  private pickYear(raw: Record<string, string>): string | null {
    const direct = this.pickByNorm(raw, ['Year', 'Baujahr', 'ModelYear']);
    if (direct) return direct;
    const from = this.pickByNorm(raw, ['YearFrom', 'FromYear', 'BaujahrVon']);
    const to = this.pickByNorm(raw, ['YearTo', 'ToYear', 'BaujahrBis']);
    if (from && to) return from === to ? from : `${from}-${to}`;
    return from ?? to ?? null;
  }

  private parser() {
    return new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '',
      removeNSPrefix: true,
      parseAttributeValue: false,
      processEntities: false,
      trimValues: true,
    });
  }

  private sleep(ms: number) {
    return new Promise<void>((resolve) => setTimeout(resolve, ms));
  }

  private isRetryable(err: unknown): boolean {
    const status = (err as { response?: { status?: number } })?.response?.status;
    if (typeof status === 'number') return status >= 500 || status === 429;
    const code = String((err as { code?: unknown })?.code ?? '').toUpperCase();
    if (['ECONNABORTED', 'ETIMEDOUT', 'ECONNRESET', 'EAI_AGAIN', 'ENOTFOUND', 'EPIPE'].includes(code)) return true;
    const msg = String((err as { message?: unknown })?.message ?? '').toLowerCase();
    if (!msg) return false;
    return msg.includes('timeout') || msg.includes('timed out') || msg.includes('socket hang up');
  }

  private getCache<T>(map: Map<string, { expiresAt: number; value: T }>, key: string): T | null {
    const hit = map.get(key);
    if (!hit) return null;
    if (Date.now() > hit.expiresAt) {
      map.delete(key);
      return null;
    }
    return hit.value;
  }

  private setCache<T>(map: Map<string, { expiresAt: number; value: T }>, key: string, value: T, ttlMs: number) {
    if (map.size > 200) map.clear();
    map.set(key, { expiresAt: Date.now() + ttlMs, value });
  }

  async browseByUrl(
    url: string,
    opts?: {
      timeoutMs?: number;
    },
  ): Promise<BrowseResult> {
    const cleanUrl = this.cleanUrl(url);
    const itemId = this.itemIdFromUrl(cleanUrl);
    const marketplaceId = this.marketplaceIdFromUrl(cleanUrl);

    const cacheKey = `${itemId}:${marketplaceId}:${this.env()}`;
    const cached = this.getCache(this.browseCache, cacheKey);
    if (cached) return cached;

    const token = await this.oauth.getAppAccessToken();
    const apiUrl = `${this.browseOrigin()}/buy/browse/v1/item/get_item_by_legacy_id`;

    let resp;
    let lastErr: unknown = null;
    const timeoutList =
      typeof opts?.timeoutMs === 'number' && Number.isFinite(opts.timeoutMs) && opts.timeoutMs > 0
        ? [Math.floor(opts.timeoutMs)]
        : [30_000, 60_000, 90_000];
    for (let i = 0; i < timeoutList.length; i += 1) {
      const timeout = timeoutList[i];
      try {
        resp = await axios.get(apiUrl, {
          timeout,
          ...ebayAxiosConnectionOptions(this.config),
          params: { legacy_item_id: itemId },
          headers: {
            Authorization: `Bearer ${token}`,
            'X-EBAY-C-MARKETPLACE-ID': marketplaceId,
            Accept: 'application/json',
          },
        });
        lastErr = null;
        break;
      } catch (err: unknown) {
        lastErr = err;
        const status = (err as { response?: { status?: number } })?.response?.status;
        const data = (err as { response?: { data?: unknown } })?.response?.data;
        if (status === 401) throw new BadRequestException('Browse API OAuth 失败（请检查 App Token 配置）');
        if (status === 404) throw new BadRequestException('Browse API 未找到商品（ItemID 不存在或 marketplaceId 不匹配）');
        if (typeof status === 'number' && status >= 400 && status < 500 && status !== 429) {
          throw new BadRequestException(
            `Browse API 失败：HTTP ${status}${data ? `（${JSON.stringify(data).slice(0, 300)}）` : ''}`,
          );
        }
        if (i < timeoutList.length - 1 && this.isRetryable(err)) {
          await this.sleep(400 * (2 ** i) + Math.floor(Math.random() * 120));
          continue;
        }
        if (status === 429) throw new BadRequestException('Browse API 限流（429）');
        if (typeof status === 'number') {
          throw new BadRequestException(
            `Browse API 失败：HTTP ${status}${data ? `（${JSON.stringify(data).slice(0, 300)}）` : ''}`,
          );
        }
        const errCode = (err as { code?: string })?.code;
        const errMsg = (err as { message?: string })?.message;
        throw new BadRequestException(
          `Browse API 失败：网络错误${errCode || errMsg ? `（${[errCode, errMsg].filter(Boolean).join(' / ')}）` : ''}`,
        );
      }
    }
    if (!resp) throw lastErr instanceof Error ? lastErr : new BadRequestException('Browse API 失败：网络错误');

    const data = resp?.data as any;
    const price = data?.price ?? {};
    const seller = data?.seller ?? {};
    const availability = data?.availability ?? {};
    const aspects = Array.isArray(data?.localizedAspects) ? data.localizedAspects : [];

    const specifics: ItemSpecificRow[] = aspects
      .map((a: any) => ({ name: this.toText(a?.name), value: this.toText(a?.value) }))
      .filter((x: any) => Boolean(x?.name) && Boolean(x?.value))
      .map((x: any) => ({ name: String(x.name), value: String(x.value) }));

    const result: BrowseResult = {
      url: cleanUrl,
      itemId,
      marketplaceId,
      basic: {
        title: this.toText(data?.title),
        priceValue: this.toText(price?.value),
        priceCurrency: this.toText(price?.currency),
        condition: this.toText(data?.condition),
        sellerUsername: this.toText(seller?.username),
        availabilityStatus: this.toText(availability?.availabilityStatus),
        itemWebUrl: this.toText(data?.itemWebUrl),
      },
      specifics,
    };
    this.setCache(this.browseCache, cacheKey, result, 5 * 60_000);
    return result;
  }

  async tradingFitmentByUrl(
    url: string,
    opts?: {
      timeoutMs?: number;
      lite?: boolean;
    },
  ): Promise<TradingResult> {
    const cleanUrl = this.cleanUrl(url);
    const itemId = this.itemIdFromUrl(cleanUrl);
    const siteId = this.siteIdFromUrl(cleanUrl);

    const cacheKey = `${itemId}:${siteId}:${this.env()}`;
    const cached = this.getCache(this.tradingCache, cacheKey);
    if (cached) return cached;

    const userAccessToken = await this.userOAuth.getUserAccessToken();
    const devId = this.requireConfig('EBAY_TRADING_DEV_ID');
    const appId = this.requireConfig('EBAY_TRADING_APP_ID');
    const certId = this.requireConfig('EBAY_TRADING_CERT_ID');

    const lite = Boolean(opts?.lite);
    const requestXml =
      `<?xml version="1.0" encoding="utf-8"?>` +
      `<GetItemRequest xmlns="urn:ebay:apis:eBLBaseComponents">` +
      `<ItemID>${itemId}</ItemID>` +
      `<IncludeItemCompatibilityList>true</IncludeItemCompatibilityList>` +
      (lite ? `` : `<IncludeItemSpecifics>true</IncludeItemSpecifics>`) +
      `<IncludeDescription>false</IncludeDescription>` +
      `<DetailLevel>ReturnAll</DetailLevel>` +
      `</GetItemRequest>`;

    let resp;
    let lastErr: unknown = null;
    const timeoutList =
      typeof opts?.timeoutMs === 'number' && Number.isFinite(opts.timeoutMs) && opts.timeoutMs > 0
        ? [Math.floor(opts.timeoutMs)]
        : [45_000, 75_000];
    for (let i = 0; i < timeoutList.length; i += 1) {
      const timeout = timeoutList[i];
      try {
        resp = await axios.post(this.tradingApiUrl(), requestXml, {
          timeout,
          ...ebayAxiosConnectionOptions(this.config),
          headers: {
            'X-EBAY-API-COMPATIBILITY-LEVEL': '967',
            'X-EBAY-API-DEV-NAME': devId,
            'X-EBAY-API-APP-NAME': appId,
            'X-EBAY-API-CERT-NAME': certId,
            'X-EBAY-API-CALL-NAME': 'GetItem',
            'X-EBAY-API-SITEID': siteId,
            'X-EBAY-API-IAF-TOKEN': userAccessToken,
            'Content-Type': 'text/xml',
          },
        });
        lastErr = null;
        break;
      } catch (err: unknown) {
        lastErr = err;
        const status = (err as { response?: { status?: number } })?.response?.status;
        const data = (err as { response?: { data?: unknown } })?.response?.data;
        if (typeof status === 'number' && status >= 400 && status < 500 && status !== 429) {
          throw new BadRequestException(
            `Trading API 失败：HTTP ${status}${data ? `（${String(data).slice(0, 300)}）` : ''}`,
          );
        }
        if (i < timeoutList.length - 1 && this.isRetryable(err)) {
          await this.sleep(600 + Math.floor(Math.random() * 180));
          continue;
        }
        if (typeof status === 'number') {
          throw new BadRequestException(
            `Trading API 失败：HTTP ${status}${data ? `（${String(data).slice(0, 300)}）` : ''}`,
          );
        }
        throw new BadRequestException('Trading API 失败：网络错误');
      }
    }
    if (!resp) throw lastErr instanceof Error ? lastErr : new BadRequestException('Trading API 失败：网络错误');

    let parsed: any;
    try {
      parsed = this.parser().parse(String(resp.data ?? '')) as any;
    } catch (e: unknown) {
      throw new BadRequestException(`Trading XML 解析失败：${(e as Error)?.message ?? 'unknown error'}`);
    }

    const body = parsed?.GetItemResponse ?? parsed;
    const errors = this.asArray(body?.Errors);
    if (errors.length) {
      const first = errors[0];
      const code = this.toText(first?.ErrorCode);
      const msg = this.toText(first?.LongMessage) ?? this.toText(first?.ShortMessage) ?? 'Trading API 错误';
      throw new BadRequestException(code ? `API错误[${code}]：${msg}` : msg);
    }

    const item = body?.Item ?? {};
    const totalCompatibilityCount = Number(this.toText(item?.ItemCompatibilityCount) ?? '0') || 0;

    const compatListNode = item?.ItemCompatibilityList?.Compatibility ?? null;
    const raw = this.asArray(compatListNode).map((c: any) => {
      const out: Record<string, string> = {};
      const nvLists = this.asArray(c?.NameValueList);
      for (const nv of nvLists) {
        const name = this.toText(nv?.Name);
        const val = this.toText(Array.isArray(nv?.Value) ? nv.Value[0] : nv?.Value) ?? '';
        if (name) out[name] = val;
      }
      const notes = this.toText(c?.CompatibilityNotes);
      if (notes) out.CompatibilityNotes = notes;
      return out;
    });

    const vehicles: VehicleRow[] = raw.map((r) => ({
      Marke: this.pickByNorm(r, ['Make', 'Brand', 'Manufacturer', 'Hersteller', 'Marke']),
      Modell: this.pickByNorm(r, ['Model', 'Modell']),
      Baujahr: this.pickYear(r),
      Plattform: this.pickByNorm(r, ['Platform', 'Plattform']),
      Typ: this.pickByNorm(r, ['Type', 'Typ']),
      Motor: this.pickByNorm(r, ['Engine', 'Motor']),
      Einschraenkungen: this.pickByNorm(r, ['CompatibilityNotes', 'Notes', 'Einschraenkungen']),
    }));

    const itemSpecificsNode = item?.ItemSpecifics?.NameValueList;
    const specifics: ItemSpecificRow[] = lite
      ? []
      : this.asArray(itemSpecificsNode)
          .map((nv: any) => {
            const name = this.toText(nv?.Name);
            const rawValue = Array.isArray(nv?.Value) ? nv.Value.join(', ') : nv?.Value;
            const value = this.toText(rawValue);
            if (!name || !value) return null;
            return { name, value };
          })
          .filter((x): x is ItemSpecificRow => Boolean(x));

    const result: TradingResult = {
      url: cleanUrl,
      itemId,
      siteId,
      vehicles: {
        totalCount: totalCompatibilityCount,
        items: vehicles,
        rawSample: raw.slice(0, 10),
      },
      specifics,
    };
    this.setCache(this.tradingCache, cacheKey, result, 5 * 60_000);
    return result;
  }
}
