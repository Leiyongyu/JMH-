import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import { URL } from 'node:url';

export type EbayScrapeResult = {
  title?: string;
  description?: string;
  images: string[];
  sourceUrl: string;
};

@Injectable()
export class EbayItemPageService {
  private readonly logger = new Logger(EbayItemPageService.name);

  private assertSafeUrl(input: string): string {
    let u: URL;
    try {
      u = new URL(input);
    } catch {
      throw new BadRequestException('itemUrl 非法');
    }
    if (u.protocol !== 'https:' && u.protocol !== 'http:') {
      throw new BadRequestException('仅支持 http/https');
    }
    const host = u.hostname.toLowerCase();
    if (host === 'localhost' || host.endsWith('.localhost')) {
      throw new BadRequestException('不允许抓取本地域名');
    }
    if (host === '127.0.0.1' || host === '0.0.0.0') {
      throw new BadRequestException('不允许抓取本地地址');
    }
    if (!host.includes('ebay')) {
      throw new BadRequestException('仅允许抓取 eBay 链接');
    }
    return u.toString();
  }

  private extractMeta(html: string, attr: 'property' | 'name', key: string): string | null {
    const re = new RegExp(
      `<meta\\s+[^>]*${attr}=["']${key.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')}["'][^>]*content=["']([^"']+)["'][^>]*>`,
      'i',
    );
    const m = html.match(re);
    if (!m) return null;
    const v = m[1]?.trim();
    return v ? v : null;
  }

  private extractJsonLd(html: string): unknown[] {
    const out: unknown[] = [];
    const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(html))) {
      const raw = (m[1] ?? '').trim();
      if (!raw) continue;
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) out.push(...parsed);
        else out.push(parsed);
      } catch {
        continue;
      }
    }
    return out;
  }

  private normalizeImages(urls: string[]): string[] {
    const cleaned = urls
      .map((u) => (typeof u === 'string' ? u.trim() : ''))
      .filter(Boolean)
      .filter((u) => u.startsWith('http://') || u.startsWith('https://'));
    const unique = Array.from(new Set(cleaned));
    return unique.slice(0, 24);
  }

  async scrape(itemUrl: string): Promise<EbayScrapeResult> {
    const safeUrl = this.assertSafeUrl(itemUrl);
    const startedAt = Date.now();
    let html = '';
    try {
      const resp = await axios.get<string>(safeUrl, {
        responseType: 'text',
        timeout: 25_000,
        maxRedirects: 5,
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          Accept:
            'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
          'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
          'Cache-Control': 'no-cache',
          Pragma: 'no-cache',
        },
        validateStatus: (s) => (s >= 200 && s < 300) || s === 304,
      });
      html = String(resp.data ?? '');
    } catch (err: unknown) {
      const status = (err as { response?: { status?: number } })?.response?.status;
      const code = (err as { code?: string })?.code;
      if (typeof status === 'number') {
        throw new BadRequestException(`抓取失败：HTTP ${status}`);
      }
      if (typeof code === 'string' && code.trim()) {
        throw new BadRequestException(`抓取失败：网络错误 ${code}`);
      }
      throw new BadRequestException('抓取失败：未知网络错误');
    }
    if (!html || html.length < 2000) {
      throw new BadRequestException('抓取到的页面内容为空或过短，可能被拦截');
    }

    const jsonLd = this.extractJsonLd(html);
    let title: string | undefined;
    let description: string | undefined;
    const images: string[] = [];

    for (const node of jsonLd) {
      if (!node || typeof node !== 'object') continue;
      const o = node as Record<string, unknown>;
      const type = o['@type'];
      const types = Array.isArray(type) ? type : typeof type === 'string' ? [type] : [];
      if (!types.some((t) => String(t).toLowerCase() === 'product')) continue;

      const img = o.image;
      if (typeof img === 'string') images.push(img);
      if (Array.isArray(img)) {
        for (const it of img) {
          if (typeof it === 'string') images.push(it);
        }
      }
      if (!title && typeof o.name === 'string' && o.name.trim()) title = o.name.trim();
      if (!description && typeof o.description === 'string' && o.description.trim()) {
        description = o.description.trim();
      }
    }

    const ogTitle = this.extractMeta(html, 'property', 'og:title') ?? this.extractMeta(html, 'name', 'twitter:title');
    const ogDesc = this.extractMeta(html, 'property', 'og:description') ?? this.extractMeta(html, 'name', 'description');
    const ogImage = this.extractMeta(html, 'property', 'og:image') ?? this.extractMeta(html, 'name', 'twitter:image');
    if (!title && ogTitle) title = ogTitle;
    if (!description && ogDesc) description = ogDesc;
    if (ogImage) images.push(ogImage);

    const normalized = this.normalizeImages(images);
    const ms = Date.now() - startedAt;
    this.logger.log(`Scraped eBay page: images=${normalized.length} ms=${ms} url=${safeUrl}`);

    return {
      title,
      description: description ? description.slice(0, 2000) : undefined,
      images: normalized,
      sourceUrl: safeUrl,
    };
  }
}
