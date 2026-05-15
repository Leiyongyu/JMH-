import { useEffect, useRef, useState } from 'react';
import { Alert, App, Button, Card, Form, Input, InputNumber, Modal, Pagination, Progress, Select, Space, Spin, Statistic, Row, Col, Skeleton, Empty, Typography, Upload } from 'antd';
import { ReloadOutlined, SyncOutlined, GlobalOutlined, InfoCircleOutlined, UploadOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { adminApi, productsApi } from '../api/modules';
import type { EbayProduct, SyncRun } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { cart } from '../cart/cart';
import { EbayProductCard } from '../components/EbayProductCard';
import { useNavigate } from 'react-router-dom';

const GRID_MIN_WIDTH = 260;
const GRID_GAP = 16;
const RESERVED_BOTTOM_PX = 140;
const MIN_AUTO_PAGE_SIZE = 8;

export function ProductsPage() {
  const { isAdmin } = useAuth();
  const { message } = App.useApp();
  const navigate = useNavigate();
  const [data, setData] = useState<EbayProduct[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(12);
  const [keyword, setKeyword] = useState('');
  const [sortBy, setSortBy] = useState<'stockQty' | 'price' | 'sku' | 'syncedAt'>('stockQty');
  const [sortOrder, setSortOrder] = useState<'ASC' | 'DESC'>('DESC');
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const [syncRun, setSyncRun] = useState<SyncRun | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [editLoading, setEditLoading] = useState(false);
  const [editingSku, setEditingSku] = useState<string | null>(null);
  const [editError, setEditError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [editForm] = Form.useForm();
  const pendingToastRunIdRef = useRef<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const gridRef = useRef<HTMLDivElement | null>(null);
  const keywordRef = useRef('');
  const pageSizeRef = useRef(pageSize);
  const sortByRef = useRef(sortBy);
  const sortOrderRef = useRef(sortOrder);
  const resizeTimerRef = useRef<number | null>(null);

  const load = (p = page, ps = pageSize, kw = keyword, sb = sortBy, so = sortOrder) => {
    setLoading(true);
    productsApi
      .list({ keyword: kw || undefined, sortBy: sb, sortOrder: so, page: p, pageSize: ps })
      .then((r) => {
        setData(r.items);
        setTotal(r.total);
        setPage(r.page);
        setPageSize(r.pageSize);
        setLastSyncedAt(r.lastSyncedAt ?? null);
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    keywordRef.current = keyword;
  }, [keyword]);

  useEffect(() => {
    sortByRef.current = sortBy;
  }, [sortBy]);

  useEffect(() => {
    sortOrderRef.current = sortOrder;
  }, [sortOrder]);

  useEffect(() => {
    pageSizeRef.current = pageSize;
  }, [pageSize]);

  const calcAutoPageSize = (): number => {
    const el = gridRef.current;
    if (!el) return pageSizeRef.current;
    const rect = el.getBoundingClientRect();
    const containerWidth = rect.width;
    const cols = Math.max(1, Math.floor((containerWidth + GRID_GAP) / (GRID_MIN_WIDTH + GRID_GAP)));
    const cardEl = el.querySelector('.product-card') as HTMLElement | null;
    const cardHeight = Math.max(260, Math.round(cardEl?.getBoundingClientRect().height ?? 360));
    const availableHeight = Math.max(260, Math.floor(window.innerHeight - rect.top - RESERVED_BOTTOM_PX));
    const rows = Math.max(1, Math.floor((availableHeight + GRID_GAP) / (cardHeight + GRID_GAP)));
    const size = cols * rows;
    const clamped = Math.min(100, Math.max(MIN_AUTO_PAGE_SIZE, size));
    return Math.max(cols, Math.floor(clamped / cols) * cols);
  };

  const applyAutoPageSize = (immediate = false) => {
    const run = () => {
      const next = calcAutoPageSize();
      if (next !== pageSizeRef.current) {
        setPage(1);
        pageSizeRef.current = next;
        setPageSize(next);
        load(1, next, keywordRef.current, sortByRef.current, sortOrderRef.current);
      }
    };
    if (immediate) {
      run();
      return;
    }
    if (resizeTimerRef.current) {
      window.clearTimeout(resizeTimerRef.current);
    }
    resizeTimerRef.current = window.setTimeout(run, 180);
  };

  const loadSyncRun = () => {
    if (!isAdmin) return;
    adminApi
      .syncRuns('EBAY_PRODUCT')
      .then((runs) => {
        const r = runs[0] ?? null;
        setSyncRun(r);
        if (r && r.status !== 'RUNNING' && r.finishedAt) {
          const isPending = pendingToastRunIdRef.current !== null && r.id === pendingToastRunIdRef.current;
          setSyncing(false);
          if (isPending) {
            load();
            if (r.status === 'SUCCESS') {
              message.success(
                `eBay 商品同步完成：成功 ${r.successCount} 条${r.errorCount ? `，失败 ${r.errorCount} 条` : ''}`,
              );
            } else if (r.status === 'FAILED') {
              message.error(r.errorMessage ?? 'eBay 商品同步失败');
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

  useEffect(() => {
    const next = calcAutoPageSize();
    pageSizeRef.current = next;
    setPageSize(next);
    load(1, next, '', sortByRef.current, sortOrderRef.current);
    loadSyncRun();
    return () => {
      stopPolling();
    };
  }, []);

  useEffect(() => {
    const el = gridRef.current;
    if (!el) return;

    const ro = new ResizeObserver(() => applyAutoPageSize());
    ro.observe(el);
    const onResize = () => applyAutoPageSize();
    window.addEventListener('resize', onResize);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', onResize);
      if (resizeTimerRef.current) {
        window.clearTimeout(resizeTimerRef.current);
        resizeTimerRef.current = null;
      }
    };
  }, []);

  const onSync = async () => {
    setSyncing(true);
    try {
      const run = await adminApi.syncEbayProducts();
      pendingToastRunIdRef.current = run.id;
      setSyncRun(run);
      startPolling();
    } catch (err: unknown) {
      setSyncing(false);
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? '同步启动失败';
      message.error(msg);
    }
  };

  const onExport = async () => {
    try {
      const buf = await adminApi.exportEbayProductsXlsx();
      const blob = new Blob([buf], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'ebay-products.xlsx';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      message.success('已导出 Excel');
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? '导出失败';
      message.error(msg);
    }
  };

  const onImport = async (file: File) => {
    Modal.confirm({
      title: '确认导入并批量更新价格？',
      content: '将按 SKU 匹配本地商品库中的记录（请先同步 eBay 商品），并用 Excel 的 price 覆盖对应 SKU 的人民币价格。',
      okText: '确认导入',
      cancelText: '取消',
      onOk: async () => {
        try {
          const res = await adminApi.importEbayPriceXlsx(file);
          message.success(`导入完成：更新 ${res.updated} 条，未找到 ${res.notFound} 条，无效 ${res.invalid} 条`);
          load(1, pageSizeRef.current, keywordRef.current, sortByRef.current, sortOrderRef.current);
        } catch (err: unknown) {
          const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? '导入失败';
          message.error(msg);
        }
      },
    });
  };

  const openEdit = async (p: EbayProduct) => {
    setEditOpen(true);
    setEditLoading(true);
    setEditingSku(p.sku);
    setEditError(null);
    editForm.resetFields();
    editForm.setFieldsValue({ sku: p.sku });
    try {
      const full = await adminApi.getEbayProduct(p.sku);
      editForm.setFieldsValue({
        sku: full.sku,
        title: full.title ?? '',
        currency: full.currency,
        price: Number(full.price || 0),
        stockQty: full.stockQty,
        status: full.status ?? 'ACTIVE',
        itemUrl: full.itemUrl ?? '',
      });
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? '读取商品失败';
      setEditError(msg);
      message.error(msg);
    } finally {
      setEditLoading(false);
    }
  };

  const submitEdit = async () => {
    const sku = editingSku;
    if (!sku) return;
    const values = await editForm.validateFields();

    Modal.confirm({
      title: '确认保存修改？',
      content: '此操作会直接写入数据库，并立即影响商品展示。',
      okText: '确认保存',
      cancelText: '取消',
      onOk: async () => {
        setSaving(true);
        try {
          const updated = await adminApi.updateEbayProduct(sku, {
            title: String(values.title || '').trim() || null,
            currency: values.currency,
            price: String(Number(values.price ?? 0).toFixed(2)),
            stockQty: Number(values.stockQty ?? 0),
            status: values.status,
            itemUrl: String(values.itemUrl || '').trim() || null,
          });
          setData((prev) => prev.map((it) => (it.sku === updated.sku ? updated : it)));
          message.success('已保存并更新显示');
          setEditOpen(false);
          setEditingSku(null);
        } catch (err: unknown) {
          const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? '保存失败';
          message.error(msg);
        } finally {
          setSaving(false);
        }
      },
    });
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

  return (
    <Space direction="vertical" size={24} style={{ width: '100%' }}>
      <Row gutter={24}>
        <Col span={8}>
          <Card variant="borderless">
            <Statistic
              title="在线商品总数"
              value={total}
              prefix={<GlobalOutlined style={{ color: '#1677ff' }} />}
            />
          </Card>
        </Col>
        <Col span={8}>
          <Card variant="borderless">
            <Statistic
              title="最近同步时间"
              value={lastSyncedAt ? dayjs(lastSyncedAt).format('HH:mm:ss') : '—'}
              suffix={lastSyncedAt ? dayjs(lastSyncedAt).format('MM-DD') : ''}
              prefix={<SyncOutlined style={{ color: '#52c41a' }} />}
            />
          </Card>
        </Col>
        <Col span={8}>
          <Card variant="borderless">
            <Statistic
              title="同步状态"
              value={syncRun?.status === 'RUNNING' ? '正在执行' : syncRun?.status === 'SUCCESS' ? '已完成' : '待执行'}
              valueStyle={{ color: syncRun?.status === 'RUNNING' ? '#1890ff' : syncRun?.status === 'SUCCESS' ? '#52c41a' : '#d9d9d9' }}
              prefix={<InfoCircleOutlined />}
            />
          </Card>
        </Col>
      </Row>

      <Card
        variant="borderless"
        style={{ boxShadow: '0 1px 8px rgba(0,0,0,0.08)' }}
        title={<span style={{ fontWeight: 600 }}>商品库</span>}
        extra={
          <Space size="small" wrap={false}>
            <Input.Search
              placeholder="搜索 SKU 或标题"
              allowClear
              value={keyword}
              onChange={(e) => {
                const v = e.target.value;
                setKeyword(v);
                if (!v.trim()) load(1, pageSize, '', sortBy, sortOrder);
              }}
              onSearch={(v) => {
                setKeyword(v);
                load(1, pageSize, v, sortBy, sortOrder);
              }}
              style={{ width: 220 }}
            />

            <Select
              value={`${sortBy}:${sortOrder}`}
              style={{ width: 190 }}
              onChange={(v) => {
                const [sb, so] = String(v).split(':');
                const nextSb = (sb === 'price' || sb === 'sku' || sb === 'syncedAt' ? sb : 'stockQty') as typeof sortBy;
                const nextSo = (so === 'ASC' ? 'ASC' : 'DESC') as typeof sortOrder;
                setSortBy(nextSb);
                setSortOrder(nextSo);
                load(1, pageSize, keyword, nextSb, nextSo);
              }}
              options={[
                { value: 'stockQty:DESC', label: '库存：从多到少' },
                { value: 'stockQty:ASC', label: '库存：从少到多' },
                { value: 'price:DESC', label: '价格：从高到低' },
                { value: 'price:ASC', label: '价格：从低到高' },
                { value: 'syncedAt:DESC', label: '同步时间：最新' },
                { value: 'syncedAt:ASC', label: '同步时间：最早' },
                { value: 'sku:ASC', label: 'SKU：A-Z' },
                { value: 'sku:DESC', label: 'SKU：Z-A' },
              ]}
            />
            <Button icon={<ReloadOutlined />} onClick={() => load()}>
              刷新
            </Button>
            {isAdmin && (
              <Button type="primary" icon={<SyncOutlined spin={isRunning} />} loading={isRunning} onClick={onSync}>
                {isRunning ? '同步中…' : '立即同步'}
              </Button>
            )}
            {isAdmin && (
              <Button onClick={onExport}>
                导出 Excel
              </Button>
            )}
            {isAdmin && (
              <Upload
                accept=".xlsx,.xls"
                showUploadList={false}
                beforeUpload={(file) => {
                  void onImport(file as File);
                  return false;
                }}
              >
                <Button icon={<UploadOutlined />}>上传 Excel</Button>
              </Upload>
            )}
          </Space>
        }
      >
        {isAdmin && syncRun && isRunning && (
          <div style={{ marginBottom: 24, padding: '16px', background: '#e6f4ff', borderRadius: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
              <Typography.Text strong color="primary">正在从领星同步 eBay 数据...</Typography.Text>
              <Typography.Text type="secondary">{progressPercent}%</Typography.Text>
            </div>
            <Progress
              percent={progressPercent}
              strokeColor={{ from: '#1677ff', to: '#69b1ff' }}
              status="active"
              showInfo={false}
            />
            <div style={{ marginTop: 8 }}>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                已处理: {proc.toLocaleString()} / {syncTotal > 0 ? syncTotal.toLocaleString() : '...'}
              </Typography.Text>
            </div>
          </div>
        )}

        <div
          ref={gridRef}
          style={{
            minHeight: 320,
            display: data.length === 0 && !loading ? 'block' : 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
            gap: 16,
          }}
        >
          {loading && data.length === 0 ? (
            Array.from({ length: Math.min(24, Math.max(8, pageSize)) }).map((_, idx) => (
              <Card key={idx} variant="outlined" styles={{ body: { padding: 12 } }}>
                <Skeleton active paragraph={{ rows: 3 }} />
              </Card>
            ))
          ) : data.length === 0 ? (
            <Empty description="暂无商品" />
          ) : (
            data.map((p) => (
              <EbayProductCard
                key={p.id}
                product={p}
                onOpen={() => navigate(`/products/${encodeURIComponent(p.sku)}`, { state: { product: p } })}
                onEdit={
                  isAdmin
                    ? () => openEdit(p)
                    : undefined
                }
                onAddToCart={() => {
                  cart.add({
                    sku: p.sku,
                    title: p.title,
                    qty: 1,
                    unitPrice: p.price,
                    currency: p.currency,
                    itemUrl: p.itemUrl,
                  });
                  message.success(`已加入购物车：${p.sku} × 1`);
                }}
              />
            ))
          )}
        </div>

        <Modal
          title={editingSku ? `编辑商品：${editingSku}` : '编辑商品'}
          open={editOpen}
          onCancel={() => {
            setEditOpen(false);
            setEditingSku(null);
            setEditError(null);
          }}
          onOk={submitEdit}
          okText="保存"
          confirmLoading={saving}
          okButtonProps={{ disabled: editLoading || !!editError }}
          destroyOnHidden
        >
          {editError && (
            <Alert
              type="error"
              showIcon
              message="读取失败"
              description={editError}
              style={{ marginBottom: 12 }}
            />
          )}

          <Spin spinning={editLoading} tip="正在从数据库读取商品…">
            <Form form={editForm} layout="vertical">
              <Form.Item label="SKU" name="sku">
                <Input disabled />
              </Form.Item>

              <Form.Item label="标题" name="title" rules={[{ required: true, message: '请输入标题' }]}>
                <Input.TextArea rows={2} placeholder="商品标题" disabled={editLoading} />
              </Form.Item>

              <Row gutter={12}>
                <Col span={12}>
                  <Form.Item label="币种" name="currency" rules={[{ required: true }]}>
                    <Select
                      disabled={editLoading}
                      options={[
                        { value: 'USD', label: 'USD' },
                        { value: 'CNY', label: 'CNY' },
                        { value: 'EUR', label: 'EUR' },
                        { value: 'GBP', label: 'GBP' },
                      ]}
                    />
                  </Form.Item>
                </Col>
                <Col span={12}>
                  <Form.Item label="价格" name="price" rules={[{ required: true }]}>
                    <InputNumber disabled={editLoading} min={0} style={{ width: '100%' }} precision={2} />
                  </Form.Item>
                </Col>
              </Row>

              <Row gutter={12}>
                <Col span={12}>
                  <Form.Item label="库存" name="stockQty" rules={[{ required: true }]}>
                    <InputNumber disabled={editLoading} min={0} style={{ width: '100%' }} />
                  </Form.Item>
                </Col>
                <Col span={12}>
                  <Form.Item label="状态" name="status" rules={[{ required: true }]}>
                    <Select
                      disabled={editLoading}
                      options={[
                        { value: 'ACTIVE', label: 'ACTIVE（在售）' },
                        { value: 'INACTIVE', label: 'INACTIVE（下架）' },
                        { value: 'ENDED', label: 'ENDED（结束）' },
                      ]}
                    />
                  </Form.Item>
                </Col>
              </Row>

              <Form.Item label="商品链接" name="itemUrl">
                <Input disabled={editLoading} placeholder="https://www.ebay.com/itm/..." />
              </Form.Item>

              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                提示：后续再次同步 eBay 数据可能会覆盖你在此处修改的字段。
              </Typography.Text>
            </Form>
          </Spin>
        </Modal>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 16 }}>
          <Pagination
            current={page}
            pageSize={pageSize}
            total={total}
            showTotal={(t) => `共 ${t} 条`}
            onChange={(p, ps) => load(p, ps, keyword, sortBy, sortOrder)}
          />
        </div>
      </Card>
    </Space>
  );
}
