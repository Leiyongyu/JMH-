import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CartItem } from './cart-item.entity';
import { CartController } from './cart.controller';
import { CartService } from './cart.service';
import { EbayProduct } from '../products/ebay-product.entity';

@Module({
  imports: [TypeOrmModule.forFeature([CartItem, EbayProduct])],
  controllers: [CartController],
  providers: [CartService],
})
export class CartModule {}

