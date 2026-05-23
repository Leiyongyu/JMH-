import { Button, Card, Checkbox, Image, Space, Tag, Tooltip, Typography } from 'antd';
import { DeleteOutlined, EditOutlined, ShoppingCartOutlined } from '@ant-design/icons';
import type { EbayProduct } from '../api/types';

const PLACEHOLDER_IMG =
  'https://coresg-normal.trae.ai/api/ide/v1/text_to_image?prompt=clean%20minimal%20e-commerce%20product%20photo%20placeholder%2C%20studio%20lighting%2C%20soft%20shadow%2C%20neutral%20background%2C%20no%20text%2C%20no%20logo%2C%20modern%20style&image_size=landscape_4_3';

function pickImageUrl(p: EbayProduct): string {
  const raw = (p.rawPayload ?? {}) as Record<string, unknown>;
  const arrays = [raw.picture_urls, raw.pictureUrls, raw.images, raw.image_urls, raw.imageUrls, raw.image_list, raw.imageList, raw.gallery, raw.galleryUrls];
  for (const arr of arrays) {
    if (Array.isArray(arr)) {
      for (const it of arr) {
        if (typeof it === 'string' && it.trim()) return it.trim();
      }
    }
  }
  const candidates = [
    raw.picture_url,
    raw.pictureUrl,
    raw.main_image,
    raw.mainImage,
    raw.image,
    raw.image_url,
    raw.imageUrl,
  ];
  for (const c of candidates) {
    if (typeof c === 'string' && c.trim()) return c.trim();
  }
  const image = raw.image as Record<string, unknown> | null | undefined;
  if (image && typeof image === 'object') {
    const u = image.imageUrl;
    if (typeof u === 'string' && u.trim()) return u.trim();
  }
  const addImgs = raw.additionalImages;
  if (Array.isArray(addImgs)) {
    for (const it of addImgs) {
      if (it && typeof it === 'object') {
        const u = (it as Record<string, unknown>).imageUrl;
        if (typeof u === 'string' && u.trim()) return u.trim();
      }
    }
  }
  return PLACEHOLDER_IMG;
}

export function EbayProductCard(props: {
  product: EbayProduct;
  onOpen: () => void;
  onAddToCart: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
  selectable?: boolean;
  selected?: boolean;
  onSelect?: (sku: string, checked: boolean) => void;
}) {
  const p = props.product;
  const imgUrl = pickImageUrl(p);
  const rmbPrice = p.rmbPrice ? Number(p.rmbPrice) : null;
  const priceAmount = rmbPrice !== null ? rmbPrice.toFixed(2) : Number(p.price || 0).toFixed(2);
  const priceCurrency = rmbPrice !== null ? 'RMB' : String(p.currency || '').trim() || 'EUR';
  const qty = p.availableQty !== null && p.availableQty !== undefined ? Number(p.availableQty) : Number(p.stockQty || 0);
  const lowStock = qty < 10;
  const outOfStock = qty <= 0;

  return (
    <div
      className="product-card"
      onClick={props.onOpen}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          props.onOpen();
        }
      }}
      style={{ cursor: 'pointer' }}
      role="button"
      tabIndex={0}
    >
      <Card
        hoverable
        variant="borderless"
        styles={{ body: { padding: 12 } }}
        className="product-card__inner"
        cover={
          <div className="product-card__cover" style={{ position: 'relative', width: '100%', aspectRatio: '4 / 3', overflow: 'hidden' }}>
            <Image
              src={imgUrl}
              alt={p.title || p.sku}
              fallback={PLACEHOLDER_IMG}
              preview={false}
              style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
            />
            {props.selectable && (
              <div
                style={{
                  position: 'absolute',
                  top: 6,
                  left: 6,
                  zIndex: 2,
                  background: 'rgba(255,255,255,0.85)',
                  borderRadius: 6,
                  padding: '2px 4px',
                }}
                onClick={(e) => e.stopPropagation()}
              >
                <Checkbox
                  checked={props.selected ?? false}
                  onChange={(e) => props.onSelect?.(p.sku, e.target.checked)}
                />
              </div>
            )}
            {outOfStock && (
              <div
                style={{
                  position: 'absolute',
                  inset: 0,
                  background: 'rgba(255,255,255,0.72)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Tag color="error" style={{ fontSize: 14, padding: '6px 10px' }}>
                  缺货
                </Tag>
              </div>
            )}
          </div>
        }
      >
        <Space direction="vertical" size={8} style={{ width: '100%' }}>
          <Typography.Text
            strong
            ellipsis={{ tooltip: p.title || p.sku }}
            style={{ lineHeight: 1.2 }}
          >
            {p.title || '（无标题）'}
          </Typography.Text>

          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            SKU：{p.sku}
          </Typography.Text>

          <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between' }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, flexWrap: 'nowrap', color: '#cf1322' }}>
                <span style={{ fontSize: 18, fontWeight: 700, lineHeight: 1 }}>{priceAmount}</span>
                <span style={{ fontSize: 12, fontWeight: 600, lineHeight: 1 }}>{priceCurrency}</span>
              </div>
              <div style={{ marginTop: 2 }}>
                <Tag color={outOfStock ? 'error' : lowStock ? 'warning' : 'success'}>
                  {outOfStock ? '库存不足' : lowStock ? `库存偏低：${qty}` : `库存充足：${qty}`}
                </Tag>
              </div>
            </div>

            <Space size={4}>
              {props.onDelete && (
                <Tooltip title="下架">
                  <Button
                    size="small"
                    danger
                    icon={<DeleteOutlined />}
                    onClick={(e) => {
                      e.stopPropagation();
                      props.onDelete?.();
                    }}
                  />
                </Tooltip>
              )}
              {props.onEdit && (
                <Tooltip title="编辑">
                  <Button
                    size="small"
                    icon={<EditOutlined />}
                    onClick={(e) => {
                      e.stopPropagation();
                      props.onEdit?.();
                    }}
                  />
                </Tooltip>
              )}
              <Button
                size="small"
                type="primary"
                icon={<ShoppingCartOutlined />}
                onClick={(e) => {
                  e.stopPropagation();
                  props.onAddToCart();
                }}
              >
                加购
              </Button>
            </Space>
          </div>
        </Space>
      </Card>
    </div>
  );
}
