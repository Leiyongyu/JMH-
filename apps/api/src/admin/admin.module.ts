import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminUsersController } from './admin-users.controller';
import { InventoryModule } from '../inventory/inventory.module';
import { ProductsModule } from '../products/products.module';
import { SyncModule } from '../sync/sync.module';
import { UsersModule } from '../users/users.module';
import { WarehousesModule } from '../warehouses/warehouses.module';
import { OrdersModule } from '../orders/orders.module';
import { EbayModule } from '../ebay/ebay.module';

@Module({
  imports: [InventoryModule, WarehousesModule, ProductsModule, OrdersModule, SyncModule, UsersModule, EbayModule],
  controllers: [AdminController, AdminUsersController],
})
export class AdminModule {}
