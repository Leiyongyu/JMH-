import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { ebayAxiosConnectionOptions } from './ebay-axios-options';
import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';

type TokenCache = { token: string; expiresAtMs: number } | null;

@Injectable()
export class EbayUserOAuthService {
  private readonly logger = new Logger(EbayUserOAuthService.name);
  private cache: TokenCache = null;
  private refreshTokenFileCache: { at: number; value: string | null } | null = null;

  constructor(private readonly config: ConfigService) {}

  private stripQuotes(input: string): string {
    const s = String(input ?? '').trim();
    if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
      return s.slice(1, -1).trim();
    }
    return s;
  }

  private env(): 'production' | 'sandbox' {
    const v = this.stripQuotes(this.config.get<string>('EBAY_ENV') ?? 'production').toLowerCase();
    return v === 'sandbox' ? 'sandbox' : 'production';
  }

  private apiOrigin(): string {
    return this.env() === 'sandbox' ? 'https://api.sandbox.ebay.com' : 'https://api.ebay.com';
  }

  private authOrigin(): string {
    return this.env() === 'sandbox' ? 'https://auth.sandbox.ebay.com' : 'https://auth.ebay.com';
  }

  private clientId(): string {
    return this.stripQuotes(this.config.get<string>('EBAY_CLIENT_ID') ?? '');
  }

  private clientSecret(): string {
    return this.stripQuotes(this.config.get<string>('EBAY_CLIENT_SECRET') ?? '');
  }

  private ruName(): string {
    return this.stripQuotes(this.config.get<string>('EBAY_RU_NAME') ?? '');
  }

  private scopes(): string {
    return (
      this.stripQuotes(this.config.get<string>('EBAY_USER_OAUTH_SCOPES') ?? '') ||
      'https://api.ebay.com/oauth/api_scope'
    );
  }

  private refreshEarlyMs(): number {
    const v = Number(this.config.get<string>('EBAY_USER_TOKEN_REFRESH_EARLY_SECONDS') ?? '300');
    return Math.max(0, (Number.isFinite(v) ? v : 300) * 1000);
  }

  private getRefreshToken(): string {
    const fromEnv = this.stripQuotes(this.config.get<string>('EBAY_USER_REFRESH_TOKEN') ?? '');
    if (fromEnv) return fromEnv;
    const cached = this.refreshTokenFileCache;
    const now = Date.now();
    if (cached && now - cached.at < 60_000) return cached.value ?? '';
    const fromFile = this.readEnvFileValue('EBAY_USER_REFRESH_TOKEN');
    this.refreshTokenFileCache = { at: now, value: fromFile };
    return fromFile ?? '';
  }

  private getStaticAccessToken(): string {
    const v1 = this.stripQuotes(this.config.get<string>('EBAY_USER_ACCESS_TOKEN') ?? '');
    if (v1) return v1;
    const v2 = this.stripQuotes(this.config.get<string>('EBAY_TRADING_USER_TOKEN') ?? '');
    return v2;
  }

  private readEnvFileValue(key: string): string | null {
    const candidates = [
      resolve(process.cwd(), 'apps/api/.env'),
      resolve(process.cwd(), '.env'),
      resolve(__dirname, '../.env'),
      resolve(__dirname, '../../../.env'),
    ];
    for (const p of candidates) {
      if (!existsSync(p)) continue;
      const content = readFileSync(p, 'utf8');
      const lines = content.split(/\r?\n/);
      for (const line of lines) {
        const s = line.trim();
        if (!s || s.startsWith('#')) continue;
        if (!s.startsWith(`${key}=`)) continue;
        const raw = s.slice(`${key}=`.length);
        const val = this.stripQuotes(raw);
        return val || null;
      }
    }
    return null;
  }

  getRefreshTokenStatus(): { exists: boolean; length: number; prefix: string | null; rawLength?: number; rawStrippedLength?: number; rawStrippedPrefix?: string | null } {
    const v = this.getRefreshToken();
    const raw = String(process.env.EBAY_USER_REFRESH_TOKEN ?? '');
    const rawStripped = this.stripQuotes(raw);
    return {
      exists: Boolean(v),
      length: v.length,
      prefix: v ? v.slice(0, 12) : null,
      rawLength: raw.length,
      rawStrippedLength: rawStripped.length,
      rawStrippedPrefix: rawStripped ? rawStripped.slice(0, 12) : null,
    } as any;
  }

  buildAuthorizeUrl(args?: { state?: string }): { url: string; ruName: string; scopes: string } {
    const id = this.clientId();
    const ruName = this.ruName();
    if (!id || !ruName) {
      throw new ServiceUnavailableException('未配置 eBay OAuth（EBAY_CLIENT_ID / EBAY_RU_NAME）');
    }
    const state = String(args?.state ?? '').trim() || String(Date.now());
    const params = new URLSearchParams();
    params.set('client_id', id);
    params.set('response_type', 'code');
    params.set('redirect_uri', ruName);
    params.set('scope', this.scopes());
    params.set('state', state);
    const url = `${this.authOrigin()}/oauth2/authorize?${params.toString()}`;
    return { url, ruName, scopes: this.scopes() };
  }

  async exchangeCode(code: string): Promise<{
    accessToken: string;
    expiresIn: number;
    refreshToken: string;
    refreshTokenExpiresIn: number | null;
    tokenType: string | null;
  }> {
    const rawCode = String(code ?? '').trim();
    let cleanCode = rawCode;
    try {
      cleanCode = decodeURIComponent(rawCode);
    } catch {
      cleanCode = rawCode;
    }
    cleanCode = cleanCode.replace(/\r?\n/g, '').replace(/ /g, '+').trim();
    if (!cleanCode) throw new ServiceUnavailableException('缺少 code');
    const id = this.clientId();
    const secret = this.clientSecret();
    const ruName = this.ruName();
    if (!id || !secret || !ruName) {
      throw new ServiceUnavailableException('未配置 eBay OAuth（EBAY_CLIENT_ID / EBAY_CLIENT_SECRET / EBAY_RU_NAME）');
    }

    const basic = Buffer.from(`${id}:${secret}`).toString('base64');
    const body = new URLSearchParams();
    body.set('grant_type', 'authorization_code');
    body.set('code', cleanCode);
    body.set('redirect_uri', ruName);

    try {
      const resp = await axios.post(
        `${this.apiOrigin()}/identity/v1/oauth2/token`,
        body.toString(),
        {
          timeout: 20_000,
          ...ebayAxiosConnectionOptions(this.config),
          headers: {
            Authorization: `Basic ${basic}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
        },
      );
      const accessToken = String(resp.data?.access_token ?? '').trim();
      const refreshToken = String(resp.data?.refresh_token ?? '').trim();
      const expiresIn = Number(resp.data?.expires_in ?? 0);
      const refreshTokenExpiresInRaw = resp.data?.refresh_token_expires_in;
      const refreshTokenExpiresIn =
        refreshTokenExpiresInRaw === null || refreshTokenExpiresInRaw === undefined
          ? null
          : Number(refreshTokenExpiresInRaw);
      const tokenType = resp.data?.token_type ? String(resp.data?.token_type) : null;
      if (!accessToken || !refreshToken || !Number.isFinite(expiresIn) || expiresIn <= 0) {
        throw new ServiceUnavailableException('eBay OAuth 返回异常');
      }
      this.cache = { token: accessToken, expiresAtMs: Date.now() + expiresIn * 1000 };
      return { accessToken, expiresIn, refreshToken, refreshTokenExpiresIn, tokenType };
    } catch (err: unknown) {
      const status = (err as { response?: { status?: number } })?.response?.status;
      const data = (err as { response?: { data?: unknown } })?.response?.data;
      throw new ServiceUnavailableException(
        `eBay OAuth 换取 Token 失败${status ? `：HTTP ${status}` : ''}${data ? `（${JSON.stringify(data).slice(0, 400)}）` : ''}`,
      );
    }
  }

  async getUserAccessToken(): Promise<string> {
    const refreshToken = this.getRefreshToken();
    if (!refreshToken) {
      const staticToken = this.getStaticAccessToken();
      if (staticToken) return staticToken;
      throw new ServiceUnavailableException('缺少 eBay User Token（EBAY_USER_REFRESH_TOKEN 或 EBAY_USER_ACCESS_TOKEN）');
    }

    const now = Date.now();
    const early = this.refreshEarlyMs();
    if (this.cache && this.cache.expiresAtMs - early > now) return this.cache.token;
    return this.refreshAccessToken(refreshToken);
  }

  private async refreshAccessToken(refreshToken: string): Promise<string> {
    const id = this.clientId();
    const secret = this.clientSecret();
    if (!id || !secret) {
      throw new ServiceUnavailableException('未配置 eBay Client ID/Secret');
    }
    const basic = Buffer.from(`${id}:${secret}`).toString('base64');
    const body = new URLSearchParams();
    body.set('grant_type', 'refresh_token');
    body.set('refresh_token', refreshToken);

    try {
      const resp = await axios.post(
        `${this.apiOrigin()}/identity/v1/oauth2/token`,
        body.toString(),
        {
          timeout: 20_000,
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
      this.cache = { token, expiresAtMs: Date.now() + expiresIn * 1000 };
      this.logger.log(`eBay user token refreshed (expiresIn=${expiresIn}s)`);
      return token;
    } catch (err: unknown) {
      const status = (err as { response?: { status?: number } })?.response?.status;
      const data = (err as { response?: { data?: { error?: string; error_description?: string } } })?.response?.data;
      const hint = data?.error_description || data?.error;
      const invalidGrant = String(data?.error ?? '').toLowerCase() === 'invalid_grant';
      if (invalidGrant) {
        this.logger.error('eBay refresh token invalid_grant');
        throw new ServiceUnavailableException('eBay Refresh Token 已失效/被撤销，请管理员重新授权获取新的 Refresh Token');
      }
      throw new ServiceUnavailableException(
        `eBay OAuth 刷新失败${status ? `：HTTP ${status}` : ''}${hint ? `（${hint}）` : ''}`,
      );
    }
  }
}
