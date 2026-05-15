import { Injectable } from '@nestjs/common';
import { createHmac } from 'node:crypto';

@Injectable()
export class GoodcangSignService {
  sign(params: Record<string, unknown>, appSecret: string): string {
    const canonical = this.formatParams(params);
    return createHmac('sha256', appSecret).update(canonical, 'utf8').digest('hex');
  }

  private formatParams(params: Record<string, unknown>): string {
    const keys = Object.keys(params).sort();
    const parts: string[] = [];
    for (const k of keys) {
      const v = params[k];
      if (v === '' || v === undefined || v === null) continue;
      if (typeof v === 'object') {
        parts.push(`${k}=${this.stableStringify(v)}`);
      } else {
        parts.push(`${k}=${String(v)}`);
      }
    }
    return parts.join('&');
  }

  private stableStringify(value: unknown): string {
    if (value === null || typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) {
      return '[' + value.map((v) => this.stableStringify(v)).join(',') + ']';
    }
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    return (
      '{' +
      keys
        .map((k) => JSON.stringify(k) + ':' + this.stableStringify(obj[k]))
        .join(',') +
      '}'
    );
  }
}
