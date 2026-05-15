import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LingxingModule } from '../lingxing/lingxing.module';
import { SyncModule } from '../sync/sync.module';
import { LingxingWarehouse } from './lingxing-warehouse.entity';
import { WarehousesService } from './warehouses.service';
import { WarehousesSyncService } from './warehouses-sync.service';

@Module({
  imports: [TypeOrmModule.forFeature([LingxingWarehouse]), LingxingModule, SyncModule],
  providers: [WarehousesService, WarehousesSyncService],
  exports: [WarehousesService, WarehousesSyncService],
})
export class WarehousesModule {}

