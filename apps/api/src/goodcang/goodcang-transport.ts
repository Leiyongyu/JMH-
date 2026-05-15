import axios from 'axios';

const PROXY_HINT =
  '无法直连谷仓 HTTPS。若使用代理，请在 apps/api/.env 设置 GOODCANG_HTTPS_PROXY=http://127.0.0.1:<你的代理端口>，或设置系统环境变量 HTTPS_PROXY。';

const TIMEOUT_HINT =
  '走代理或大分页时较慢：可在 apps/api/.env 提高 GOODCANG_TOKEN_TIMEOUT_MS（默认 90000）、GOODCANG_HTTP_TIMEOUT_MS（默认 180000）。';

const PROXY_CONN_HINT =
  '本地代理未监听：请先启动代理并确认端口与 GOODCANG_HTTPS_PROXY 一致。若暂不走代理，先在 apps/api/.env 注释或删除该 GOODCANG_HTTPS_PROXY 行改直连后重启 API。';

function messageOf(err: unknown): string {
  if (axios.isAxiosError(err)) return `${err.message ?? ''} ${err.code ?? ''}`;
  if (err instanceof Error) return err.message;
  return String(err);
}

export function isTransientGoodcangTransportError(err: unknown): boolean {
  const blob = messageOf(err);
  return /Client network socket disconnected|secure TLS connection|TLS connection|ECONNRESET|ETIMEDOUT|ECONNABORTED|socket hang up|ENOTFOUND|EAI_AGAIN|certificate|SSL|timeout of [\d]+ms exceeded|timeout.*exceeded|timed out/i.test(
    blob,
  );
}

export function wrapGoodcangTransportError(err: unknown): Error {
  if (!axios.isAxiosError(err) && !(err instanceof Error)) {
    return new Error(String(err));
  }
  const base = axios.isAxiosError(err)
    ? err.message || err.code || 'request error'
    : (err as Error).message;
  const full = `${base} ${axios.isAxiosError(err) ? (err.code ?? '') : ''}`;
  if (/TLS|SSL|certificate|socket disconnected before secure TLS/i.test(full)) {
    return new Error(`${base} ${PROXY_HINT}`);
  }
  if (/timeout of [\d]+ms exceeded|timeout.*exceeded|timed out|ECONNABORTED/i.test(full)) {
    return new Error(`${base} ${TIMEOUT_HINT}`);
  }
  if (/ECONNREFUSED|connect ECONNREFUSED/i.test(full)) {
    return new Error(`${base} ${PROXY_CONN_HINT}`);
  }
  return err instanceof Error ? err : new Error(String(err));
}

export async function withGoodcangTransportRetries<T>(
  run: () => Promise<T>,
  options: { retries: number; baseDelayMs: number },
): Promise<T> {
  const { retries, baseDelayMs } = options;
  let last: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await run();
    } catch (e) {
      last = e;
      if (attempt < retries && isTransientGoodcangTransportError(e)) {
        await new Promise((r) => setTimeout(r, baseDelayMs * (attempt + 1)));
        continue;
      }
      throw wrapGoodcangTransportError(e);
    }
  }
  throw wrapGoodcangTransportError(last);
}
