export function lingxingOrderStatusText(status?: number | null): string | null {
  const s = typeof status === 'number' && Number.isFinite(status) ? Math.trunc(status) : null;
  if (s === null) return null;
  switch (s) {
    case 1:
      return '同步中';
    case 2:
      return '已同步';
    case 3:
      return '未付款';
    case 4:
      return '待审核';
    case 5:
      return '待发货';
    case 6:
      return '已发货';
    case 7:
      return '已取消/不发货';
    case 8:
      return '不显示';
    case 9:
      return '平台发货';
    default:
      return `未知(${s})`;
  }
}

