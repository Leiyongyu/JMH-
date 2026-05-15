import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { ebayAxiosConnectionOptions } from './ebay-axios-options';

type TokenCache = { token: string; expiresAtMs: number } | null;

@Injectable()
export class EbayOAuthService {
  private readonly logger = new Logger(EbayOAuthService.name);
  private cache: TokenCache = null;

  constructor(private readonly config: ConfigService) {}

  private env(): 'production' | 'sandbox' {
    const v = (this.config.get<string>('EBAY_ENV') ?? 'production').trim().toLowerCase();
    return v === 'sandbox' ? 'sandbox' : 'production';
  }

  private clientId(): string {
    return (this.config.get<string>('EBAY_CLIENT_ID') ?? '').trim();
  }

  private clientSecret(): string {
    return (this.config.get<string>('EBAY_CLIENT_SECRET') ?? '').trim();
  }

  private scopes(): string {
    return (
      this.config.get<string>('EBAY_OAUTH_SCOPES')?.trim() ||
      'https://api.ebay.com/oauth/api_scope'
    );
  }

  async getAppAccessToken(): Promise<string> {
    const now = Date.now();
    if (this.cache && this.cache.expiresAtMs - 60_000 > now) return this.cache.token;

    const id = this.clientId();
    const secret = this.clientSecret();
    if (!id || !secret) {
      throw new ServiceUnavailableException('未配置 eBay Client ID/Secret');
    }

    const basic = Buffer.from(`${id}:${secret}`).toString('base64');
    const body = new URLSearchParams();
    body.set('grant_type', 'client_credentials');
    body.set('scope', this.scopes());

    try {
      const origin = this.env() === 'sandbox' ? 'https://api.sandbox.ebay.com' : 'https://api.ebay.com';
      const resp = await axios.post(
        `${origin}/identity/v1/oauth2/token`,
        body.toString(),
        {
          timeout: 15_000,
          ...ebayAxiosConnectionOptions(this.config),
          headers: {
            Authorization: `Basic ${basic}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
        },
      );

      const token = String(resp.data?.access_token ?? '').trim();
      const expiresIn = Number(resp.data?.expires_in ?? 0);
      if (!token || !Number.isFinite(expiresIn) || expiresIn <= 0) {
        throw new ServiceUnavailableException('eBay OAuth 返回异常');
      }
      this.cache = { token, expiresAtMs: now + expiresIn * 1000 };
      this.logger.log(`eBay OAuth token refreshed (expiresIn=${expiresIn}s)`);
      return token;
    } catch (err: unknown) {
      const status = (err as { response?: { status?: number } })?.response?.status;
      const msg = (err as { response?: { data?: { error_description?: string; error?: string } } })?.response?.data;
      const hint = msg?.error_description || msg?.error;
      throw new ServiceUnavailableException(
        `eBay OAuth 获取失败${status ? `：HTTP ${status}` : ''}${hint ? `（${hint}）` : ''}`,
      );
    }
  }
}
