import axios from 'axios';
import * as dotenv from 'dotenv';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { LingxingSignService } from '../lingxing/lingxing-sign.service';

type LingxingApiResponse<T> = {
  code: number | string;
  msg?: string;
  message?: string;
  data?: T;
};

type SellerListData = {
  total?: number | string;
  list?: Array<{
    store_id: string;
    store_name?: string;
    platform_code?: number | string;
    platform_name?: string;
    currency?: string;
    is_sync?: number;
    status?: number;
    sid?: string;
  }>;
};

function env(key: string, def = ''): string {
  return (process.env[key] ?? def).toString().trim();
}

async function getAccessToken(baseUrl: string, agent?: unknown): Promise<string> {
  const appId = env('LINGXING_APP_ID');
  const appSecret = env('LINGXING_APP_SECRET');
  if (!appId || !appSecret) throw new Error('LINGXING_APP_ID / LINGXING_APP_SECRET is empty');
  const url = `${baseUrl}/api/auth-server/oauth/access-token`;
  const body = new URLSearchParams({ appId, appSecret });
  const res = await axios.post<LingxingApiResponse<{ access_token: string } & Record<string, unknown>>>(
    url,
    body.toString(),
    {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      httpsAgent: agent as any,
      timeout: 90_000,
    },
  );
  const token = (res.data as any)?.data?.access_token as string | undefined;
  if (!token) throw new Error(`token failed: ${JSON.stringify(res.data)}`);
  return token;
}

async function main() {
  dotenv.config({ path: env('DOTENV_FILE', '.env') });

  const baseUrl = env('LINGXING_BASE_URL', 'https://openapi.lingxing.com');
  const proxy = env('LINGXING_HTTPS_PROXY');
  const agent = proxy ? new HttpsProxyAgent(proxy) : undefined;

  const appId = env('LINGXING_APP_ID');
  const token = await getAccessToken(baseUrl, agent);
  const signService = new LingxingSignService();

  const body: Record<string, unknown> = {
    offset: 0,
    length: 200,
  };

  const platformCodeArg = process.argv[2];
  if (platformCodeArg) {
    const n = Number(platformCodeArg);
    body.platform_code = [Number.isFinite(n) ? n : platformCodeArg];
  }

  const isSyncArg = process.argv[3];
  if (isSyncArg) body.is_sync = Number(isSyncArg);

  const statusArg = process.argv[4];
  if (statusArg) body.status = Number(statusArg);

  const baseQuery: Record<string, unknown> = {
    app_key: appId,
    timestamp: String(Math.floor(Date.now() / 1000)),
    access_token: token,
  };
  const signParams = { ...baseQuery, ...body };
  const sign = signService.sign(signParams, appId);
  const finalQuery = { ...baseQuery, sign };

  const res = await axios.post<LingxingApiResponse<SellerListData>>(
    `${baseUrl}/pb/mp/shop/v2/getSellerList`,
    body,
    {
      params: finalQuery,
      headers: { 'Content-Type': 'application/json' },
      httpsAgent: agent as any,
      timeout: 180_000,
    },
  );

  const code = res.data?.code;
  const ok = code === 0 || code === '0' || Number(code) === 0;
  if (!ok) {
    throw new Error(`getSellerList failed: ${JSON.stringify(res.data)}`);
  }

  const list = res.data?.data?.list ?? [];
  console.log(`total=${res.data?.data?.total ?? list.length}`);
  for (const it of list) {
    console.log(
      JSON.stringify(
        {
          store_id: it.store_id,
          store_name: it.store_name ?? '',
          platform_code: it.platform_code ?? '',
          platform_name: it.platform_name ?? '',
          currency: it.currency ?? '',
          is_sync: it.is_sync ?? '',
          status: it.status ?? '',
          sid: it.sid ?? '',
        },
        null,
        0,
      ),
    );
  }
}

main().catch((e) => {
  console.error(e?.response?.status, e?.response?.data || e.message);
  process.exit(1);
});

