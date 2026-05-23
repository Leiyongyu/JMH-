import { useEffect, useRef, useState } from 'react';
import { Card, Input, Table, Button, Space, App, Typography, Progress, Select, Switch, Tag, Row, Col, Statistic } from 'antd';
import { ReloadOutlined, SyncOutlined, DatabaseOutlined, WarningOutlined, ClockCircleOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { useSearchParams } from 'react-router-dom';
import { adminApi, inventoryApi } from '../api/modules';
import type { InventoryLine, SyncRun } from '../api/types';
import { useAuth } from '../auth/AuthContext';

export function InventoryPage() {
  const { isAdmin } = useAuth();
  const { message } = App.useApp();
  const [data, setData] = useState<InventoryLine[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [keyword, setKeyword] = useState('');
  const [platform, setPlatform] = useState<string | undefined>(undefined);
  const [warehouse, setWarehouse] = useState('');
  const [lowStockOnly, setLowStockOnly] = useState(false);
  const [sortBy, setSortBy] = useState<'sku' | 'availableQty' | 'reservedQty' | 'inboundQty' | 'syncedAt' | undefined>(undefined);
  const [sortOrder, setSortOrder] = useState<'ASC' | 'DESC' | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncRun, setSyncRun] = useState<SyncRun | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pendingToastRunIdRef = useRef<string | null>(null);

  const platformOptions = Array.from(new Set(data.map((i) => i.platform).filter(Boolean))).map((p) => ({
    label: p,
    value: p,
  }));

  const loadSyncRun = () => {
    if (!isAdmin) return;
    adminApi
      .syncRuns('INVENTORY')
      .then((runs) => {
        const r = runs[0] ?? null;
        setSyncRun(r);
        if (r && r.status !== 'RUNNING' && r.finishedAt) {
          setSyncing(false);
          loadList();
          if (pendingToastRunIdRef.current !== null && r.id === pendingToastRunIdRef.current) {
            if (r.status === 'SUCCESS') {
              message.success(`库存同步完成：成功 ${r.successCount} 条${r.errorCount ? `，失败 ${r.errorCount} 条` : ''}`);
            } else if (r.status === 'FAILED') {
              message.error(r.errorMessage ?? '库存同步失败');
            }
            pendingToastRunIdRef.current = null;
          }
        }
      })
      .catch(() => {});
  };

  const startPolling = () => {
    stopPolling();
    loadSyncRun();
    pollRef.current = setInterval(loadSyncRun, 2000);
  };

  const stopPolling = () => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  };

  const loadList = (
    p = page,
    ps = pageSize,
    sku = keyword,
    pPlatform = platform,
    pWarehouse = warehouse,
    pLowStockOnly = lowStockOnly,
    pSortBy = sortBy,
    pSortOrder = sortOrder,
  ) => {
    const qp = new URLSearchParams();
    if (sku.trim()) qp.set('sku', sku.trim());
    if (pPlatform) qp.set('platform', pPlatform);
    if (pWarehouse.trim()) qp.set('warehouse', pWarehouse.trim());
    if (pLowStockOnly) qp.set('lowStockOnly', 'true');
    if (pSortBy) qp.set('sortBy', pSortBy);
    if (pSortOrder) qp.set('sortOrder', pSortOrder);
    if (p > 1) qp.set('page', String(p));
    if (ps !== 20) qp.set('pageSize', String(ps));
    setSearchParams(qp, { replace: true });

    setLoading(true);
    inventoryApi
      .lines({
        sku: sku || undefined,
        platform: pPlatform || undefined,
        warehouse: pWarehouse.trim() || undefined,
        lowStockOnly: pLowStockOnly,
        lowStockThreshold: 10,
        sortBy: pSortBy,
        sortOrder: pSortOrder,
        page: p,
        pageSize: ps,
      })
      .then((r) => {
        setData(r.items);
        setTotal(r.total);
        setPage(r.page);
        setPageSize(r.pageSize);
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    const initSku = searchParams.get('sku') ?? '';
    const initPlatform = searchParams.get('platform') ?? undefined;
    const initWarehouse = searchParams.get('warehouse') ?? '';
    const initLowStockOnly = (searchParams.get('lowStockOnly') ?? 'false').toLowerCase() === 'true';
    const initSortByRaw = searchParams.get('sortBy') ?? undefined;
    const initSortBy = (
      initSortByRaw &&
      ['sku', 'availableQty', 'reservedQty', 'inboundQty', 'syncedAt'].includes(initSortByRaw)
    )
      ? (initSortByRaw as 'sku' | 'availableQty' | 'reservedQty' | 'inboundQty' | 'syncedAt')
      : undefined;
    const initSortOrderRaw = (searchParams.get('sortOrder') ?? '').toUpperCase();
    const initSortOrder = initSortOrderRaw === 'ASC' || initSortOrderRaw === 'DESC'
      ? (initSortOrderRaw as 'ASC' | 'DESC')
      : undefined;
    const initPage = Math.max(1, Number(searchParams.get('page') ?? 1));
    const initPageSize = Math.min(100, Math.max(1, Number(searchParams.get('pageSize') ?? 20)));

    setKeyword(initSku);
    setPlatform(initPlatform);
    setWarehouse(initWarehouse);
    setLowStockOnly(initLowStockOnly);
    setSortBy(initSortBy);
    setSortOrder(initSortOrder);

    loadList(initPage, initPageSize, initSku, initPlatform, initWarehouse, initLowStockOnly, initSortBy, initSortOrder);
    loadSyncRun();
    return stopPolling;
  }, []);

  const onSync = async () => {
    setSyncing(true);
    try {
      const run = await adminApi.syncInventory();
      pendingToastRunIdRef.current = run.id;
      setSyncRun(run);
      startPolling();
    } catch (err: unknown) {
      setSyncing(false);
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? '同步启动失败';
      message.error(msg);
    }
  };

  const isRunning = syncing && syncRun?.status === 'RUNNING';
  const proc = syncRun?.processedCount ?? 0;
  const syncTotal = syncRun?.totalCount ?? 0;
  const progressPercent =
    isRunning && syncTotal > 0
      ? Math.min(100, Math.round((proc / syncTotal) * 100))
      : isRunning
        ? 0
        : 0;

  // 统计数据
  const lowStockCount = data.filter(i => i.availableQty < 10).length;

  return (
    <Space direction="vertical" size={24} style={{ width: '100%' }}>
      <Row gutter={24}>
        <Col span={8}>
          <Card variant="borderless">
            <Statistic
              title="SKU 总数"
              value={total}
              prefix={<DatabaseOutlined style={{ color: '#1677ff' }} />}
            />
          </Card>
        </Col>
        <Col span={8}>
          <Card variant="borderless">
            <Statistic
              title="低库存预警"
              value={lowStockCount}
              valueStyle={{ color: lowStockCount > 0 ? '#ff4d4f' : '#52c41a' }}
              prefix={<WarningOutlined />}
              suffix={<span style={{ fontSize: 14, color: '#999' }}> (当前页)</span>}
            />
          </Card>
        </Col>
        <Col span={8}>
          <Card variant="borderless">
            <Statistic
              title="最近数据更新"
              value={data[0]?.syncedAt ? dayjs(data[0].syncedAt).format('HH:mm:ss') : '—'}
              prefix={<ClockCircleOutlined style={{ color: '#faad14' }} />}
            />
          </Card>
        </Col>
      </Row>

      {isAdmin && syncRun && isRunning && (
        <Card variant="borderless" bodyStyle={{ padding: '16px 24px' }} style={{ background: '#fff7e6', border: '1px solid #ffe7ba' }}>
          <Space direction="vertical" style={{ width: '100%' }} size={8}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <Typography.Text strong>📦 正在同步领星库存明细...</Typography.Text>
              <Typography.Text type="secondary">{progressPercent}%</Typography.Text>
            </div>
            <Progress percent={progressPercent} strokeColor="#faad14" status="active" showInfo={false} />
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              已处理: {proc.toLocaleString()} / {syncTotal > 0 ? syncTotal.toLocaleString() : '正在读取...'}
            </Typography.Text>
          </Space>
        </Card>
      )}

      <Card
        variant="borderless"
        title={<span style={{ fontWeight: 600 }}>库存明细看板</span>}
        extra={
          <Space wrap size="middle">
            <Input.Search
              placeholder="搜索 SKU"
              allowClear
              value={keyword}
              onChange={(e) => {
                const v = e.target.value;
                setKeyword(v);
                if (!v.trim()) loadList(1, pageSize, '', platform, warehouse, lowStockOnly, sortBy, sortOrder);
              }}
              onSearch={(v) => {
                setKeyword(v);
                loadList(1, pageSize, v, platform, warehouse, lowStockOnly, sortBy, sortOrder);
              }}
              style={{ width: 200 }}
            />
            <Select
              allowClear
              placeholder="平台筛选"
              style={{ width: 120 }}
              value={platform}
              options={platformOptions}
              onChange={(v) => {
                setPlatform(v);
                loadList(1, pageSize, keyword, v, warehouse, lowStockOnly, sortBy, sortOrder);
              }}
            />
            <Input.Search
              placeholder="仓库代码/名称"
              allowClear
              value={warehouse}
              onChange={(e) => setWarehouse(e.target.value)}
              onSearch={(v) => {
                setWarehouse(v);
                loadList(1, pageSize, keyword, platform, v, lowStockOnly, sortBy, sortOrder);
              }}
              style={{ width: 180 }}
            />
            <Space size={4}>
              <Typography.Text type="secondary" style={{ fontSize: 13 }}>低库存</Typography.Text>
              <Switch
                size="small"
                checked={lowStockOnly}
                onChange={(checked) => {
                  setLowStockOnly(checked);
                  loadList(1, pageSize, keyword, platform, warehouse, checked, sortBy, sortOrder);
                }}
              />
            </Space>
            <Button icon={<ReloadOutlined />} onClick={() => loadList(page, pageSize, keyword, platform, warehouse, lowStockOnly, sortBy, sortOrder)}>
              刷新
            </Button>
          </Space>
        }
      >
        <Table<InventoryLine>
          rowKey="id"
          loading={loading}
          dataSource={data}
          size="middle"
          pagination={{
            current: page,
            pageSize,
            total,
            showSizeChanger: true,
            pageSizeOptions: [10, 20, 50, 100],
            onChange: (p, ps) => loadList(p, ps, keyword, platform, warehouse, lowStockOnly, sortBy, sortOrder),
          }}
          columns={[
            {
              title: 'SKU',
              dataIndex: 'sku',
              width: 200,
              render: (sku) => <Typography.Text strong copyable>{sku}</Typography.Text>
            },
            {
              title: '平台',
              dataIndex: 'platform',
              width: 100,
              render: (p) => <Tag bordered={false}>{p || '未知'}</Tag>
            },
            {
              title: '仓库信息',
              dataIndex: 'warehouseCode',
              width: 160,
              render: (v: string) => <Typography.Text>{v || '—'}</Typography.Text>,
            },
            {
              title: '仓库名称',
              dataIndex: 'warehouseName',
              width: 180,
              render: (v?: string | null) => <Typography.Text>{v || '—'}</Typography.Text>,
            },
            {
              title: '可用库存',
              dataIndex: 'availableQty',
              width: 100,
              sorter: true,
              render: (qty) => (
                <Typography.Text strong style={{ color: qty < 10 ? '#ff4d4f' : '#52c41a' }}>
                  {qty}
                </Typography.Text>
              )
            },
            {
              title: '预占',
              dataIndex: 'reservedQty',
              width: 90,
              sorter: true,
              render: (qty) => <Typography.Text type="secondary">{qty}</Typography.Text>
            },
            {
              title: '在途',
              dataIndex: 'inboundQty',
              width: 90,
              sorter: true,
              render: (qty) => <Typography.Text type="secondary">{qty}</Typography.Text>
            },
            {
              title: '最后同步',
              dataIndex: 'syncedAt',
              width: 160,
              sorter: true,
              render: (v: string) => (v ? dayjs(v).format('MM-DD HH:mm') : '—'),
            },
          ]}
          onChange={(_, __, sorter) => {
            const s = Array.isArray(sorter) ? sorter[0] : sorter;
            const field = s?.field as 'availableQty' | 'reservedQty' | 'inboundQty' | 'syncedAt' | 'sku' | undefined;
            const orderMap: Record<string, 'ASC' | 'DESC'> = {
              ascend: 'ASC',
              descend: 'DESC',
            };
            const nextOrder = s?.order ? orderMap[s.order] : undefined;
            setSortBy(field);
            setSortOrder(nextOrder);
            loadList(1, pageSize, keyword, platform, warehouse, lowStockOnly, field, nextOrder);
          }}
          scroll={{ x: 1120 }}
        />
      </Card>
    </Space>
  );
}
