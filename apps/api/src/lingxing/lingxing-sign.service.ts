import { Injectable } from '@nestjs/common';
import { createCipheriv, createHash } from 'node:crypto';

/**
 * 领星签名实现，对齐样例.py 的算法：
 * 1. 参数按 key 升序拼 canonical：value 为 ""跳过；为对象/数组使用紧凑且 key 有序的 JSON
 * 2. canonical → MD5 → 十六进制 → 转大写
 * 3. 以 APP_ID 为 AES-128-ECB(PKCS7) 密钥，对上一步结果加密
 * 4. 结果 Base64 即 sign
 */
@Injectable()
export class LingxingSignService {
  sign(params: Record<string, unknown>, appId: string): string {
    const canonical = this.formatParams(params);
    const md5Upper = createHash('md5').update(canonical, 'utf8').digest('hex').toUpperCase();
    return this.aesEcbEncryptBase64(md5Upper, appId);
  }

  private formatParams(params: Record<string, unknown>): string {
    const keys = Object.keys(params).sort();
    const parts: string[] = [];
    for (const k of keys) {
      const v = params[k];
      if (v === '' || v === undefined) continue;
      if (v === null) {
        parts.push(`${k}=null`);
        continue;
      }
      if (typeof v === 'object') {
        parts.push(`${k}=${JSON.stringify(v)}`);
      } else {
        parts.push(`${k}=${String(v)}`);
      }
    }
    return parts.join('&');
  }

  private aesEcbEncryptBase64(plaintext: string, key: string): string {
    const keyBuf = Buffer.from(key, 'utf8');
    const cipher = createCipheriv('aes-128-ecb', keyBuf, null);
    cipher.setAutoPadding(true);
    const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    return enc.toString('base64');
  }
}
