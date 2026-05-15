import { App, Button, Card, Input, Space, Table, Tag, Select, Popconfirm } from 'antd';
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import dayjs from 'dayjs';
import { adminApi, ordersApi } from '../api/modules';
import type { DistributorOrder } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { SyncOutlined } from '@ant-design/icons';

function sumLineQty(r: DistributorOrder): number {
  if (!r.lines?.length) return 0;
  return r.lines.reduce((sum, line) => sum + Math.max(0, Number(line.qty) || 0), 0);
}

function orderStatusText(r: DistributorOrder): string {
  const t = (r.lingxingStatusText ?? '').trim();
  if (t) return t;
  const s = r.lingxingStatus;
  if (typeof s === 'number' && Number.isFinite(s)) return `领星(${s})`;
  return r.status;
}

function orderStatusColor(r: DistributorOrder): string {
  const lx = r.lingxingStatus;
  if (typeof lx === 'number' && Number.isFinite(lx)) {
    if (lx === 6) return 'green';
    if (lx === 5) return 'orange';
    if (lx === 4) return 'gold';
    if (lx === 3) return 'red';
    if (lx === 7) return 'default';
    return 'blue';
  }

  const t = (r.lingxingStatusText ?? '').trim();
  if (t) {
    if (t.includes('已付款')) return 'green';
    if (t.includes('未付款')) return 'red';
    if (t.includes('已发货')) return 'green';
    if (t.includes('待发货')) return 'orange';
    if (t.includes('待审核')) return 'gold';
    if (t.includes('已取消') || t.includes('不发货')) return 'default';
    return 'blue';
  }

  return r.status === 'CREATED' ? 'green' : 'default';
}

export function OrdersPage() {
  const { isAdmin } = useAuth();
  const { message } = App.useApp();
  const [data, setData] = useState<DistributorOrder[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [keyword, setKeyword] = useState('');
  const [lingxingStatusText, setLingxingStatusText] = useState<string>('');
  const [statusOptions, setStatusOptions] = useState<Array<string | null>>([]);
  const [selectedRowKeys, setSelectedRowKeys] = useState<Array<string>>([]);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pendingRunIdRef = useRef<string | null>(null);
  const updatingStatusRef = useRef<Set<string>>(new Set());

  const load = (p = page, ps = pageSize, kw = keyword, st = lingxingStatusText) => {
    setLoading(true);
    ordersApi
      .list({
        all: isAdmin ? true : undefined,
        keyword: kw || undefined,
        lingxingStatusText: st || undefined,
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

  const loadStatusOptions = () => {
    ordersApi
      .statusOptions()
      .then((opts) => setStatusOptions(opts))
      .catch(() => setStatusOptions([]));
  };

  const stopPolling = () => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  };

  const loadLatestRun = () => {
    if (!isAdmin) return;
    const pendingId = pendingRunIdRef.current;
    if (!pendingId) return;

    adminApi
      .syncRuns('LINGXING_ORDER_STATUS')
      .then((runs) => {
        const r = runs[0];
        if (!r || r.id !== pendingId) return;
        if (r.status === 'RUNNING') return;

        stopPolling();
        pendingRunIdRef.current = null;
        setSyncing(false);

        if (r.status === 'SUCCESS') {
          message.success(`订单信息同步完成：成功 ${r.successCount} 条${r.errorCount ? `，失败 ${r.errorCount} 条` : ''}`);
        } else if (r.status === 'FAILED') {
          message.error(r.errorMessage ?? '订单信息同步失败');
        }

        loadStatusOptions();
        load(page, pageSize, keyword, lingxingStatusText);
      })
      .catch(() => {});
  };

  const startPolling = () => {
    stopPolling();
    loadLatestRun();
    pollRef.current = setInterval(loadLatestRun, 2000);
  };

  useEffect(() => {
    loadStatusOptions();
    load(1, pageSize, '', '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => stopPolling, []);

  return (
    <Card
      title={isAdmin ? '订单' : '我的订单'}
      extra={
        <Space wrap>
          {isAdmin && (
            <Button
              icon={<SyncOutlined />}
              loading={syncing}
              onClick={() => {
                stopPolling();
                pendingRunIdRef.current = null;
                setSyncing(true);
                adminApi
                  .syncLingxingOrderStatus()
                  .then((run) => {
                    pendingRunIdRef.current = run.id;
                    message.success('已触发订单信息同步（后台执行）');
                    startPolling();
                  })
                  .catch(() => {
                    message.error('触发订单信息同步失败');
                    setSyncing(false);
                  });
              }}
            >
              同步订单信息
            </Button>
          )}
          <Button
            disabled={selectedRowKeys.length === 0}
            onClick={() => {
              const ids = selectedRowKeys.slice();
              if (!ids.length) {
                message.warning('请先勾选要导出的订单');
                return;
              }
              ordersApi
                .exportBillXlsx(ids)
                .then(({ data, contentDisposition }) => {
                  let filename = 'bill.xlsx';
                  const m = /filename=\"?([^\";]+)\"?/i.exec(contentDisposition);
                  if (m?.[1]) filename = m[1];
                  const blob = new Blob([data], {
                    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                  });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = filename;
                  document.body.appendChild(a);
                  a.click();
                  a.remove();
                  URL.revokeObjectURL(url);
                })
                .catch(() => message.error('导出失败'));
            }}
          >
            导出账单
          </Button>
          <Select
            value={lingxingStatusText}
            onChange={(v) => {
              setLingxingStatusText(v);
              load(1, pageSize, keyword, v);
            }}
            style={{ width: 160 }}
            options={[
              { label: '全部状态', value: '' },
              ...statusOptions.map((t) =>
                t === null ? { label: 'null', value: 'NULL' } : { label: t, value: t },
              ),
            ]}
          />
          <Input.Search
            placeholder={isAdmin ? '搜索订单号 / 分销商邮箱' : '搜索订单号'}
            allowClear
            value={keyword}
            onChange={(e) => {
              const v = e.target.value;
              setKeyword(v);
              if (!v.trim()) load(1, pageSize, '', lingxingStatusText);
            }}
            onSearch={(v) => {
              setKeyword(v);
              load(1, pageSize, v, lingxingStatusText);
            }}
            style={{ width: 260 }}
          />
        </Space>
      }
    >
      <Table<DistributorOrder>
        rowKey="id"
        loading={loading}
        rowSelection={{
          selectedRowKeys,
          onChange: (keys) => setSelectedRowKeys(keys as string[]),
        }}
        dataSource={data}
        pagination={{
          current: page,
          pageSize,
          total,
          showSizeChanger: false,
          onChange: (p, ps) => load(p, ps, keyword, lingxingStatusText),
        }}
        columns={[
          {
            title: '订单号',
            dataIndex: 'orderNo',
            width: 220,
            render: (v: string) => <Link to={`/orders/${v}`}>{v}</Link>,
          },
          {
            title: '商品行数',
            width: 100,
            render: (_: unknown, r: DistributorOrder) => r.lines?.length ?? 0,
          },
          {
            title: '商品明细数量',
            width: 120,
            render: (_: unknown, r: DistributorOrder) => sumLineQty(r),
          },
          {
            title: '总金额',
            width: 140,
            render: (_: unknown, r: DistributorOrder) => ` ${r.totalAmount}`,
          },
          {
            title: '状态',
            dataIndex: 'status',
            width: 100,
            render: (_: string, r: DistributorOrder) => {
              const text = orderStatusText(r);
              const color = orderStatusColor(r);
              return <Tag color={color}>{text}</Tag>;
            },
          },
          {
            title: '分销商邮箱',
            dataIndex: 'snapshotBuyerEmail',
            width: 220,
          },
          {
            title: '下单时间',
            dataIndex: 'createdAt',
            width: 180,
            render: (v: string) => dayjs(v).format('YYYY-MM-DD HH:mm:ss'),
          },
          ...(isAdmin
            ? [
                {
                  title: '操作',
                  width: 160,
                  fixed: 'right' as const,
                  render: (_: unknown, r: DistributorOrder) => {
                    const key = r.orderNo;
                    const busy = updatingStatusRef.current.has(key);
                    const current = (r.lingxingStatusText ?? '').trim();
                    return (
                      <Space size={8}>
                        <Button
                          size="small"
                          type={current === '已付款' ? 'primary' : 'default'}
                          loading={busy && current !== '已付款'}
                        >
                          <Popconfirm
                            title="确认将该订单标记为已付款？"
                            okText="确认"
                            cancelText="取消"
                            onConfirm={() => {
                              if (busy) return;
                              updatingStatusRef.current.add(key);
                              adminApi
                                .setOrderLingxingStatusText(r.orderNo, '已付款')
                                .then(() => {
                                  message.success('已设置为已付款');
                                  loadStatusOptions();
                                  load(page, pageSize, keyword, lingxingStatusText);
                                })
                                .catch(() => message.error('更新失败'))
                                .finally(() => {
                                  updatingStatusRef.current.delete(key);
                                });
                            }}
                          >
                            <span>已付款</span>
                          </Popconfirm>
                        </Button>
                        <Button
                          size="small"
                          danger
                          type={current === '未付款' ? 'primary' : 'default'}
                          loading={busy && current !== '未付款'}
                        >
                          <Popconfirm
                            title="确认将该订单标记为未付款？"
                            okText="确认"
                            cancelText="取消"
                            onConfirm={() => {
                              if (busy) return;
                              updatingStatusRef.current.add(key);
                              adminApi
                                .setOrderLingxingStatusText(r.orderNo, '未付款')
                                .then(() => {
                                  message.success('已设置为未付款');
                                  loadStatusOptions();
                                  load(page, pageSize, keyword, lingxingStatusText);
                                })
                                .catch(() => message.error('更新失败'))
                                .finally(() => {
                                  updatingStatusRef.current.delete(key);
                                });
                            }}
                          >
                            <span>未付款</span>
                          </Popconfirm>
                        </Button>
                      </Space>
                    );
                  },
                },
              ]
            : []),
        ]}
        scroll={{ x: isAdmin ? 1280 : 1080 }}
      />
    </Card>
  );
}
