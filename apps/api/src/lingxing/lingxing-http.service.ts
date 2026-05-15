import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosRequestConfig } from 'axios';
import { LingxingSignService } from './lingxing-sign.service';
import { LingxingTokenService } from './lingxing-token.service';
import { LingxingApiError, LingxingApiResponse } from './lingxing.types';
import { lingxingAxiosConnectionCandidates } from './lingxing-axios-options';
import {
  isTransientLingxingTransportError,
  withLingxingTransportRetries,
  wrapLingxingTransportError,
} from './lingxing-transport';
import { lingxingAxiosTimeout } from './lingxing-timeouts';

@Injectable()
export class LingxingHttpService {
  private readonly logger = new Logger(LingxingHttpService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly tokens: LingxingTokenService,
    private readonly sign: LingxingSignService,
  ) {}

  isConfigured() {
    return this.tokens.isConfigured();
  }

  /**
   * 业务读接口：自动注入 app_key/timestamp/access_token/sign。
   * 大多数领星读接口使用 POST + JSON body，签名仅参与 query；这里同时支持 query + body。
   */
  async request<T = unknown>(args: {
    method?: 'GET' | 'POST';
    path: string;
    query?: Record<string, unknown>;
    body?: Record<string, unknown>;
  }): Promise<LingxingApiResponse<T>> {
    const method = args.method ?? 'POST';
    const baseUrl = this.config.get<string>('LINGXING_BASE_URL', 'https://openapi.lingxing.com');
    const accessToken = await this.tokens.getAccessToken();
    const appId = this.tokens.appId();

    const baseQuery: Record<string, unknown> = {
      app_key: appId,
      timestamp: String(Math.floor(Date.now() / 1000)),
      access_token: accessToken,
      ...(args.query ?? {}),
    };
    // 部分领星接口（如库存明细）签名需要包含 body 参数
    const signParams =
      method === 'POST' ? { ...baseQuery, ...(args.body ?? {}) } : baseQuery;
    const sign = encodeURIComponent(this.sign.sign(signParams, appId));
    const finalQuery = { ...baseQuery, sign };

    const httpTimeoutMs = lingxingAxiosTimeout(this.config, 'LINGXING_HTTP_TIMEOUT_MS', 180_000);
    const baseCfg: AxiosRequestConfig = {
      method,
      url: `${baseUrl}${args.path}`,
      params: finalQuery,
      timeout: httpTimeoutMs,
      headers: { 'Content-Type': 'application/json' },
    };
    if (method === 'POST') baseCfg.data = args.body ?? {};

    const retries = Math.max(0, Number(this.config.get('LINGXING_TRANSPORT_RETRIES', 2)));
    const baseDelayMs = Math.max(0, Number(this.config.get('LINGXING_TRANSPORT_RETRY_DELAY_MS', 800)));
    const candidates = lingxingAxiosConnectionCandidates(this.config);
    let lastErr: unknown = null;
    let res: { data: LingxingApiResponse<T> } | null = null;
    for (const c of candidates) {
      try {
        const cfg = { ...baseCfg, ...c } as AxiosRequestConfig;
        res = await withLingxingTransportRetries(
          () => axios.request<LingxingApiResponse<T>>(cfg),
          { retries, baseDelayMs },
        );
        break;
      } catch (e) {
        lastErr = e;
        // ECONNREFUSED 等不算「可重试抖动」，但应继续尝试下一连接策略（如关闭的本地代理后是直连）
        if (isTransientLingxingTransportError(e)) {
          this.logger.warn(`Lingxing transport failed via ${c.name}, trying next candidate`);
        } else {
          this.logger.warn(
            `Lingxing transport failed via ${c.name} (${e instanceof Error ? e.message : String(e)}), trying next candidate`,
          );
        }
      }
    }
    if (!res) throw wrapLingxingTransportError(lastErr);
    const result = res.data;
    const c = result.code as number | string;
    const ok = c === 0 || c === '0' || Number(c) === 0;
    if (!ok) {
      const msg = result.msg ?? result.message ?? 'lingxing api error';
      this.logger.error(`Lingxing ${args.path} failed code=${result.code} msg=${msg}`);
      throw new LingxingApiError(result.code, msg, result);
    }
    return result;
  }
}
