import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { InventoryLine } from './inventory-line.entity';
import { InventoryService } from './inventory.service';
import { InventoryController } from './inventory.controller';
import { InventorySyncService } from './inventory-sync.service';
import { LingxingModule } from '../lingxing/lingxing.module';
import { WarehousesModule } from '../warehouses/warehouses.module';
import { SyncModule } from '../sync/sync.module';

@Module({
  imports: [TypeOrmModule.forFeature([InventoryLine]), LingxingModule, WarehousesModule, SyncModule],
  providers: [InventoryService, InventorySyncService],
  controllers: [InventoryController],
  exports: [InventoryService, InventorySyncService],
})
export class InventoryModule {}
