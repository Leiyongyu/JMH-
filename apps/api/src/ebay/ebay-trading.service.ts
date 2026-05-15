import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { XMLParser } from 'fast-xml-parser';
import { ebayAxiosConnectionOptions } from './ebay-axios-options';

type VehicleRow = {
  Marke: string | null;
  Modell: string | null;
  Baujahr: string | null;
  Plattform: string | null;
  Typ: string | null;
  Motor: string | null;
  Einschraenkungen: string | null;
};

type ItemSpecificRow = {
  name: string;
  value: string;
};

@Injectable()
export class EbayTradingService {
  constructor(private readonly config: ConfigService) {}

  private browseOrigin(): string {
    const v = (this.config.get<string>('EBAY_ENV') ?? 'production').trim().toLowerCase();
    return v === 'sandbox' ? 'https://api.sandbox.ebay.com' : 'https://api.ebay.com';
  }

  private apiUrl(): string {
    return 'https://api.ebay.com/ws/api.dll';
  }

  private requireConfig(key: string): string {
    const v = this.config.get<string>(key);
    const s = String(v ?? '').trim();
    if (!s) throw new BadRequestException(`缺少配置：${key}`);
    return s;
  }

  private userAccessToken(): string {
    const v1 = String(this.config.get<string>('EBAY_USER_ACCESS_TOKEN') ?? '').trim();
    if (v1) return v1;
    const v2 = String(this.config.get<string>('EBAY_TRADING_USER_TOKEN') ?? '').trim();
    if (v2) return v2;
    throw new BadRequestException('缺少配置：EBAY_USER_ACCESS_TOKEN（或兼容读取 EBAY_TRADING_USER_TOKEN）');
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

  private itemIdFromUrl(url: string): string {
    const s = String(url || '').trim();
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
    throw new BadRequestException('无法从链接提取 ItemID');
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

  private asArray<T>(v: T | T[] | undefined | null): T[] {
    if (v === null || v === undefined) return [];
    return Array.isArray(v) ? v : [v];
  }

  private toText(v: unknown): string | null {
    if (v === null || v === undefined) return null;
    const s = String(v).trim();
    return s ? s : null;
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

  async getItemByUrl(url: string) {
    const cleanUrl = String(url || '').trim().replace(/^`+|`+$/g, '');
    if (!cleanUrl) throw new BadRequestException('请输入链接');

    const userAccessToken = this.userAccessToken();
    const devId = this.requireConfig('EBAY_TRADING_DEV_ID');
    const appId = this.requireConfig('EBAY_TRADING_APP_ID');
    const certId = this.requireConfig('EBAY_TRADING_CERT_ID');

    const itemId = this.itemIdFromUrl(cleanUrl);
    const siteId = this.siteIdFromUrl(cleanUrl);
    const marketplaceId = this.marketplaceIdFromUrl(cleanUrl);

    const browse = await this.fetchBrowseBasic({ itemId, marketplaceId, token: userAccessToken });
    const vehicles = await this.fetchTradingCompat({ itemId, siteId, devId, appId, certId, token: userAccessToken });

    const specificsMap = new Map<string, ItemSpecificRow>();
    for (const it of browse.specifics) {
      const key = this.normKey(it.name);
      if (!key) continue;
      if (!specificsMap.has(key)) specificsMap.set(key, it);
    }
    for (const it of vehicles.specifics) {
      const key = this.normKey(it.name);
      if (!key) continue;
      if (!specificsMap.has(key)) specificsMap.set(key, it);
    }

    return {
      url: cleanUrl,
      itemId,
      siteId,
      marketplaceId,
      basic: browse,
      vehicles,
      specifics: Array.from(specificsMap.values()),
    };
  }

  private async fetchBrowseBasic(args: { itemId: string; marketplaceId: string; token: string }): Promise<{
    title: string | null;
    priceValue: string | null;
    priceCurrency: string | null;
    condition: string | null;
    sellerUsername: string | null;
    availabilityStatus: string | null;
    itemWebUrl: string | null;
    specifics: ItemSpecificRow[];
  }> {
    const url = `${this.browseOrigin()}/buy/browse/v1/item/get_item_by_legacy_id`;
    try {
      const resp = await axios.get(url, {
        timeout: 20_000,
        ...ebayAxiosConnectionOptions(this.config),
        params: { legacy_item_id: args.itemId, fieldgroups: 'PRODUCT' },
        headers: {
          Authorization: `Bearer ${args.token}`,
          'X-EBAY-C-MARKETPLACE-ID': args.marketplaceId,
          Accept: 'application/json',
        },
      });
      const data = resp.data as any;
      const price = (data?.price ?? {}) as Record<string, unknown>;
      const seller = (data?.seller ?? {}) as Record<string, unknown>;
      const availability = (data?.availability ?? {}) as Record<string, unknown>;
      const aspects = Array.isArray(data?.localizedAspects) ? data.localizedAspects : [];
      const specifics: ItemSpecificRow[] = aspects
        .map((a: any) => ({ name: this.toText(a?.name), value: this.toText(a?.value) }))
        .filter((x: any) => Boolean(x?.name) && Boolean(x?.value))
        .map((x: any) => ({ name: String(x.name), value: String(x.value) }));
      return {
        title: this.toText(data?.title),
        priceValue: this.toText(price?.value),
        priceCurrency: this.toText(price?.currency),
        condition: this.toText(data?.condition),
        sellerUsername: this.toText(seller?.username),
        availabilityStatus: this.toText(availability?.availabilityStatus),
        itemWebUrl: this.toText(data?.itemWebUrl),
        specifics,
      };
    } catch (err: unknown) {
      const status = (err as { response?: { status?: number } })?.response?.status;
      const data = (err as { response?: { data?: unknown } })?.response?.data;
      if (status === 401) throw new BadRequestException('Browse API OAuth 失败（请检查 User Access Token 是否有效/是否过期）');
      if (status === 404) throw new BadRequestException('Browse API 未找到商品（ItemID 不存在或 marketplaceId 不匹配）');
      if (status === 429) throw new BadRequestException('Browse API 限流（429）');
      if (typeof status === 'number') {
        throw new BadRequestException(`Browse API 失败：HTTP ${status}${data ? `（${JSON.stringify(data).slice(0, 300)}）` : ''}`);
      }
      throw new BadRequestException('Browse API 失败：网络错误');
    }
  }

  private async fetchTradingCompat(args: {
    itemId: string;
    siteId: string;
    devId: string;
    appId: string;
    certId: string;
    token: string;
  }): Promise<{
    totalCount: number;
    items: VehicleRow[];
    rawSample: Array<Record<string, string>>;
    specifics: ItemSpecificRow[];
  }> {
    const requestXml =
      `<?xml version="1.0" encoding="utf-8"?>` +
      `<GetItemRequest xmlns="urn:ebay:apis:eBLBaseComponents">` +
      `<ItemID>${args.itemId}</ItemID>` +
      `<IncludeItemCompatibilityList>true</IncludeItemCompatibilityList>` +
      `<IncludeItemSpecifics>true</IncludeItemSpecifics>` +
      `<IncludeDescription>false</IncludeDescription>` +
      `<DetailLevel>ReturnAll</DetailLevel>` +
      `</GetItemRequest>`;

    let resp;
    try {
      resp = await axios.post(this.apiUrl(), requestXml, {
        timeout: 60_000,
        ...ebayAxiosConnectionOptions(this.config),
        headers: {
          'X-EBAY-API-COMPATIBILITY-LEVEL': '967',
          'X-EBAY-API-DEV-NAME': args.devId,
          'X-EBAY-API-APP-NAME': args.appId,
          'X-EBAY-API-CERT-NAME': args.certId,
          'X-EBAY-API-CALL-NAME': 'GetItem',
          'X-EBAY-API-SITEID': args.siteId,
          'X-EBAY-API-IAF-TOKEN': args.token,
          'Content-Type': 'text/xml',
        },
      });
    } catch (err: unknown) {
      const status = (err as { response?: { status?: number } })?.response?.status;
      const data = (err as { response?: { data?: unknown } })?.response?.data;
      if (typeof status === 'number') {
        throw new BadRequestException(`Trading API 失败：HTTP ${status}${data ? `（${String(data).slice(0, 300)}）` : ''}`);
      }
      throw new BadRequestException('Trading API 失败：网络错误');
    }

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
      Einschraenkungen: this.pickByNorm(r, ['CompatibilityNotes', 'Notes', 'Einschraenkungen', 'Einschraenkungen']),
    }));

    const itemSpecificsNode = item?.ItemSpecifics?.NameValueList;
    const specifics: ItemSpecificRow[] = this.asArray(itemSpecificsNode)
      .map((nv: any) => {
        const name = this.toText(nv?.Name);
        const rawValue = Array.isArray(nv?.Value) ? nv.Value.join(', ') : nv?.Value;
        const value = this.toText(rawValue);
        if (!name || !value) return null;
        return { name, value };
      })
      .filter((x): x is ItemSpecificRow => Boolean(x));

    return {
      totalCount: totalCompatibilityCount,
      items: vehicles,
      rawSample: raw.slice(0, 10),
      specifics,
    };
  }
}
