import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import {
  GoodcangNotConfiguredError,
  GoodcangApiError,
  GoodcangTokenResponse,
} from './goodcang.types';
import { goodcangAxiosConnectionCandidates } from './goodcang-axios-options';
import {
  isTransientGoodcangTransportError,
  withGoodcangTransportRetries,
  wrapGoodcangTransportError,
} from './goodcang-transport';
import { goodcangAxiosTimeout } from './goodcang-timeouts';

@Injectable()
export class GoodcangTokenService {
  private readonly logger = new Logger(GoodcangTokenService.name);
  private cachedToken: string | null = null;
  private expiresAt = 0;

  constructor(private readonly config: ConfigService) {}

  isConfigured(): boolean {
    const key = this.config.get<string>('GOODCANG_APP_KEY')?.trim() ?? process.env.GOODCANG_APP_KEY?.trim() ?? '';
    const secret = this.config.get<string>('GOODCANG_APP_SECRET')?.trim() ?? process.env.GOODCANG_APP_SECRET?.trim() ?? '';
    return Boolean(key && secret);
  }

  appKey(): string {
    const key = this.config.get<string>('GOODCANG_APP_KEY')?.trim() || process.env.GOODCANG_APP_KEY?.trim() || '';
    if (!key) throw new GoodcangNotConfiguredError();
    return key;
  }

  async getAccessToken(forceRefresh = false): Promise<string> {
    if (!this.isConfigured()) throw new GoodcangNotConfiguredError();
    const now = Date.now();
    if (!forceRefresh && this.cachedToken && now < this.expiresAt - 60_000) {
      return this.cachedToken;
    }

    const baseUrl = this.config.get<string>('GOODCANG_BASE_URL', process.env.GOODCANG_BASE_URL || 'https://oms.goodcang.com');
    const url = `${baseUrl}/api/auth/token`;
    const body = {
      app_key: this.appKey(),
      app_secret: this.config.get<string>('GOODCANG_APP_SECRET')?.trim() ?? '',
    };

    const retries = Math.max(0, Number(this.config.get('GOODCANG_TRANSPORT_RETRIES', 2)));
    const baseDelayMs = Math.max(0, Number(this.config.get('GOODCANG_TRANSPORT_RETRY_DELAY_MS', 800)));
    const tokenTimeoutMs = goodcangAxiosTimeout(this.config, 'GOODCANG_TOKEN_TIMEOUT_MS', 90_000);
    const baseReq = {
      headers: { 'Content-Type': 'application/json' },
      timeout: tokenTimeoutMs,
    };
    const candidates = goodcangAxiosConnectionCandidates(this.config);
    let lastErr: unknown = null;
    let res: { data: GoodcangTokenResponse } | null = null;
    for (const c of candidates) {
      try {
        res = await withGoodcangTransportRetries(
          () => axios.post<GoodcangTokenResponse>(url, body, { ...baseReq, ...c }),
          { retries, baseDelayMs },
        );
        break;
      } catch (e) {
        lastErr = e;
        if (!isTransientGoodcangTransportError(e)) {
          throw e;
        }
        this.logger.warn(`Goodcang token transport failed via ${c.name}, trying next candidate`);
      }
    }
    if (!res) throw wrapGoodcangTransportError(lastErr);
    const result = res.data;
    const code = result.code;
    const ok = code === 0 || code === '0' || code === 200 || code === '200' || Number(code) === 0;
    if (!ok || !result.data?.access_token) {
      this.logger.error(`Goodcang token failed: code=${code} msg=${result.msg ?? result.message}`);
      throw new GoodcangApiError(code ?? -1, result.msg ?? result.message ?? 'token error', result);
    }
    this.cachedToken = result.data.access_token;
    this.expiresAt = now + (Number(result.data.expires_in ?? 7200) * 1000);
    this.logger.log(`Goodcang token refreshed, expiresAt=${new Date(this.expiresAt).toISOString()}`);
    return this.cachedToken;
  }
}
