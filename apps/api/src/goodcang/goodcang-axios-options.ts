import * as dns from 'node:dns';
import * as https from 'node:https';
import type { LookupFunction } from 'node:net';
import type { ConfigService } from '@nestjs/config';
import type { AxiosRequestConfig } from 'axios';
import { HttpsProxyAgent } from 'https-proxy-agent';

export function goodcangAxiosConnectionOptions(
  config: ConfigService,
): Pick<AxiosRequestConfig, 'httpsAgent' | 'proxy'> {
  const proxyRaw =
    config.get<string>('GOODCANG_HTTPS_PROXY')?.trim() ||
    config.get<string>('GOODCANG_HTTP_PROXY')?.trim() ||
    process.env.HTTPS_PROXY?.trim() ||
    process.env.HTTP_PROXY?.trim() ||
    '';

  if (proxyRaw) {
    try {
      const agent = new HttpsProxyAgent(proxyRaw);
      return { httpsAgent: agent, proxy: false };
    } catch {
      // 非法代理 URL 时回退到直连 + IPv4
    }
  }

  const ipv4First = config.get<string>('GOODCANG_IPV4_FIRST', 'true').toLowerCase() !== 'false';
  if (!ipv4First) {
    return {};
  }

  const lookup: LookupFunction = (hostname, opts, cb) =>
    dns.lookup(hostname, { ...opts, family: 4 }, cb);

  return {
    httpsAgent: new https.Agent({
      keepAlive: true,
      lookup,
    }),
    proxy: false,
  };
}

export interface GoodcangConnectionCandidate
  extends Pick<AxiosRequestConfig, 'httpsAgent' | 'proxy'> {
  name: string;
}

export function goodcangAxiosConnectionCandidates(
  config: ConfigService,
): GoodcangConnectionCandidate[] {
  const candidates: GoodcangConnectionCandidate[] = [];
  const seen = new Set<string>();
  const pushProxy = (proxyUrl: string, name: string) => {
    const key = proxyUrl.trim();
    if (!key || seen.has(key)) return;
    try {
      candidates.push({
        name,
        httpsAgent: new HttpsProxyAgent(key),
        proxy: false,
      });
      seen.add(key);
    } catch {
      // ignore invalid proxy URL
    }
  };

  const explicitProxy =
    config.get<string>('GOODCANG_HTTPS_PROXY')?.trim() ||
    config.get<string>('GOODCANG_HTTP_PROXY')?.trim() ||
    process.env.HTTPS_PROXY?.trim() ||
    process.env.HTTP_PROXY?.trim() ||
    '';
  if (explicitProxy) {
    pushProxy(explicitProxy, `proxy:${explicitProxy}`);
  }

  const autoProxyEnabled =
    String(config.get<string>('GOODCANG_AUTO_PROXY_CANDIDATES', 'true')).toLowerCase() !==
    'false';
  if (autoProxyEnabled) {
    const raw = config.get<string>(
      'GOODCANG_PROXY_CANDIDATES',
      'http://127.0.0.1:7890,http://127.0.0.1:7897,http://127.0.0.1:10809',
    );
    for (const p of raw.split(',').map((s) => s.trim()).filter(Boolean)) {
      pushProxy(p, `proxy:${p}`);
    }
  }

  candidates.push({ name: 'direct', ...goodcangAxiosConnectionOptions(config) });
  return candidates;
}
