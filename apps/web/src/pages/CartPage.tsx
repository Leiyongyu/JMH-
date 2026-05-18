import { Button, Card, Empty, Form, Input, InputNumber, Modal, Space, Table, App, Typography } from 'antd';
import { DeleteOutlined } from '@ant-design/icons';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { cart, useCart, type CartItem } from '../cart/cart';
import { ordersApi } from '../api/modules';

export function CartPage() {
  const items = useCart();
  const { message } = App.useApp();
  const navigate = useNavigate();
  const [remark, setRemark] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [addrOpen, setAddrOpen] = useState(false);
  const [addrForm] = Form.useForm();

  const total = items.reduce((sum, it) => sum + Number(it.unitPrice) * it.qty, 0);

  const submit = async () => {
    if (items.length === 0) {
      message.warning('购物车为空');
      return;
    }
    setAddrOpen(true);
  };

  const confirmOrder = async () => {
    if (items.length === 0) {
      message.warning('购物车为空');
      return;
    }
    const values = await addrForm.validateFields();
    setSubmitting(true);
    try {
      const order = await ordersApi.create({
        items: items.map((it) => ({ sku: it.sku, qty: it.qty })),
        remark: remark || undefined,
        shippingAddress: {
          recipientName: String(values.recipientName || '').trim(),
          phone: String(values.phone || '').trim(),
          postalCode: String(values.postalCode || '').trim() || undefined,
          countryRegion: String(values.countryRegion || '').trim(),
          stateProvince: String(values.stateProvince || '').trim(),
          city: String(values.city || '').trim(),
          district: String(values.district || '').trim() || undefined,
          addressLine: String(values.addressLine || '').trim(),
        },
      });
      cart.clear();
      setAddrOpen(false);
      addrForm.resetFields();
      message.success(`下单成功：${order.orderNo}`);
      navigate(`/orders/${order.orderNo}`);
    } catch (err: unknown) {
      const msg = axios.isAxiosError(err) ? err.response?.data?.message ?? '下单失败' : '下单失败';
      message.error(typeof msg === 'string' ? msg : '下单失败');
    } finally {
      setSubmitting(false);
    }
  };

  if (items.length === 0) {
    return (
      <Card>
        <Empty description="购物车为空">
          <Button type="primary" onClick={() => navigate('/products')}>
            去添加商品
          </Button>
        </Empty>
      </Card>
    );
  }

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Card title="购物车">
        <Table<CartItem>
          rowKey="sku"
          dataSource={items}
          pagination={false}
          columns={[
            { title: 'SKU', dataIndex: 'sku', width: 180 },
            { title: '标题', dataIndex: 'title', ellipsis: true },
            {
              title: '单价',
              width: 140,
              render: (_: unknown, r: CartItem) => `${Number(r.unitPrice).toFixed(2)}`,
            },
            {
              title: '数量',
              width: 140,
              render: (_: unknown, r: CartItem) => (
                <InputNumber min={1} value={r.qty} onChange={(v) => cart.setQty(r.sku, Number(v ?? 1))} />
              ),
            },
            {
              title: '小计',
              width: 140,
              render: (_: unknown, r: CartItem) =>
                `${(Number(r.unitPrice) * r.qty).toFixed(2)}`,
            },
            {
              title: '操作',
              width: 100,
              render: (_: unknown, r: CartItem) => (
                <Button danger size="small" icon={<DeleteOutlined />} onClick={() => cart.remove(r.sku)}>
                  删除
                </Button>
              ),
            },
          ]}
        />
      </Card>

      <Card title="提交订单">
        <Space direction="vertical" style={{ width: '100%' }} size={12}>
          <Input.TextArea
            rows={3}
            value={remark}
            placeholder="备注（可选）"
            onChange={(e) => setRemark(e.target.value)}
            maxLength={500}
            showCount
          />
          <Space style={{ width: '100%', justifyContent: 'space-between' }}>
            <Typography.Text strong>
              合计：{total.toFixed(2)}
            </Typography.Text>
            <Space>
              <Button onClick={() => cart.clear()}>清空购物车</Button>
              <Button type="primary" loading={submitting} onClick={submit}>
                提交订单
              </Button>
            </Space>
          </Space>
        </Space>
      </Card>

      <Modal
        title="收货地址"
        open={addrOpen}
        onCancel={() => {
          setAddrOpen(false);
        }}
        onOk={confirmOrder}
        okText="确认下单"
        cancelText="取消"
        confirmLoading={submitting}
        destroyOnHidden
      >
        <Form form={addrForm} layout="vertical">
          <Form.Item label="收件人" name="recipientName" rules={[{ required: true, message: '请输入收件人姓名' }]}>
            <Input placeholder="请输入收件人姓名" />
          </Form.Item>

          <Form.Item label="手机号" name="phone" rules={[{ required: true, message: '请输入手机号' }]}>
            <Input placeholder="请输入手机号" />
          </Form.Item>

          <Form.Item label="邮编" name="postalCode" rules={[{ required: true, message: '请输入邮编' }]}>
            <Input placeholder="请输入邮编" />
          </Form.Item>

          <Form.Item label="国家/地区" name="countryRegion" rules={[{ required: true, message: '请输入国家/地区' }]}>
            <Input placeholder="国家/地区" />
          </Form.Item>

          <Form.Item label="省/州" name="stateProvince" rules={[{ required: true, message: '请输入省/州' }]}>
            <Input placeholder="省/州" />
          </Form.Item>

          <Form.Item label="市" name="city" rules={[{ required: true, message: '请输入市' }]}>
            <Input placeholder="市" />
          </Form.Item>

          <Form.Item label="区" name="district">
            <Input placeholder="区" />
          </Form.Item>

          <Form.Item label="详细地址" name="addressLine" rules={[{ required: true, message: '请输入详细地址' }]}>
            <Input.TextArea rows={3} placeholder="请输入详细地址，如街道名称、门牌号等" />
          </Form.Item>
        </Form>
      </Modal>
    </Space>
  );
}
