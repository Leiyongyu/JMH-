import { Button, Card, Col, Descriptions, Empty, Form, Image, Input, InputNumber, Modal, Row, Skeleton, Space, Tag, Tabs, Typography, App, Table, Select } from 'antd';
import { ArrowLeftOutlined, ShoppingCartOutlined } from '@ant-design/icons';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import type { EbayItemSpecificRow, EbayProduct, EbayTradingGetItemResult, EbayTradingVehicleRow, InventoryLine } from '../api/types';
import { useEffect, useMemo, useState } from 'react';
import { cart } from '../cart/cart';
import { inventoryApi, ordersApi, productsApi } from '../api/modules';

const PLACEHOLDER_IMG =
  'https://coresg-normal.trae.ai/api/ide/v1/text_to_image?prompt=clean%20minimal%20e-commerce%20product%20photo%20placeholder%2C%20studio%20lighting%2C%20soft%20shadow%2C%20neutral%20background%2C%20no%20text%2C%20no%20logo%2C%20modern%20style&image_size=landscape_4_3';

function pickImageUrls(p: EbayProduct): string[] {
  const raw = (p.rawPayload ?? {}) as Record<string, unknown>;
  const urls: string[] = [];

  const add = (u: unknown) => {
    if (typeof u === 'string' && u.trim()) urls.push(u.trim());
  };

  add(raw.picture_url);
  add(raw.pictureUrl);
  add(raw.main_image);
  add(raw.mainImage);
  if (raw.image && typeof raw.image === 'object') {
    add((raw.image as Record<string, unknown>).imageUrl);
  } else {
    add(raw.image);
  }
  add(raw.image_url);
  add(raw.imageUrl);

  const arrays = [
    raw.picture_urls,
    raw.pictureUrls,
    raw.images,
    raw.image_urls,
    raw.imageUrls,
    raw.image_list,
    raw.imageList,
    raw.gallery,
    raw.galleryUrls,
  ];
  for (const arr of arrays) {
    if (Array.isArray(arr)) {
      for (const it of arr) add(it);
    }
  }
  if (Array.isArray(raw.additionalImages)) {
    for (const it of raw.additionalImages) {
      if (it && typeof it === 'object') add((it as Record<string, unknown>).imageUrl);
    }
  }

  const unique = Array.from(new Set(urls));
  return unique.length ? unique : [PLACEHOLDER_IMG];
}

function pickText(raw: Record<string, unknown>, keys: string[]): string | null {
  for (const k of keys) {
    const v = raw[k];
    if (typeof v === 'string' && v.trim()) return v.trim();
    if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  }
  return null;
}

function normKey(s: string): string {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function pickSpecificValue(rows: EbayItemSpecificRow[], keys: string[]): string | null {
  const want = keys.map((k) => normKey(k)).filter(Boolean);
  for (const r of rows) {
    const k = normKey(r.name);
    if (!k) continue;
    if (want.some((w) => k === w || k.includes(w))) {
      const v = String(r.value ?? '').trim();
      if (v) return v;
    }
  }
  return null;
}

type LocationState = { product?: EbayProduct };

export function ProductDetailPage() {
  const navigate = useNavigate();
  const { message } = App.useApp();
  const location = useLocation();
  const params = useParams();
  const skuParam = decodeURIComponent(String(params.sku ?? '')).trim();
  const state = (location.state || {}) as LocationState;
  const [product, setProduct] = useState<EbayProduct | null>(state.product ?? null);
  const [loading, setLoading] = useState(false);
  const [qty, setQty] = useState(1);
  const [activeImg, setActiveImg] = useState<string>(PLACEHOLDER_IMG);
  const [addrOpen, setAddrOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [addrForm] = Form.useForm();
  const [invLoading, setInvLoading] = useState(false);
  const [invLines, setInvLines] = useState<InventoryLine[]>([]);
  const [selectedWarehouseCode, setSelectedWarehouseCode] = useState<string | null>(null);
  const [official, setOfficial] = useState<EbayTradingGetItemResult | null>(null);
  const [officialLoading, setOfficialLoading] = useState(false);

  useEffect(() => {
    if (!skuParam) return;
    setLoading(true);
    productsApi
      .bySku(skuParam)
      .then((p) => setProduct(p ?? null))
      .catch(() => setProduct(null))
      .finally(() => setLoading(false));
  }, [skuParam]);

  useEffect(() => {
    if (!skuParam) return;
    setOfficial(null);
    setOfficialLoading(true);
    productsApi
      .officialLiveBySku(skuParam)
      .then((d) => setOfficial(d ?? null))
      .catch(() => setOfficial(null))
      .finally(() => setOfficialLoading(false));
  }, [skuParam]);

  useEffect(() => {
    if (!skuParam) return;
    setInvLoading(true);
    inventoryApi
      .lines({ sku: skuParam, platform: 'LINGXING', page: 1, pageSize: 100 })
      .then((r) => {
        const items = (r.items ?? []).filter((x) => String(x.sku || '').toLowerCase() === skuParam.toLowerCase());
        const map = new Map<string, InventoryLine>();
        for (const it of items) {
          if (!map.has(it.warehouseCode)) map.set(it.warehouseCode, it);
        }
        const unique = Array.from(map.values()).filter((x) => x.warehouseName && String(x.warehouseName).trim());
        setInvLines(unique);
        if (unique.length) {
          setSelectedWarehouseCode((prev) => {
            if (prev && unique.some((x) => x.warehouseCode === prev)) return prev;
            const firstNamed = unique.find((x) => x.warehouseName && String(x.warehouseName).trim());
            return (firstNamed ?? unique[0]).warehouseCode;
          });
        } else {
          setSelectedWarehouseCode(null);
        }
      })
      .finally(() => setInvLoading(false));
  }, [skuParam]);

  if (!skuParam) {
    return (
      <Card variant="borderless" style={{ boxShadow: '0 1px 8px rgba(0,0,0,0.08)' }}>
        <Empty description="无效的商品 SKU" />
        <div style={{ textAlign: 'center', marginTop: 12 }}>
          <Button type="primary" onClick={() => navigate('/products', { replace: true })}>
            返回商品列表
          </Button>
        </div>
      </Card>
    );
  }

  if (loading && !product) {
    return (
      <Card variant="borderless" style={{ boxShadow: '0 1px 8px rgba(0,0,0,0.08)' }}>
        <Skeleton active paragraph={{ rows: 6 }} />
      </Card>
    );
  }

  if (!product) {
    return (
      <Card variant="borderless" style={{ boxShadow: '0 1px 8px rgba(0,0,0,0.08)' }}>
        <Empty description="未找到该商品（可能已下架或未同步）" />
        <div style={{ textAlign: 'center', marginTop: 12 }}>
          <Button type="primary" onClick={() => navigate('/products', { replace: true })}>
            返回商品列表
          </Button>
        </div>
      </Card>
    );
  }

  const rmbPrice = product.rmbPrice ? Number(product.rmbPrice) : null;
  const currency = String(product.currency || '').trim().toUpperCase() || 'EUR';

  const fxRmbPer = (c: string) => {
    const env = import.meta.env as unknown as Record<string, string | undefined>;
    const k = `VITE_FX_RMB_PER_${c}`;
    const v = env[k];
    const n = v ? Number(v) : NaN;
    if (Number.isFinite(n) && n > 0) return n;
    const defaults: Record<string, number> = { EUR: 7.8, USD: 7.2, GBP: 9.2, CNY: 1, RMB: 1 };
    return defaults[c] ?? null;
  };

  const foreignPrice = (() => {
    if (rmbPrice !== null) {
      const rate = fxRmbPer(currency);
      if (rate) return rmbPrice / rate;
    }
    return Number(product.price || 0);
  })();

  const priceText = `${foreignPrice.toFixed(2)} ${currency}${rmbPrice !== null ? ` / ${rmbPrice.toFixed(2)} RMB` : ''}`;
  const raw = (product.rawPayload ?? {}) as Record<string, unknown>;
  const imgUrls = useMemo(() => pickImageUrls(product), [product]);

  useEffect(() => {
    setActiveImg(imgUrls[0] ?? PLACEHOLDER_IMG);
  }, [product?.sku]);

  const confirmOrder = async () => {
    if (!product) return;
    const values = await addrForm.validateFields();
    setSubmitting(true);
    try {
      const order = await ordersApi.create({
        items: [{ sku: product.sku, qty }],
        shipWarehouseCode: selectedWarehouseCode ?? undefined,
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
      setAddrOpen(false);
      addrForm.resetFields();
      message.success(`下单成功：${order.orderNo}`);
      navigate(`/orders/${order.orderNo}`);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? '下单失败';
      message.error(msg);
    } finally {
      setSubmitting(false);
    }
  };

  const itemId = pickText(raw, ['item_id', 'itemId']);
  const localSku = pickText(raw, ['local_sku', 'localSku']);
  const localName = pickText(raw, ['local_name', 'localName']);

  const selectedInv = useMemo(() => {
    if (!selectedWarehouseCode) return null;
    return invLines.find((x) => x.warehouseCode === selectedWarehouseCode) ?? null;
  }, [invLines, selectedWarehouseCode]);

  const stockQtyForOrder = useMemo(() => {
    const invQty = selectedInv?.availableQty;
    if (invQty !== null && invQty !== undefined && Number.isFinite(Number(invQty))) {
      return Math.max(0, Number(invQty));
    }
    return Math.max(0, Number(product.stockQty ?? 0));
  }, [product.stockQty, selectedInv?.availableQty]);

  const lowStock = stockQtyForOrder < 10;
  const outOfStock = stockQtyForOrder <= 0;

  const warehouseNode = useMemo(() => {
    if (invLoading) return <Typography.Text type="secondary">加载中…</Typography.Text>;
    if (!invLines.length) return <Typography.Text type="secondary">—</Typography.Text>;

    const options = invLines.map((x) => ({
      label: String(x.warehouseName).trim(),
      value: x.warehouseCode,
    }));

    const line = selectedInv ?? invLines[0];
    return (
      <Space direction="vertical" size={4} style={{ width: '100%' }}>
        <Select
          style={{ width: '100%' }}
          value={selectedWarehouseCode ?? line.warehouseCode}
          onChange={(v) => setSelectedWarehouseCode(v)}
          options={options}
          disabled={options.length <= 1}
        />
        <Typography.Text type="secondary">库存 {line.availableQty}</Typography.Text>
      </Space>
    );
  }, [invLoading, invLines, selectedInv, selectedWarehouseCode]);

  const officialSpecifics = official?.specifics ?? [];
  const officialVehicleItems = official?.vehicles?.items ?? [];

  const specItems = useMemo(() => {
    const items = [
      { key: 'sku', label: 'SKU', children: product.sku },
      { key: 'localSku', label: '本地 SKU', children: localSku ?? '—' },
      { key: 'site', label: '发货仓', children: warehouseNode },
      { key: 'localName', label: '本地名称', children: localName ?? '—' },
      { key: 'gtin', label: 'GTIN/EAN', children: pickSpecificValue(officialSpecifics, ['GTIN', 'EAN']) ?? '—' },
      { key: 'condition', label: '物品状况', children: official?.basic?.condition ?? '—' },
      { key: 'seller', label: '卖家', children: official?.basic?.sellerUsername ?? '—' },
      { key: 'lastSync', label: '最后同步', children: product.syncedAt ?? '—' },
    ];
    return items;
  }, [
    itemId,
    localName,
    localSku,
    official?.basic?.condition,
    official?.basic?.sellerUsername,
    officialSpecifics,
    product.sku,
    product.syncedAt,
    warehouseNode,
  ]);

  const detailRows = useMemo(() => {
    if (officialLoading) return null;
    if (officialSpecifics.length) return officialSpecifics;
    return null;
  }, [officialLoading, officialSpecifics, product?.sku]);

  const vehicleRows = useMemo(() => {
    if (officialLoading) return null;
    if (officialVehicleItems.length) return officialVehicleItems;
    return null;
  }, [officialLoading, officialVehicleItems, product?.sku]);

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Card
        variant="borderless"
        styles={{ body: { padding: 16 } }}
        style={{ boxShadow: '0 1px 8px rgba(0,0,0,0.08)' }}
      >
        <Space size={12} style={{ width: '100%', justifyContent: 'space-between' }}>
          <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/products')}>
            返回列表
          </Button>
          <Space size={8} wrap>
            <Tag color={product.status === 'ACTIVE' ? 'success' : 'default'}>{product.status || 'UNKNOWN'}</Tag>
            <Tag color={outOfStock ? 'error' : lowStock ? 'warning' : 'success'}>
              {outOfStock ? '库存不足' : lowStock ? `库存偏低：${stockQtyForOrder}` : `库存充足：${stockQtyForOrder}`}
            </Tag>
          </Space>
        </Space>
      </Card>

      <Card variant="borderless" styles={{ body: { padding: 16 } }} style={{ boxShadow: '0 1px 8px rgba(0,0,0,0.08)' }}>
        <Row gutter={[16, 16]} align="stretch">
          <Col xs={24} lg={14} style={{ display: 'flex' }}>
            <div style={{ width: '100%', aspectRatio: '4 / 3', overflow: 'hidden', borderRadius: 12 }}>
              <Image
                src={activeImg}
                fallback={PLACEHOLDER_IMG}
                alt={product.title || product.sku}
                style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
              />
            </div>
          </Col>
          <Col xs={24} lg={10} style={{ display: 'flex' }}>
            {imgUrls.length > 1 ? (
              <div
                style={{
                  width: '100%',
                  borderRadius: 12,
                  border: '1px solid #f0f0f0',
                  padding: 12,
                  overflowY: 'auto',
                  maxHeight: 420,
                }}
              >
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fill, minmax(72px, 1fr))',
                    gap: 10,
                  }}
                >
                  {imgUrls.map((u) => (
                    <div
                      key={u}
                      onClick={() => setActiveImg(u)}
                      role="button"
                      tabIndex={0}
                      style={{
                        cursor: 'pointer',
                        borderRadius: 10,
                        overflow: 'hidden',
                        border: u === activeImg ? '2px solid #1677ff' : '1px solid #f0f0f0',
                        boxShadow: u === activeImg ? '0 6px 16px rgba(22,119,255,0.18)' : 'none',
                      }}
                    >
                      <Image src={u} preview={false} fallback={PLACEHOLDER_IMG} alt="thumb" style={{ width: '100%', height: 56, objectFit: 'cover', display: 'block' }} />
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <Empty description="暂无详情图" />
            )}
          </Col>
        </Row>
      </Card>

      <Card variant="borderless" styles={{ body: { padding: 16 } }} style={{ boxShadow: '0 1px 8px rgba(0,0,0,0.08)' }}>
        <Row gutter={[16, 16]} align="top">
          <Col xs={24} lg={14}>
            <Space direction="vertical" size={12} style={{ width: '100%' }}>
              <div>
                <Typography.Title level={4} style={{ margin: 0 }}>
                  {product.title || '（无标题）'}
                </Typography.Title>
                <Typography.Text type="secondary">SKU：{product.sku}</Typography.Text>
              </div>
              <Descriptions size="small" column={2} items={specItems} />
            </Space>
          </Col>
          <Col xs={24} lg={10}>
            <Card
              size="small"
              styles={{ body: { padding: 12 } }}
              style={{ background: '#fff', borderRadius: 12, border: '1px solid #f0f0f0' }}
            >
              <Space direction="vertical" size={10} style={{ width: '100%' }}>
                <div>
                  <div style={{ fontSize: 22, fontWeight: 800, color: '#cf1322', lineHeight: 1.2 }}>{priceText}</div>
                  <Typography.Text type="secondary">一口价</Typography.Text>
                </div>
                <Space wrap size={12} style={{ width: '100%', justifyContent: 'flex-end' }}>
                  <Space size={8}>
                    <Typography.Text>购买数量</Typography.Text>
                    <InputNumber min={1} max={Math.max(1, stockQtyForOrder || 1)} value={qty} onChange={(v) => setQty(Number(v ?? 1))} />
                  </Space>
                  <Button type="primary" disabled={outOfStock} loading={submitting} onClick={() => setAddrOpen(true)}>
                    立即下单
                  </Button>
                  <Button
                    type="default"
                    icon={<ShoppingCartOutlined />}
                    disabled={outOfStock}
                    onClick={() => {
                      cart.add({
                        sku: product.sku,
                        title: product.title,
                        qty,
                        unitPrice: product.price,
                        currency: product.currency,
                        itemUrl: product.itemUrl,
                      });
                      message.success(`已加入购物车：${product.sku} × ${qty}`);
                    }}
                  >
                    加入购物车
                  </Button>
                </Space>
              </Space>
            </Card>
          </Col>
        </Row>
      </Card>

      <Card variant="borderless" styles={{ body: { padding: 16 } }} style={{ boxShadow: '0 1px 8px rgba(0,0,0,0.08)' }}>
        <Tabs
          items={[
            {
              key: 'detail',
              label: '商品细节',
              children: officialLoading ? (
                <Skeleton active paragraph={{ rows: 6 }} />
              ) : detailRows ? (
                <Table<EbayItemSpecificRow>
                  rowKey={(r) => `${normKey(r.name)}:${normKey(r.value)}`}
                  size="small"
                  pagination={{ pageSize: 20, showSizeChanger: true }}
                  dataSource={detailRows}
                  columns={[
                    { title: '名称', dataIndex: 'name', width: 260 },
                    { title: '值', dataIndex: 'value' },
                  ]}
                  scroll={{ x: true }}
                />
              ) : (
                <Empty description="暂无商品细节" />
              ),
            },
            {
              key: 'fitment',
              label: '适配车型',
              children: officialLoading ? (
                <Skeleton active paragraph={{ rows: 6 }} />
              ) : vehicleRows ? (
                <Space direction="vertical" size={8} style={{ width: '100%' }}>
                  <Table<EbayTradingVehicleRow>
                    rowKey={(r, idx) =>
                      `${r.Marke ?? ''}|${r.Modell ?? ''}|${r.Baujahr ?? ''}|${r.Plattform ?? ''}|${r.Typ ?? ''}|${r.Motor ?? ''}|${idx}`
                    }
                    size="small"
                    pagination={{ pageSize: 20, showSizeChanger: true, total: vehicleRows.length }}
                    dataSource={vehicleRows}
                    columns={[
                      { title: 'Marke', dataIndex: 'Marke', width: 140 },
                      { title: 'Modell', dataIndex: 'Modell', width: 160 },
                      { title: 'Baujahr', dataIndex: 'Baujahr', width: 140 },
                      { title: 'Plattform', dataIndex: 'Plattform', width: 160 },
                      { title: 'Typ', dataIndex: 'Typ', width: 220 },
                      { title: 'Motor', dataIndex: 'Motor', width: 240 },
                      { title: 'Einschränkungen', dataIndex: 'Einschraenkungen', width: 320 },
                    ]}
                    scroll={{ x: 1400 }}
                  />
                </Space>
              ) : (
                <Empty description="暂无适配车型" />
              ),
            },
          ]}
        />
      </Card>

      <Modal
        title="收货地址"
        open={addrOpen}
        onCancel={() => setAddrOpen(false)}
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
