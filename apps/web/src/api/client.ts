import axios from 'axios';

const baseURL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3001/api/v1';

export const api = axios.create({
  baseURL,
  timeout: 30_000,
});

const TOKEN_KEY = 'ds.auth.token';

export function setToken(token: string | null) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

/** 浏览器控制台日志开关 —— 生产环境可设为 false */
const LOG_ENABLED = true;
const RETRY_MARK = '__loopbackRetried';

function swapLoopbackBaseURL(input: string | undefined): string | null {
  if (!input) return null;
  try {
    const u = new URL(input);
    if (u.hostname === '127.0.0.1') {
      u.hostname = 'localhost';
      return u.toString();
    }
    if (u.hostname === 'localhost') {
      u.hostname = '127.0.0.1';
      return u.toString();
    }
    return null;
  } catch {
    return null;
  }
}

api.interceptors.request.use((config) => {
  const token = getToken();
  if (token) {
    config.headers = config.headers ?? {};
    (config.headers as Record<string, string>).Authorization = `Bearer ${token}`;
  }
  if (LOG_ENABLED && config.method) {
    const params = config.params
      ? '?' + new URLSearchParams(config.params as Record<string, string>).toString()
      : '';
    console.log(
      `%c[REQ] %c${config.method.toUpperCase()} %c${config.url}${params}`,
      'color:#888',
      'color:#1976d2;font-weight:bold',
      'color:#333',
    );
  }
  return config;
});

api.interceptors.response.use(
  (resp) => {
    if (LOG_ENABLED) {
      const data =
        typeof resp.data === 'object'
          ? JSON.stringify(resp.data).substring(0, 200) + (JSON.stringify(resp.data).length > 200 ? '…' : '')
          : String(resp.data).substring(0, 200);
      console.log(
        `%c[RES] %c${resp.status} %c${resp.config.url} %c↓ ${data}`,
        'color:#888',
        resp.status < 300 ? 'color:#388e3c;font-weight:bold' : 'color:#f57c00;font-weight:bold',
        'color:#333',
        'color:#666;font-size:11px',
      );
    }
    return resp;
  },
  async (err) => {
    const req = err.config;
    if (LOG_ENABLED) {
      const status = err?.response?.status ?? 'NETWORK';
      const msg =
        err?.response?.data?.message ?? err?.response?.data?.error ?? err.message ?? 'Unknown error';
      console.error(
        `%c[ERR] %c${status} %c${req?.url ?? ''} %c${typeof msg === 'string' ? msg : JSON.stringify(msg).substring(0, 300)}`,
        'color:#888',
        'color:#d32f2f;font-weight:bold',
        'color:#333',
        'color:#c62828;font-size:11px',
      );
    }
    // 开发常见：localhost 与 127.0.0.1 混用导致网络层失败，这里自动切换主机重试一次
    if (err?.code === 'ERR_NETWORK' && req && !req[RETRY_MARK]) {
      const currentBase = String(req.baseURL ?? baseURL);
      const fallbackBase = swapLoopbackBaseURL(currentBase);
      if (fallbackBase) {
        req.baseURL = fallbackBase;
        req[RETRY_MARK] = true;
        if (LOG_ENABLED) {
          console.warn(
            `%c[RETRY] %cNETWORK%c switch baseURL -> ${fallbackBase}`,
            'color:#888',
            'color:#ef6c00;font-weight:bold',
            'color:#333',
          );
        }
        return api.request(req);
      }
    }
    if (err?.response?.status === 401) {
      setToken(null);
      if (location.pathname !== '/login') {
        location.href = '/login';
      }
    }
    return Promise.reject(err);
  },
);
