import * as dns from 'node:dns';
import * as https from 'node:https';
import type { LookupFunction } from 'node:net';
import type { ConfigService } from '@nestjs/config';
import type { AxiosRequestConfig } from 'axios';
import { HttpsProxyAgent } from 'https-proxy-agent';

let cachedKey = '';
let cached: Pick<AxiosRequestConfig, 'httpsAgent' | 'proxy'> = {};

export function ebayAxiosConnectionOptions(
  config: ConfigService,
): Pick<AxiosRequestConfig, 'httpsAgent' | 'proxy'> {
  const proxyRaw =
    config.get<string>('EBAY_HTTPS_PROXY')?.trim() ||
    config.get<string>('EBAY_HTTP_PROXY')?.trim() ||
    config.get<string>('LINGXING_HTTPS_PROXY')?.trim() ||
    config.get<string>('LINGXING_HTTP_PROXY')?.trim() ||
    process.env.HTTPS_PROXY?.trim() ||
    process.env.HTTP_PROXY?.trim() ||
    '';

  const ipv4First = config.get<string>('EBAY_IPV4_FIRST', 'true').toLowerCase() !== 'false';
  const key = `${proxyRaw}::${ipv4First ? 'v4' : 'any'}`;
  if (key && key === cachedKey) return cached;

  if (proxyRaw) {
    try {
      const agent = new HttpsProxyAgent(proxyRaw);
      cachedKey = key;
      cached = { httpsAgent: agent as unknown as https.Agent, proxy: false };
      return cached;
    } catch {
      // ignore invalid proxy URL
    }
  }

  if (!ipv4First) {
    cachedKey = key;
    cached = {};
    return cached;
  }

  const lookup: LookupFunction = (hostname, opts, cb) =>
    dns.lookup(hostname, { ...opts, family: 4 }, cb);

  cachedKey = key;
  cached = {
    httpsAgent: new https.Agent({
      keepAlive: true,
      keepAliveMsecs: 30_000,
      lookup,
    }),
    proxy: false,
  };
  return cached;
}
