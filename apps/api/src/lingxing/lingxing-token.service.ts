import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import {
  LingxingNotConfiguredError,
  LingxingApiError,
  LingxingTokenResponse,
} from './lingxing.types';
import { lingxingAxiosConnectionCandidates } from './lingxing-axios-options';
import {
  isTransientLingxingTransportError,
  withLingxingTransportRetries,
  wrapLingxingTransportError,
} from './lingxing-transport';
import { lingxingAxiosTimeout } from './lingxing-timeouts';

@Injectable()
export class LingxingTokenService {
  private readonly logger = new Logger(LingxingTokenService.name);
  private cachedToken: string | null = null;
  /** epoch ms */
  private expiresAt = 0;

  constructor(private readonly config: ConfigService) {}

  isConfigured(): boolean {
    const id = this.config.get<string>('LINGXING_APP_ID')?.trim() ?? process.env.LINGXING_APP_ID?.trim() ?? '';
    const secret = this.config.get<string>('LINGXING_APP_SECRET')?.trim() ?? process.env.LINGXING_APP_SECRET?.trim() ?? '';
    return Boolean(id && secret);
  }

  appId(): string {
    const appId = this.config.get<string>('LINGXING_APP_ID')?.trim() || process.env.LINGXING_APP_ID?.trim() || '';
    if (!appId) throw new LingxingNotConfiguredError();
    return appId;
  }

  async getAccessToken(forceRefresh = false): Promise<string> {
    if (!this.isConfigured()) throw new LingxingNotConfiguredError();
    const now = Date.now();
    if (!forceRefresh && this.cachedToken && now < this.expiresAt - 60_000) {
      return this.cachedToken;
    }

    const baseUrl = this.config.get<string>('LINGXING_BASE_URL', process.env.LINGXING_BASE_URL || 'https://openapi.lingxing.com');
    const url = `${baseUrl}/api/auth-server/oauth/access-token`;
    const body = new URLSearchParams({
      appId: this.appId(),
      appSecret: this.config.get<string>('LINGXING_APP_SECRET')?.trim() ?? '',
    });

    const retries = Math.max(0, Number(this.config.get('LINGXING_TRANSPORT_RETRIES', 2)));
    const baseDelayMs = Math.max(0, Number(this.config.get('LINGXING_TRANSPORT_RETRY_DELAY_MS', 800)));
    const tokenTimeoutMs = lingxingAxiosTimeout(this.config, 'LINGXING_TOKEN_TIMEOUT_MS', 90_000);
    const baseReq = {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      timeout: tokenTimeoutMs,
    };
    const candidates = lingxingAxiosConnectionCandidates(this.config);
    let lastErr: unknown = null;
    let res: { data: LingxingTokenResponse } | null = null;
    for (const c of candidates) {
      try {
        res = await withLingxingTransportRetries(
          () => axios.post<LingxingTokenResponse>(url, body.toString(), { ...baseReq, ...c }),
          { retries, baseDelayMs },
        );
        break;
      } catch (e) {
        lastErr = e;
        if (isTransientLingxingTransportError(e)) {
          this.logger.warn(`Lingxing token transport failed via ${c.name}, trying next candidate`);
        } else {
          this.logger.warn(
            `Lingxing token transport failed via ${c.name} (${e instanceof Error ? e.message : String(e)}), trying next candidate`,
          );
        }
      }
    }
    if (!res) throw wrapLingxingTransportError(lastErr);
    const result = res.data;
    if (result.code !== '200' || !result.data?.access_token) {
      this.logger.error(`Token failed: ${JSON.stringify(result)}`);
      throw new LingxingApiError(result.code, result.msg ?? 'token error', result);
    }
    this.cachedToken = result.data.access_token;
    this.expiresAt = now + (Number(result.data.expires_in ?? 7200) * 1000);
    this.logger.log(`Lingxing token refreshed, expiresAt=${new Date(this.expiresAt).toISOString()}`);
    return this.cachedToken;
  }
}
