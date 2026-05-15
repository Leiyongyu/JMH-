import * as dns from 'node:dns';
import * as https from 'node:https';
import type { LookupFunction } from 'node:net';
import type { ConfigService } from '@nestjs/config';
import type { AxiosRequestConfig } from 'axios';
import { HttpsProxyAgent } from 'https-proxy-agent';

/**
 * 减轻「Client network socket disconnected before secure TLS connection was established」：
 * - 默认对领星域名 IPv4 优先（部分网络 IPv6 不可达会断在 TLS 握手前）
 * - 可选走 HTTP(S) 代理（公司网、本机 Clash 等）
 */
export function lingxingAxiosConnectionOptions(
  config: ConfigService,
): Pick<AxiosRequestConfig, 'httpsAgent' | 'proxy'> {
  const proxyRaw =
    config.get<string>('LINGXING_HTTPS_PROXY')?.trim() ||
    config.get<string>('LINGXING_HTTP_PROXY')?.trim() ||
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

  const ipv4First = config.get<string>('LINGXING_IPV4_FIRST', 'true').toLowerCase() !== 'false';
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

export interface LingxingConnectionCandidate
  extends Pick<AxiosRequestConfig, 'httpsAgent' | 'proxy'> {
  name: string;
}

function lingxingAxiosDirectOptions(
  config: ConfigService,
): Pick<AxiosRequestConfig, 'httpsAgent' | 'proxy'> {
  const ipv4First = config.get<string>('LINGXING_IPV4_FIRST', 'true').toLowerCase() !== 'false';
  if (!ipv4First) {
    return { proxy: false };
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

/**
 * 连接策略优先级：
 * 1) 显式配置的 LINGXING_HTTPS_PROXY
 * 2) 常见本地代理端口（可关闭）
 * 3) 直连 IPv4
 */
export function lingxingAxiosConnectionCandidates(
  config: ConfigService,
): LingxingConnectionCandidate[] {
  const candidates: LingxingConnectionCandidate[] = [];
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
    config.get<string>('LINGXING_HTTPS_PROXY')?.trim() ||
    config.get<string>('LINGXING_HTTP_PROXY')?.trim() ||
    process.env.HTTPS_PROXY?.trim() ||
    process.env.HTTP_PROXY?.trim() ||
    '';
  if (explicitProxy) {
    pushProxy(explicitProxy, `proxy:${explicitProxy}`);
  }

  const autoProxyEnabled =
    String(config.get<string>('LINGXING_AUTO_PROXY_CANDIDATES', 'false')).toLowerCase() === 'true';
  if (autoProxyEnabled) {
    const raw = config.get<string>(
      'LINGXING_PROXY_CANDIDATES',
      'http://127.0.0.1:7890,http://127.0.0.1:7897,http://127.0.0.1:10809',
    );
    for (const p of raw.split(',').map((s) => s.trim()).filter(Boolean)) {
      pushProxy(p, `proxy:${p}`);
    }
  }

  // fallback: direct (ignore proxy env to allow "proxy broken but direct works")
  candidates.push({ name: 'direct', ...lingxingAxiosDirectOptions(config) });
  return candidates;
}
