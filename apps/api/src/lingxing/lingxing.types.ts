export interface LingxingTokenData {
  access_token: string;
  refresh_token: string;
  expires_in: number;
}

export interface LingxingTokenResponse {
  code: string;
  msg?: string;
  data?: LingxingTokenData;
}

export interface LingxingApiResponse<T = unknown> {
  /** 多为 number 0；少数环境为字符串 "0" */
  code: number | string;
  msg?: string;
  message?: string;
  data?: T;
  total?: number;
}

export class LingxingNotConfiguredError extends Error {
  constructor() {
    super('领星 APP_ID / APP_SECRET 未配置，请在 .env 中填入 LINGXING_APP_ID 与 LINGXING_APP_SECRET');
    this.name = 'LingxingNotConfiguredError';
    
  }
}

export class LingxingApiError extends Error {
  constructor(
    public readonly code: number | string,
    message: string,
    public readonly raw?: unknown,
  ) {
    super(message);
    this.name = 'LingxingApiError';
  }
}
