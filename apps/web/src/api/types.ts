export type UserRole = 'ADMIN' | 'DISTRIBUTOR';

export interface AuthUser {
  id: string;
  email: string;
  phone?: string | null;
  role: UserRole;
  displayName?: string | null;
}

export interface AdminUser {
  id: string;
  email: string;
  phone: string | null;
  role: UserRole;
  displayName: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface JwtMe {
  sub: string;
  email: string;
  phone?: string;
  role: UserRole;
  displayName?: string;
}

export interface InventorySummary {
  lastSyncedAt: string | null;
  totalSku: number;
  lowStockSku: number;
  platformCount: number;
  platforms: Array<{ platform: string; available: number }>;
  threshold: number;
}

export interface InventoryLine {
  id: string;
  sku: string;
  platform: string;
  warehouseCode: string;
  warehouseName?: string | null;
  availableQty: number;
  reservedQty: number;
  inboundQty: number;
  syncedAt: string;
}

export interface EbayProduct {
  id: string;
  sku: string;
  title?: string | null;
  stockQty: number;
  availableQty?: number | null;
  price: string;
  currency: string;
  rmbPrice?: string | null;
  itemUrl?: string | null;
  syncedAt: string;
  status?: 'ACTIVE' | 'INACTIVE' | 'ENDED' | string;
  rawPayload?: Record<string, unknown> | null;
}

export interface OrderLine {
  id: string;
  sku: string;
  titleSnapshot?: string | null;
  qty: number;
  unitPriceSnapshot: string;
  currencySnapshot: string;
  itemUrlSnapshot?: string | null;
}

export interface ShippingAddress {
  orderNo?: string;
  recipientName: string;
  phone: string;
  postalCode?: string | null;
  countryRegion: string;
  stateProvince: string;
  city: string;
  district?: string | null;
  addressLine: string;
}

export interface DistributorOrder {
  id: string;
  orderNo: string;
  buyerUserId: string;
  snapshotBuyerEmail: string;
  snapshotBuyerName?: string | null;
  status: 'CREATED' | 'CANCELLED';
  lingxingStatus?: number | null;
  lingxingStatusText?: string | null;
  lingxingCheckedAt?: string | null;
  lingxingGlobalOrderNo?: string | null;
  totalAmount: string;
  currencySnapshot: string;
  remark?: string | null;
  shipWarehouseCode?: string | null;
  shipWarehouseName?: string | null;
  shipWarehouseWid?: number | null;
  createdAt: string;
  lines?: OrderLine[];
  shippingAddress?: ShippingAddress;
  lingxing?: {
    pushStatus: 'PENDING' | 'SUCCESS' | 'FAILED' | string;
    globalOrderNo: string | null;
    status: number | null;
    statusText: string | null;
    checkedAt: string | null;
    lastError?: string | null;
    pushAttempts?: number;
    lastPushedAt?: string | null;
  } | null;
}

export interface SyncRun {
  id: string;
  type: 'INVENTORY' | 'EBAY_PRODUCT' | 'EBAY_OFFICIAL_PRODUCT' | 'LINGXING_WAREHOUSE' | 'LINGXING_ORDER_STATUS';
  status: 'RUNNING' | 'SUCCESS' | 'FAILED';
  startedAt: string;
  finishedAt?: string | null;
  successCount: number;
  errorCount: number;
  processedCount: number;
  totalCount: number;
  detailSummary?: string | null;
  errorMessage?: string | null;
  triggeredBy?: string | null;
}

export interface EbayOfficialProductMain {
  sku: string;
  item_id: string;
  title: string;
  short_description: string | null;
  price_value: string;
  price_currency: string;
  condition: string | null;
  condition_id: string | null;
  brand: string | null;
  gtin: string | null;
  category_path: string | null;
  category_id: string | null;
  seller_username: string | null;
  seller_feedback_score: number | null;
  seller_feedback_percentage: string | null;
  seller_account_type: string | null;
  item_web_url: string | null;
  item_creation_date: string | null;
  last_sync_time: string | null;
}

export interface EbayOfficialProductDetail {
  sku: string;
  item_id: string;
  aspect_name: string;
  aspect_value: string;
  aspect_type: string | null;
}

export interface EbayOfficialProductVehicle {
  sku: string;
  item_id: string;
  brand: string;
  model: string;
  year_range: string | null;
  platform: string | null;
  vehicle_type: string | null;
  engine: string | null;
  restriction: string | null;
}

export interface EbayOfficialProductBundle {
  main: EbayOfficialProductMain | null;
  details: EbayOfficialProductDetail[];
  vehicles: EbayOfficialProductVehicle[];
}

export interface EbayBrowseBasicInfo {
  title: string | null;
  priceValue: string | null;
  priceCurrency: string | null;
  condition: string | null;
  sellerUsername: string | null;
  availabilityStatus: string | null;
  itemWebUrl: string | null;
}

export interface EbayItemSpecificRow {
  name: string;
  value: string;
}

export interface EbayTradingVehicleRow {
  Marke: string | null;
  Modell: string | null;
  Baujahr: string | null;
  Plattform: string | null;
  Typ: string | null;
  Motor: string | null;
  Einschraenkungen: string | null;
}

export interface EbayTradingVehiclesResult {
  totalCount: number;
  items: EbayTradingVehicleRow[];
  rawSample: Array<Record<string, string>>;
}

export interface EbayTradingGetItemResult {
  url: string;
  siteId: string;
  itemId: string;
  marketplaceId: string;
  basic: EbayBrowseBasicInfo;
  vehicles: EbayTradingVehiclesResult;
  vehiclesError?: string | null;
  specifics: EbayItemSpecificRow[];
}

export interface EbayOfficialLiveBrowseBySkuResult {
  url: string;
  itemId: string;
  marketplaceId: string;
  basic: EbayBrowseBasicInfo;
  specifics: EbayItemSpecificRow[];
  cached?: boolean;
  refreshQueued?: boolean;
}

export interface EbayOfficialLiveFitmentBySkuResult {
  url: string;
  itemId: string;
  siteId: string;
  vehicles: EbayTradingVehiclesResult;
  specifics: EbayItemSpecificRow[];
  vehiclesError?: string | null;
  cached?: boolean;
  refreshQueued?: boolean;
}

export interface PageResult<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  lastSyncedAt?: string | null;
}
