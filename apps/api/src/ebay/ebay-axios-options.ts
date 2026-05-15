import * as dns from 'node:dns';
import * as https from 'node:https';
import type { LookupFunction } from 'node:net';
import type { ConfigService } from '@nestjs/config';
import type { AxiosRequestConfig } from 'axios';
import { HttpsProxyAgent } from 'https-proxy-agent';

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

  if (proxyRaw) {
    try {
      const agent = new HttpsProxyAgent(proxyRaw);
      return { httpsAgent: agent, proxy: false };
    } catch {
      // ignore invalid proxy URL
    }
  }

  const ipv4First = config.get<string>('EBAY_IPV4_FIRST', 'true').toLowerCase() !== 'false';
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

