import type { ConfigService } from '@nestjs/config';

const MIN_MS = 5_000;

/** 读取 axios timeout，非法或过小时回退默认值 */
export function lingxingAxiosTimeout(config: ConfigService, envKey: string, fallbackMs: number): number {
  const n = Number(config.get(envKey, fallbackMs));
  if (!Number.isFinite(n)) return fallbackMs;
  return n < MIN_MS ? fallbackMs : Math.floor(n);
}
