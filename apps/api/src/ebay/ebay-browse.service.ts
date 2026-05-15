import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import type { EbayMarketplaceId, EbayBrowseItem } from './ebay.types';
import { EbayOAuthService } from './ebay-oauth.service';
import { ebayAxiosConnectionOptions } from './ebay-axios-options';

@Injectable()
export class EbayBrowseService {
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
    const token = await this.oauth.getAppAccessToken();
    const origin = this.env() === 'sandbox' ? 'https://api.sandbox.ebay.com' : 'https://api.ebay.com';
    const url = `${origin}/buy/browse/v1/item/get_item_by_legacy_id`;

    try {
      const resp = await axios.get(url, {
        timeout: 20_000,
        ...ebayAxiosConnectionOptions(this.config),
        params: { legacy_item_id: args.legacyItemId },
        headers: {
          Authorization: `Bearer ${token}`,
          'X-EBAY-C-MARKETPLACE-ID': args.marketplaceId,
          Accept: 'application/json',
        },
      });
      return resp.data as EbayBrowseItem;
    } catch (err: unknown) {
      const status = (err as { response?: { status?: number } })?.response?.status;
      const data = (err as { response?: { data?: unknown } })?.response?.data;
      if (status === 404) {
        throw new BadRequestException(
          `eBay 未找到该商品（legacyItemId 不存在或站点不匹配；marketplaceId=${args.marketplaceId}；env=${this.env()}）`,
        );
      }
      if (status === 401) throw new BadRequestException('eBay OAuth 失败（请检查 Client ID/Secret 与 scope）');
      if (status === 429) throw new BadRequestException('eBay 限流（429），请降低频率或做缓存');
      if (typeof status === 'number') {
        throw new BadRequestException(`eBay API 调用失败：HTTP ${status}${data ? `（${JSON.stringify(data).slice(0, 300)}）` : ''}`);
      }
      throw new BadRequestException('eBay API 调用失败：网络错误');
    }
  }
}
