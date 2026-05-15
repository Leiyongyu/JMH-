import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CartItem } from './cart-item.entity';
import { EbayProduct } from '../products/ebay-product.entity';

@Injectable()
export class CartService {
  constructor(
    @InjectRepository(CartItem) private readonly cartRepo: Repository<CartItem>,
    @InjectRepository(EbayProduct) private readonly productsRepo: Repository<EbayProduct>,
  ) {}

  list(userId: string) {
    return this.cartRepo.find({ where: { userId }, order: { updatedAt: 'DESC' } });
  }

  async add(userId: string, sku: string, qty: number) {
    const normalizedSku = sku.trim();
    if (!normalizedSku) throw new BadRequestException('sku 不能为空');
    if (!Number.isFinite(qty) || qty <= 0) throw new BadRequestException('qty 必须大于 0');

    const product = await this.productsRepo.findOne({ where: { sku: normalizedSku } });
    if (!product) throw new NotFoundException(`未找到商品 SKU=${sku}`);

    const existing = await this.cartRepo.findOne({ where: { userId, sku: normalizedSku } });
    if (existing) {
      existing.qty += qty;
      existing.titleSnapshot = product.title ?? null;
      existing.unitPriceSnapshot = String(product.price);
      existing.currencySnapshot = product.currency;
      existing.itemUrlSnapshot = product.itemUrl ?? null;
      existing.ebayProductRef = product.id;
      return this.cartRepo.save(existing);
    }

    const item = this.cartRepo.create({
      userId,
      sku: normalizedSku,
      qty,
      titleSnapshot: product.title ?? null,
      unitPriceSnapshot: String(product.price),
      currencySnapshot: product.currency,
      itemUrlSnapshot: product.itemUrl ?? null,
      ebayProductRef: product.id,
    });
    return this.cartRepo.save(item);
  }

  async setQty(userId: string, sku: string, qty: number) {
    if (!Number.isFinite(qty) || qty <= 0) throw new BadRequestException('qty 必须大于 0');

    const normalizedSku = sku.trim();

    const item = await this.cartRepo.findOne({ where: { userId, sku: normalizedSku } });
    if (!item) throw new NotFoundException(`购物车不存在 SKU=${sku}`);

    const product = await this.productsRepo.findOne({ where: { sku: normalizedSku } });
    if (product) {
      item.titleSnapshot = product.title ?? null;
      item.unitPriceSnapshot = String(product.price);
      item.currencySnapshot = product.currency;
      item.itemUrlSnapshot = product.itemUrl ?? null;
      item.ebayProductRef = product.id;
    }

    item.qty = qty;
    return this.cartRepo.save(item);
  }

  async remove(userId: string, sku: string) {
    await this.cartRepo.delete({ userId, sku: sku.trim() });
    return { ok: true };
  }

  async clear(userId: string) {
    await this.cartRepo.delete({ userId });
    return { ok: true };
  }
}
