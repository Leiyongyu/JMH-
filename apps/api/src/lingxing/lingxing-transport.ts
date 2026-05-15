import axios from 'axios';

const TLS_PROXY_HINT =
  '无法直连领星 HTTPS。若使用代理，请在 apps/api/.env 设置 LINGXING_HTTPS_PROXY=http://127.0.0.1:<你的代理端口>（以本机实际端口为准），或设置系统环境变量 HTTPS_PROXY；公司网络可能需要指定网关代理。';

const TIMEOUT_HINT =
  '走代理或大分页时较慢：可在 apps/api/.env 提高 LINGXING_TOKEN_TIMEOUT_MS（默认 90000）、LINGXING_HTTP_TIMEOUT_MS（默认 180000）。';

const PROXY_CONN_HINT =
  '本地代理未监听：请启动 Clash / V2Ray 并核对端口与 LINGXING_HTTPS_PROXY 一致（常见 7890、7897）。若走直连：将仓库根 `.env` 中 LINGXING_HTTPS_PROXY 留空，且设 LINGXING_AUTO_PROXY_CANDIDATES=false，然后重启 API。';
const PROXY_PROTOCOL_HINT =
  '代理协议不匹配：本项目仅支持 HTTP(S) 代理（如 Clash Mixed Port 的 http://127.0.0.1:7890）。若你配置的是 socks5，请改为 http 代理端口，或清空 LINGXING_HTTPS_PROXY 走直连后重启。';

function messageOf(err: unknown): string {
  if (axios.isAxiosError(err)) return `${err.message ?? ''} ${err.code ?? ''}`;
  if (err instanceof Error) return err.message;
  return String(err);
}

/** 可对齐重试的典型网络/超时抖动 */
export function isTransientLingxingTransportError(err: unknown): boolean {
  const blob = messageOf(err);
  // 不含 ECONNREFUSED：多为代理/端口未开，重试无意义
  return /Client network socket disconnected|secure TLS connection|TLS connection|ECONNRESET|ETIMEDOUT|ECONNABORTED|socket hang up|ENOTFOUND|EAI_AGAIN|certificate|SSL|timeout of [\d]+ms exceeded|timeout.*exceeded|timed out/i.test(
    blob,
  );
}

/** 把 Axios 失败包装成带排查指引的异常（业务层原样透出 message） */
export function wrapLingxingTransportError(err: unknown): Error {
  if (!axios.isAxiosError(err) && !(err instanceof Error)) {
    return new Error(String(err));
  }
  const base = axios.isAxiosError(err)
    ? err.message || err.code || 'request error'
    : (err as Error).message;
  const full = `${base} ${axios.isAxiosError(err) ? (err.code ?? '') : ''}`;
  if (/TLS|SSL|certificate|socket disconnected before secure TLS/i.test(full)) {
    return new Error(`${base} ${TLS_PROXY_HINT}`);
  }
  if (/timeout of [\d]+ms exceeded|timeout.*exceeded|timed out|ECONNABORTED/i.test(full)) {
    return new Error(`${base} ${TIMEOUT_HINT}`);
  }
  if (/ECONNREFUSED|connect ECONNREFUSED/i.test(full)) {
    return new Error(`${base} ${PROXY_CONN_HINT}`);
  }
  if (/CONNECT response/i.test(full)) {
    return new Error(`${base} ${PROXY_PROTOCOL_HINT}`);
  }
  return err instanceof Error ? err : new Error(String(err));
}

export async function withLingxingTransportRetries<T>(
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
      if (attempt < retries && isTransientLingxingTransportError(e)) {
        await new Promise((r) => setTimeout(r, baseDelayMs * (attempt + 1)));
        continue;
      }
      throw wrapLingxingTransportError(e);
    }
  }
  throw wrapLingxingTransportError(last);
}
