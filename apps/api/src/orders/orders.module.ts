import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DistributorOrder } from './order.entity';
import { OrderLine } from './order-line.entity';
import { OrderShippingAddress } from './order-shipping-address.entity';
import { OrdersService } from './orders.service';
import { OrdersController } from './orders.controller';
import { EbayProduct } from '../products/ebay-product.entity';
import { User } from '../users/user.entity';
import { LingxingModule } from '../lingxing/lingxing.module';
import { LingxingOrderLink } from './lingxing-order-link.entity';
import { LingxingOrderPushService } from './lingxing-order-push.service';
import { OrdersLingxingController } from './orders-lingxing.controller';
import { LingxingOrderRetryService } from './lingxing-order-retry.service';
import { LingxingOrderStatusSyncService } from './lingxing-order-status-sync.service';
import { SyncModule } from '../sync/sync.module';
import { LingxingWarehouse } from '../warehouses/lingxing-warehouse.entity';
import { AccessControlModule } from '../access/access-control.module';

@Module({
  imports: [TypeOrmModule.forFeature([DistributorOrder, OrderLine, OrderShippingAddress, EbayProduct, User, LingxingOrderLink, LingxingWarehouse]), LingxingModule, SyncModule, AccessControlModule],
  providers: [OrdersService, LingxingOrderPushService, LingxingOrderRetryService, LingxingOrderStatusSyncService],
  controllers: [OrdersController, OrdersLingxingController],
  exports: [OrdersService, LingxingOrderStatusSyncService],
})
export class OrdersModule {}
