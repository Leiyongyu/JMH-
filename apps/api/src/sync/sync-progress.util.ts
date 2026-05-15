/**
 * 领星分页接口常见 total 在不同层返回，统一解析为正整数条数。
 */
export function coerceLingxingListTotal(envelope: unknown, inner?: unknown): number | undefined {
  const fromVal = (v: unknown): number | undefined => {
    if (typeof v === 'number' && v > 0 && Number.isFinite(v)) return Math.floor(v);
    if (typeof v === 'string' && Number(v.trim()) > 0) return Math.floor(Number(v.trim()));
    return undefined;
  };
  if (envelope !== null && typeof envelope === 'object') {
    const e = envelope as Record<string, unknown>;
    const top = fromVal(e.total) ?? fromVal(e.recordsTotal);
    if (top !== undefined) return top;
  }
  if (inner !== null && typeof inner === 'object') {
    const d = inner as Record<string, unknown>;
    for (const key of ['total', 'totalRows', 'recordsTotal', 'count', 'total_count']) {
      const t = fromVal(d[key]);
      if (t !== undefined) return t;
    }
  }
  return undefined;
}

/** 已知 API 总数则用之；未知则按「已满页则认为至少还有一页」估计，末尾页则用已处理数为总数 */
export function estimateSyncTotalCount(params: {
  apiTotal?: number | undefined;
  processed: number;
  pageSize: number;
  lastPageRows: number;
  previousEstimate: number;
}): number {
  const api = params.apiTotal;
  if (typeof api === 'number' && api > 0 && Number.isFinite(api)) return Math.floor(api);

  const processed = Math.max(0, params.processed);
  const fullPage = params.lastPageRows >= params.pageSize;
  if (!fullPage) return Math.max(processed, 1);

  return Math.max(params.previousEstimate, processed + Math.max(params.pageSize, 1));
}
