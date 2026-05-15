export interface GoodcangTokenData {
  access_token: string;
  token_type?: string;
  expires_in?: number;
}

export interface GoodcangTokenResponse {
  code?: number | string;
  msg?: string;
  message?: string;
  data?: GoodcangTokenData;
}

export interface GoodcangApiResponse<T = unknown> {
  code?: number | string;
  msg?: string;
  message?: string;
  data?: T;
  total?: number;
  count?: number;
}

export class GoodcangNotConfiguredError extends Error {
  constructor() {
    super('谷仓 APP_KEY / APP_SECRET 未配置，请在 .env 中填入 GOODCANG_APP_KEY 与 GOODCANG_APP_SECRET');
    this.name = 'GoodcangNotConfiguredError';
  }
}

export class GoodcangApiError extends Error {
  constructor(
    public readonly code: number | string,
    message: string,
    public readonly raw?: unknown,
  ) {
    super(message);
    this.name = 'GoodcangApiError';
  }
}

export interface GoodcangCreateOrderResult {
  order_id: string;
  order_no: string;
  tracking_number?: string;
}

export interface GoodcangTrackingResult {
  order_id: string;
  tracking_number: string;
  carrier?: string;
  shipping_method?: string;
  status?: string;
}
