import { Button, Card, Descriptions, Skeleton, Space, Table, Tag } from 'antd';
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeftOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { ordersApi } from '../api/modules';
import type { DistributorOrder, OrderLine } from '../api/types';

function orderStatusText(o: DistributorOrder): string {
  const t = (o.lingxingStatusText ?? '').trim();
  if (t) return t;
  const s = o.lingxingStatus;
  if (typeof s === 'number' && Number.isFinite(s)) return `领星(${s})`;
  return o.status;
}

function orderStatusColor(o: DistributorOrder): string {
  const lx = o.lingxingStatus;
  if (typeof lx === 'number' && Number.isFinite(lx)) {
    if (lx === 6) return 'green';
    if (lx === 5) return 'orange';
    if (lx === 4) return 'gold';
    if (lx === 3) return 'red';
    if (lx === 7) return 'default';
    return 'blue';
  }

  const t = (o.lingxingStatusText ?? '').trim();
  if (t) {
    if (t.includes('已付款')) return 'green';
    if (t.includes('未付款')) return 'red';
    if (t.includes('已发货')) return 'green';
    if (t.includes('待发货')) return 'orange';
    if (t.includes('待审核')) return 'gold';
    if (t.includes('已取消') || t.includes('不发货')) return 'default';
    return 'blue';
  }

  return o.status === 'CREATED' ? 'green' : 'default';
}

export function OrderDetailPage() {
  const { orderNo } = useParams();
  const navigate = useNavigate();
  const [order, setOrder] = useState<DistributorOrder | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!orderNo) return;
    setLoading(true);
    ordersApi
      .detail(orderNo)
      .then(setOrder)
      .finally(() => setLoading(false));
  }, [orderNo]);

  if (loading) {
    return (
      <Card>
        <Skeleton active />
      </Card>
    );
  }
  if (!order) {
    return <Card>订单不存在</Card>;
  }

  return (
    <Card
      title={
        <Space size={12}>
          <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/orders')}>
            返回订单列表
          </Button>
          <span>{`订单详情：${order.orderNo}`}</span>
        </Space>
      }
    >
      <Descriptions bordered column={2} size="small" style={{ marginBottom: 16 }}>
        <Descriptions.Item label="订单号">{order.orderNo}</Descriptions.Item>
        <Descriptions.Item label="状态">
          <Tag color={orderStatusColor(order)}>{orderStatusText(order)}</Tag>
        </Descriptions.Item>
        <Descriptions.Item label="发货仓" span={2}>
          {order.shipWarehouseName ?? order.shipWarehouseCode ?? '—'}
        </Descriptions.Item>
        <Descriptions.Item label="领星推送" span={2}>
          {order.lingxing?.pushStatus ?? '—'}
          {order.lingxing?.pushStatus === 'FAILED' && order.lingxing?.lastError ? `：${order.lingxing.lastError}` : ''}
        </Descriptions.Item>
        <Descriptions.Item label="分销商邮箱">{order.snapshotBuyerEmail}</Descriptions.Item>
        <Descriptions.Item label="分销商名称">{order.snapshotBuyerName ?? '—'}</Descriptions.Item>
        <Descriptions.Item label="总金额">
         {order.totalAmount}
        </Descriptions.Item>
        <Descriptions.Item label="下单时间">
          {dayjs(order.createdAt).format('YYYY-MM-DD HH:mm:ss')}
        </Descriptions.Item>
        <Descriptions.Item label="备注" span={2}>
          {order.remark ?? '—'}
        </Descriptions.Item>
      </Descriptions>

      <Descriptions bordered column={2} size="small" style={{ marginBottom: 16 }} title="收货地址">
        <Descriptions.Item label="收件人">{order.shippingAddress?.recipientName ?? '—'}</Descriptions.Item>
        <Descriptions.Item label="手机号">{order.shippingAddress?.phone ?? '—'}</Descriptions.Item>
        <Descriptions.Item label="邮编">{order.shippingAddress?.postalCode ?? '—'}</Descriptions.Item>
        <Descriptions.Item label="国家/地区">{order.shippingAddress?.countryRegion ?? '—'}</Descriptions.Item>
        <Descriptions.Item label="省/州">{order.shippingAddress?.stateProvince ?? '—'}</Descriptions.Item>
        <Descriptions.Item label="市">{order.shippingAddress?.city ?? '—'}</Descriptions.Item>
        <Descriptions.Item label="区">{order.shippingAddress?.district ?? '—'}</Descriptions.Item>
        <Descriptions.Item label="详细地址" span={2}>
          {order.shippingAddress?.addressLine ?? '—'}
        </Descriptions.Item>
      </Descriptions>

      <Table<OrderLine>
        rowKey="id"
        dataSource={order.lines ?? []}
        pagination={false}
        columns={[
          { title: 'SKU', dataIndex: 'sku', width: 180 },
          { title: '标题（快照）', dataIndex: 'titleSnapshot', ellipsis: true },
          { title: '数量', dataIndex: 'qty', width: 80 },
          {
            title: '单价（快照）',
            width: 160,
            render: (_: unknown, r: OrderLine) => String(r.unitPriceSnapshot),
          },
          {
            title: '小计',
            width: 160,
            render: (_: unknown, r: OrderLine) =>
              (Number(r.unitPriceSnapshot) * r.qty).toFixed(2),
          },
        ]}
        scroll={{ x: 720 }}
      />
    </Card>
  );
}
