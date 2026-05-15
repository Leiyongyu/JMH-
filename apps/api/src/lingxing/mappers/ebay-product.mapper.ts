/**
 * 领星「eBay 商品」字段 → 本地 EbayProduct 字段映射。
 *
 * TODO（按你企业开通的实际响应调整）：
 * - 路径：通过 env LINGXING_EBAY_PRODUCT_PATH 注入，默认与 get_ebay_products.py 一致：/basicOpen/multiplatform/ebay/list
 * - 字段：sku/title/quantity/price/currency/item_url 在不同版本接口可能命名不同（item_id / view_url / start_price 等）
 */
export interface RawLingxingEbayItem {
  sku?: string;
  msku?: string;
  seller_sku?: string;
  item_sku?: string;
  platform_sku?: string;
  title?: string;
  item_title?: string;
  product_title?: string;
  name?: string;
  stock?: number | string;
  quantity?: number | string;
  available_quantity?: number | string;
  available_qty?: number | string;
  inventory?: number | string;
  price?: number | string;
  start_price?: number | string;
  sale_price?: number | string;
  item_price?: number | string;
  currency?: string;
  currency_code?: string;
  curr_code?: string;
  item_url?: string;
  view_item_url?: string;
  view_url?: string;
  ebay_url?: string;
  listing_url?: string;
  item_id?: string | number;
  lingxing_product_id?: string | number;
  product_id?: string | number;
  listing_status?: string | number;
  item_status?: string | number;
  online_status?: string | number;
  lifecycle_status?: string | number;
  [k: string]: unknown;
}

export interface NormalizedEbayProduct {
  sku: string;
  title: string | null;
  stockQty: number;
  price: string;
  currency: string;
  itemUrl: string | null;
  lingxingProductId: string | null;
  status: string | null;
  rawPayload: Record<string, unknown>;
}

const num = (v: unknown): number => {
  if (v === undefined || v === null || v === '') return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

const decimalString = (v: unknown): string => {
  if (v === undefined || v === null || v === '') return '0';
  const n = Number(v);
  if (!Number.isFinite(n)) return '0';
  return n.toFixed(2);
};

/** 入库状态：分销商列表只筛 ACTIVE（在售） */
export const EBAY_STORAGE_STATUS_ON_SALE = 'ACTIVE';
export const EBAY_STORAGE_STATUS_OFF_SHELF = 'INACTIVE';

const STATUS_CANDIDATE_KEYS = [
  'status',
  'listing_status',
  'item_status',
  'online_status',
  'lifecycle_status',
  'ebay_status',
  'sale_status',
  'life_cycle',
  'is_online',
  'is_online_listing',
  'on_sale',
  'listingStatus',
  'lifecycleStatus',
  'onlineStatus',
  'ebayListingStatus',
  'saleStatus',
] as const;

function collectStatusCandidates(raw: RawLingxingEbayItem): unknown[] {
  const row = raw as Record<string, unknown>;
  const out: unknown[] = [];
  for (const key of STATUS_CANDIDATE_KEYS) {
    const v = row[key];
    if (v !== undefined && v !== null && v !== '') out.push(v);
  }
  return out;
}

function normalizedText(v: unknown): string {
  return String(v ?? '')
    .trim()
    .toLowerCase();
}

function inferCurrencyFromSite(raw: Record<string, unknown>): string | null {
  const siteCodeRaw =
    (raw.site_code ?? raw.siteCode ?? raw.site ?? raw.site_id ?? raw.siteId ?? raw.site_name ?? raw.siteName ?? '')
      .toString()
      .trim();
  if (!siteCodeRaw) return null;
  const s = siteCodeRaw.toUpperCase();
  const token = s.includes('-') ? s.split('-').pop() ?? s : s;
  const t = token.trim();

  if (t === 'UK' || s.includes('英国')) return 'GBP';
  if (t === 'US' || s.includes('美国')) return 'USD';
  if (t === 'AU' || s.includes('澳大利亚')) return 'AUD';
  if (t === 'CA' || s.includes('加拿大')) return 'CAD';
  if (
    [
      'DE',
      'FR',
      'IT',
      'ES',
      'NL',
      'BE',
      'IE',
      'AT',
      'FI',
      'PT',
      'GR',
      'LU',
    ].includes(t) ||
    ['德国', '法国', '意大利', '西班牙', '荷兰', '比利时', '爱尔兰', '奥地利', '芬兰', '葡萄牙', '希腊'].some((x) => s.includes(x))
  )
    return 'EUR';

  return null;
}

/**
 * 从领星多平台 ebay list 单行解析在售/已下架写入本地。
 *
 * IMPORTANT：对所有返回行都做 upsert 并写入 ACTIVE/INACTIVE；若以前在「只拉在售」模式下跳过下架行，
 * 已下架 SKU 会一直留在本地的 ACTIVE（僵尸），分销商看到的在售总数会明显高于领星。
 */
export function deriveEbayStorageStatus(raw: RawLingxingEbayItem): typeof EBAY_STORAGE_STATUS_ON_SALE | typeof EBAY_STORAGE_STATUS_OFF_SHELF {
  const vals = collectStatusCandidates(raw);
  /** 任一候选字段明示下架优先 */
  for (const v of vals) {
    if (typeof v === 'boolean' && !v) return EBAY_STORAGE_STATUS_OFF_SHELF;
    if (v === 0 || v === 2 || v === 3) return EBAY_STORAGE_STATUS_OFF_SHELF;
    const s = normalizedText(v);
    if (s === '0' || s === '2' || s === '3') return EBAY_STORAGE_STATUS_OFF_SHELF;
    if (s.includes('下架')) return EBAY_STORAGE_STATUS_OFF_SHELF;
    if (
      [
        'inactive',
        'offline',
        'ended',
        'closed',
        'close',
        'inactive_listing',
        'unpublished',
        'sold_out',
        'deleted',
      ].includes(s)
    )
      return EBAY_STORAGE_STATUS_OFF_SHELF;
  }

  for (const v of vals) {
    if (typeof v === 'boolean' && v) return EBAY_STORAGE_STATUS_ON_SALE;
    if (v === 1) return EBAY_STORAGE_STATUS_ON_SALE;
    const s = normalizedText(v);
    if (s === '1') return EBAY_STORAGE_STATUS_ON_SALE;
    if (['在售', '已上架', '上架', '出售中', '售卖中'].includes(s)) return EBAY_STORAGE_STATUS_ON_SALE;
    if (
      ['active', 'online', 'on_sale', 'onsale', 'enabled', 'live', 'published'].includes(s) ||
      /^active\b/.test(s) ||
      /^online\b/.test(s)
    )
      return EBAY_STORAGE_STATUS_ON_SALE;
  }

  /** 无明确状态时保守下架，宁可少收录也不要把未知行算作在售拉高数量 */
  return EBAY_STORAGE_STATUS_OFF_SHELF;
}

/** 列表/统计用（与 deriveEbayStorageStatus 一致） */
export function ebayRawListingIsOnSale(raw: RawLingxingEbayItem): boolean {
  return deriveEbayStorageStatus(raw) === EBAY_STORAGE_STATUS_ON_SALE;
}

export function mapEbayItem(raw: RawLingxingEbayItem): NormalizedEbayProduct | null {
  const sku = (raw.sku ?? raw.msku ?? raw.seller_sku ?? raw.item_sku ?? raw.platform_sku ?? '').toString().trim();
  if (!sku) return null;

  const row = raw as Record<string, unknown>;
  const currencyCandidate = (
    row.currency ??
    row.currency_code ??
    row.curr_code ??
    row.currencyCode ??
    row.currCode ??
    row.price_currency ??
    row.priceCurrency ??
    row.listing_currency ??
    row.listingCurrency ??
    ''
  )
    .toString()
    .trim()
    .toUpperCase();

  const inferredCurrency = inferCurrencyFromSite(row);
  const finalCurrency = currencyCandidate || inferredCurrency || 'USD';

  return {
    sku,
    title: (raw.title ?? raw.item_title ?? raw.product_title ?? raw.name ?? null) as string | null,
    stockQty: num(raw.stock ?? raw.quantity ?? raw.available_quantity ?? raw.available_qty ?? raw.inventory),
    price: decimalString(raw.price ?? raw.start_price ?? raw.sale_price ?? raw.item_price),
    currency: finalCurrency,
    itemUrl: (raw.item_url ?? raw.view_item_url ?? raw.view_url ?? raw.ebay_url ?? raw.listing_url ?? null) as string | null,
    lingxingProductId: raw.lingxing_product_id
      ? String(raw.lingxing_product_id)
      : raw.product_id
        ? String(raw.product_id)
        : raw.item_id
          ? String(raw.item_id)
          : null,
    status: deriveEbayStorageStatus(raw),
    rawPayload: raw as Record<string, unknown>,
  };
}
