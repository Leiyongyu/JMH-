import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import type { EbayMarketplaceId, EbayBrowseItem } from './ebay.types';
import { EbayOAuthService } from './ebay-oauth.service';
import { ebayAxiosConnectionOptions } from './ebay-axios-options';

@Injectable()
export class EbayBrowseService {
  private readonly cache = new Map<string, { expiresAt: number; value: EbayBrowseItem }>();

  constructor(
    private readonly oauth: EbayOAuthService,
    private readonly config: ConfigService,
  ) {}

  private env(): 'production' | 'sandbox' {
    const v = (this.config.get<string>('EBAY_ENV') ?? 'production').trim().toLowerCase();
    return v === 'sandbox' ? 'sandbox' : 'production';
  }

  async getItemByLegacyId(args: {
    legacyItemId: string;
    marketplaceId: EbayMarketplaceId;
  }): Promise<EbayBrowseItem> {
    const cacheKey = `${args.legacyItemId}:${args.marketplaceId}:${this.env()}`;
    const hit = this.cache.get(cacheKey);
    if (hit && Date.now() <= hit.expiresAt) return hit.value;

    const token = await this.oauth.getAppAccessToken();
    const origin = this.env() === 'sandbox' ? 'https://api.sandbox.ebay.com' : 'https://api.ebay.com';
    const url = `${origin}/buy/browse/v1/item/get_item_by_legacy_id`;

    const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

    const isRetryable = (err: unknown) => {
      const status = (err as { response?: { status?: number } })?.response?.status;
      if (typeof status === 'number') return status >= 500 || status === 429;
      const code = String((err as { code?: unknown })?.code ?? '').toUpperCase();
      if (['ECONNABORTED', 'ETIMEDOUT', 'ECONNRESET', 'EAI_AGAIN', 'ENOTFOUND', 'EPIPE'].includes(code)) return true;
      const msg = String((err as { message?: unknown })?.message ?? '').toLowerCase();
      if (!msg) return false;
      return msg.includes('timeout') || msg.includes('timed out') || msg.includes('socket hang up');
    };

    let lastErr: unknown = null;
    for (let i = 0; i < 3; i += 1) {
      const timeout = 30_000 + i * 30_000;
      try {
        const resp = await axios.get(url, {
          timeout,
          ...ebayAxiosConnectionOptions(this.config),
          params: { legacy_item_id: args.legacyItemId },
          headers: {
            Authorization: `Bearer ${token}`,
            'X-EBAY-C-MARKETPLACE-ID': args.marketplaceId,
            Accept: 'application/json',
          },
        });
        const value = resp.data as EbayBrowseItem;
        if (this.cache.size > 500) this.cache.clear();
        this.cache.set(cacheKey, { expiresAt: Date.now() + 5 * 60_000, value });
        return value;
      } catch (err: unknown) {
        lastErr = err;
        const status = (err as { response?: { status?: number } })?.response?.status;
        const data = (err as { response?: { data?: unknown } })?.response?.data;
        if (status === 404) {
          throw new BadRequestException(
            `eBay 未找到该商品（legacyItemId 不存在或站点不匹配；marketplaceId=${args.marketplaceId}；env=${this.env()}）`,
          );
        }
        if (status === 401) throw new BadRequestException('eBay OAuth 失败（请检查 Client ID/Secret 与 scope）');
        if (typeof status === 'number' && status >= 400 && status < 500 && status !== 429) {
          throw new BadRequestException(
            `eBay API 调用失败：HTTP ${status}${data ? `（${JSON.stringify(data).slice(0, 300)}）` : ''}`,
          );
        }
        if (i < 2 && isRetryable(err)) {
          await sleep(400 * (2 ** i) + Math.floor(Math.random() * 120));
          continue;
        }
        if (status === 429) throw new BadRequestException('eBay 限流（429），请降低频率或做缓存');
        if (typeof status === 'number') {
          throw new BadRequestException(
            `eBay API 调用失败：HTTP ${status}${data ? `（${JSON.stringify(data).slice(0, 300)}）` : ''}`,
          );
        }
        throw new BadRequestException('eBay API 调用失败：网络错误');
      }
    }
    throw lastErr instanceof Error ? lastErr : new BadRequestException('eBay API 调用失败：网络错误');
  }
}
