import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, JwtUser } from '../common/current-user.decorator';
import { CartService } from './cart.service';
import { AddCartItemDto } from './dto/add-cart-item.dto';
import { SetCartItemQtyDto } from './dto/set-cart-item-qty.dto';

@ApiTags('cart')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('cart')
export class CartController {
  constructor(private readonly cart: CartService) {}

  @ApiOperation({ summary: '获取我的购物车' })
  @Get()
  async list(@CurrentUser() user: JwtUser) {
    const items = await this.cart.list(user.sub);
    return items.map((it) => ({
      sku: it.sku,
      title: it.titleSnapshot,
      qty: it.qty,
      unitPrice: it.unitPriceSnapshot,
      currency: it.currencySnapshot,
      itemUrl: it.itemUrlSnapshot,
    }));
  }

  @ApiOperation({ summary: '加入购物车（累加）' })
  @Post('items')
  async add(@CurrentUser() user: JwtUser, @Body() dto: AddCartItemDto) {
    const it = await this.cart.add(user.sub, dto.sku, dto.qty);
    return {
      sku: it.sku,
      title: it.titleSnapshot,
      qty: it.qty,
      unitPrice: it.unitPriceSnapshot,
      currency: it.currencySnapshot,
      itemUrl: it.itemUrlSnapshot,
    };
  }

  @ApiOperation({ summary: '设置购物车数量' })
  @Patch('items/:sku')
  async setQty(@CurrentUser() user: JwtUser, @Param('sku') sku: string, @Body() dto: SetCartItemQtyDto) {
    const it = await this.cart.setQty(user.sub, sku, dto.qty);
    return {
      sku: it.sku,
      title: it.titleSnapshot,
      qty: it.qty,
      unitPrice: it.unitPriceSnapshot,
      currency: it.currencySnapshot,
      itemUrl: it.itemUrlSnapshot,
    };
  }

  @ApiOperation({ summary: '移除购物车商品' })
  @Delete('items/:sku')
  remove(@CurrentUser() user: JwtUser, @Param('sku') sku: string) {
    return this.cart.remove(user.sub, sku);
  }

  @ApiOperation({ summary: '清空购物车' })
  @Delete()
  clear(@CurrentUser() user: JwtUser) {
    return this.cart.clear(user.sub);
  }
}

