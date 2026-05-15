/**
 * 领星「库存明细」字段 → 本地 InventoryLine 字段映射。
 *
 * 按企业实际 OpenAPI 文档调整字段名即可；路径用 env LINGXING_INVENTORY_PATH，默认与代码一致：
 * /erp/sc/routing/data/local_inventory/inventoryDetails
 * - 字段名：以下使用最常见的命名（sku、msku、warehouse_id、warehouse_name、available_qty 等）
 *   若实际接口字段名不同，仅需修改此文件，业务层不变。
 */
export interface RawLingxingInventoryItem {
  // 你提供的库存明细示例字段
  wid?: string | number;
  product_id?: string | number;
  sku?: string;
  msku?: string;
  fnsku?: string;
  seller_id?: string | number;
  /** 兼容不同接口命名的 SKU */
  seller_sku?: string;
  local_sku?: string;
  product_sku?: string;
  commodity_sku?: string;
  product_total?: number | string;
  product_valid_num?: number | string;
  product_bad_num?: number | string;
  product_qc_num?: number | string;
  product_lock_num?: number | string;
  product_onway?: number | string;
  average_age?: number | string;
  stock_age_list?: unknown[];

  // 历史兼容字段（不同企业接口可能返回）
  platform?: string;
  marketplace?: string;
  warehouse_id?: string | number;
  warehouse_code?: string;
  warehouse_name?: string;
  available_qty?: number | string;
  available?: number | string;
  reserved_qty?: number | string;
  reserved?: number | string;
  inbound_qty?: number | string;
  on_way_qty?: number | string;
  [k: string]: unknown;
}

export interface NormalizedInventoryLine {
  sku: string;
  platform: string;
  warehouseCode: string;
  warehouseName: string | null;
  availableQty: number;
  reservedQty: number;
  inboundQty: number;
  rawPayload: Record<string, unknown>;
}

const num = (v: unknown): number => {
  if (v === undefined || v === null || v === '') return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

export function mapInventoryItem(
  raw: RawLingxingInventoryItem,
  warehouseNameMap?: Record<string, string>,
): NormalizedInventoryLine | null {
  const skuRaw =
    raw.sku ?? raw.msku ?? raw.seller_sku ?? raw.local_sku ?? raw.product_sku ?? raw.commodity_sku ?? '';
  const sku = skuRaw.toString().trim();
  if (!sku) return null;
  const platform = String(raw.platform ?? raw.marketplace ?? 'LINGXING').trim() || 'LINGXING';
  const warehouseCode = String(raw.wid ?? raw.warehouse_id ?? raw.warehouse_code ?? 'DEFAULT').trim() || 'DEFAULT';
  const nameFromMap = (warehouseNameMap?.[warehouseCode] ?? '').trim();
  const warehouseName = nameFromMap || null;
  return {
    sku,
    platform: platform.toUpperCase(),
    warehouseCode,
    warehouseName,
    // 优先使用你给的库存明细字段；没有时再回退兼容字段
    availableQty: num(raw.product_valid_num ?? raw.available_qty ?? raw.available),
    reservedQty: num(raw.product_lock_num ?? raw.reserved_qty ?? raw.reserved),
    inboundQty: num(raw.product_onway ?? raw.inbound_qty ?? raw.on_way_qty),
    rawPayload: raw as Record<string, unknown>,
  };
}
