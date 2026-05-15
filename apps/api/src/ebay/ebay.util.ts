import { BadRequestException } from '@nestjs/common';
import { URL } from 'node:url';
import type { EbayMarketplaceId } from './ebay.types';

export function extractLegacyItemIdFromItemUrl(itemUrl: string): string {
  let u: URL;
  try {
    u = new URL(itemUrl);
  } catch {
    throw new BadRequestException('itemUrl 非法');
  }

  const m = u.pathname.match(/\/itm\/(?:[^/]+\/)?(\d{9,20})(?:\/|$)/i);
  if (m?.[1]) return m[1];
  const tail = u.pathname.match(/\/(\d{9,20})(?:\/|$)/);
  if (tail?.[1]) return tail[1];

  throw new BadRequestException('无法从 itemUrl 解析出 legacyItemId');
}

export function marketplaceIdFromUrl(itemUrl: string): EbayMarketplaceId {
  let u: URL;
  try {
    u = new URL(itemUrl);
  } catch {
    return 'EBAY_US';
  }
  const host = u.hostname.toLowerCase();
  if (host.endsWith('ebay.co.uk')) return 'EBAY_GB';
  if (host.endsWith('ebay.de')) return 'EBAY_DE';
  if (host.endsWith('ebay.com.au')) return 'EBAY_AU';
  if (host.endsWith('ebay.ca')) return 'EBAY_CA';
  if (host.endsWith('ebay.fr')) return 'EBAY_FR';
  if (host.endsWith('ebay.it')) return 'EBAY_IT';
  if (host.endsWith('ebay.es')) return 'EBAY_ES';
  return 'EBAY_US';
}

