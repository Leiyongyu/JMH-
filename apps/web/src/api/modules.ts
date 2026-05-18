import { api } from './client';

import type { AdminUser, AuthUser, DistributorOrder, EbayOfficialLiveBrowseBySkuResult, EbayOfficialLiveFitmentBySkuResult, EbayOfficialProductBundle, EbayProduct, EbayTradingGetItemResult, InventoryLine, InventorySummary, PageResult, SyncRun } from './types';

export const authApi = {
  login: (account: string, password: string) =>
    api.post<{ token: string; user: AuthUser }>('/auth/login', { account, password }).then((r) => r.data),
  me: () => api.get<AuthUser & { sub: string }>('/me').then((r) => r.data),
};

export const inventoryApi = {
  summary: (lowStockThreshold = 10) =>
    api
      .get<InventorySummary>('/inventory/summary', { params: { lowStockThreshold } })
      .then((r) => r.data),
  lines: (params: {
    sku?: string;
    platform?: string;
    warehouse?: string;
    lowStockOnly?: boolean;
    lowStockThreshold?: number;
    sortBy?: 'sku' | 'availableQty' | 'reservedQty' | 'inboundQty' | 'syncedAt';
    sortOrder?: 'ASC' | 'DESC';
    page?: number;
    pageSize?: number;
  }) =>
    api.get<PageResult<InventoryLine>>('/inventory/lines', { params }).then((r) => r.data),
};

export const productsApi = {
  list: (params: { keyword?: string; sortBy?: 'stockQty' | 'price' | 'sku' | 'syncedAt'; sortOrder?: 'ASC' | 'DESC'; page?: number; pageSize?: number }) =>
    api.get<PageResult<EbayProduct>>('/products/ebay', { params }).then((r) => r.data),
  bySku: (sku: string) =>
    api.get<EbayProduct>(`/products/ebay/${encodeURIComponent(sku)}`).then((r) => r.data),
  officialBySku: (sku: string) =>
    api.get<EbayOfficialProductBundle>(`/products/ebay/${encodeURIComponent(sku)}/official`).then((r) => r.data),
  officialLiveBySku: (sku: string) =>
    api
      .get<EbayTradingGetItemResult>(`/products/ebay/${encodeURIComponent(sku)}/official-live`, { timeout: 150_000 })
      .then((r) => r.data),
  officialLiveBrowseBySku: (sku: string, timeoutMs?: number) =>
    api
      .get<EbayOfficialLiveBrowseBySkuResult>(`/products/ebay/${encodeURIComponent(sku)}/official-live/browse`, {
        params: { timeoutMs },
        timeout: 150_000,
      })
      .then((r) => r.data),
  officialLiveFitmentBySku: (sku: string, args?: { timeoutMs?: number; lite?: boolean; refreshMode?: 'background' }) =>
    api
      .get<EbayOfficialLiveFitmentBySkuResult>(`/products/ebay/${encodeURIComponent(sku)}/official-live/fitment`, {
        params: { timeoutMs: args?.timeoutMs, lite: args?.lite, refreshMode: args?.refreshMode },
        timeout: 150_000,
      })
      .then((r) => r.data),
};

export const ordersApi = {
  create: (
    args: {
      items: Array<{ sku: string; qty: number }>;
      remark?: string;
      shipWarehouseCode?: string;
      shippingAddress: {
        recipientName: string;
        phone: string;
        postalCode?: string;
        countryRegion: string;
        stateProvince: string;
        city: string;
        district?: string;
        addressLine: string;
      };
    },
  ) => api.post<DistributorOrder>('/orders', args).then((r) => r.data),
  list: (params: { all?: boolean; keyword?: string; status?: string; lingxingStatusText?: string; page?: number; pageSize?: number }) =>
    api.get<PageResult<DistributorOrder>>('/orders', { params }).then((r) => r.data),
  detail: (orderNo: string) => api.get<DistributorOrder>(`/orders/${orderNo}`).then((r) => r.data),
  statusOptions: () => api.get<Array<string | null>>('/orders/status-options').then((r) => r.data),
  exportBillXlsx: (orderIds: string[]) =>
    api
      .post<ArrayBuffer>('/orders/export/xlsx', { orderIds }, { responseType: 'arraybuffer' })
      .then((r) => ({ data: r.data, contentDisposition: String(r.headers?.['content-disposition'] ?? '') })),
};

export const adminApi = {
  /** 异步触发同步，立即返回 SyncRun */
  syncInventory: () =>
    api.post<SyncRun>('/admin/sync/inventory').then((r) => r.data),
  syncEbayProducts: () =>
    api.post<SyncRun>('/admin/sync/ebay-products').then((r) => r.data),
  syncEbayOfficialProducts: () =>
    api.post<SyncRun>('/admin/sync/ebay-official-products').then((r) => r.data),
  syncLingxingOrderStatus: () =>
    api.post<SyncRun>('/admin/sync/lingxing-order-status').then((r) => r.data),
  syncRuns: (type?: 'INVENTORY' | 'EBAY_PRODUCT' | 'EBAY_OFFICIAL_PRODUCT' | 'LINGXING_WAREHOUSE' | 'LINGXING_ORDER_STATUS') =>
    api.get<SyncRun[]>('/admin/sync-runs', { params: { type } }).then((r) => r.data),
  syncRun: (id: string) =>
    api.get<SyncRun>(`/admin/sync-runs/${encodeURIComponent(id)}`).then((r) => r.data),

  setOrderLingxingStatusText: (orderNo: string, statusText: string | null) =>
    api.patch<DistributorOrder>(`/admin/orders/${encodeURIComponent(orderNo)}/lingxing-status-text`, { statusText }).then((r) => r.data),

  updateEbayProduct: (
    sku: string,
    patch: Partial<Pick<EbayProduct, 'title' | 'price' | 'currency' | 'stockQty' | 'status' | 'itemUrl' | 'rawPayload'>>,
  ) => api.patch<EbayProduct>(`/admin/products/ebay/${encodeURIComponent(sku)}`, patch).then((r) => r.data),

  getEbayProduct: (sku: string) =>
    api.get<EbayProduct>(`/admin/products/ebay/${encodeURIComponent(sku)}`).then((r) => r.data),

  users: (params: { q?: string; role?: 'ADMIN' | 'DISTRIBUTOR'; page?: number; pageSize?: number }) =>
    api.get<PageResult<AdminUser>>('/admin/users', { params }).then((r) => r.data),

  createUser: (body: { email: string; phone?: string; password: string; role: 'ADMIN' | 'DISTRIBUTOR'; displayName?: string }) =>
    api.post<AdminUser>('/admin/users', body).then((r) => r.data),

  updateUser: (id: string, patch: Partial<{ email: string; phone: string; password: string; role: 'ADMIN' | 'DISTRIBUTOR'; displayName: string }>) =>
    api.patch<AdminUser>(`/admin/users/${encodeURIComponent(id)}`, patch).then((r) => r.data),

  deleteUser: (id: string) =>
    api.delete<AdminUser>(`/admin/users/${encodeURIComponent(id)}`).then((r) => r.data),

  exportEbayProductsXlsx: () =>
    api.get<ArrayBuffer>('/admin/products/ebay/export/xlsx', { responseType: 'arraybuffer' }).then((r) => r.data),

  importEbayPriceXlsx: (file: File) => {
    const fd = new FormData();
    fd.append('file', file);
    return api
      .post<{
        totalRows: number;
        updated: number;
        notFound: number;
        invalid: number;
        details: Array<{ row: number; sku?: string; status: string; message?: string }>;
        skus: string[];
        officialRun: SyncRun | null;
      }>('/admin/products/ebay/import/price-xlsx', fd)
      .then((r) => r.data);
  },
};
