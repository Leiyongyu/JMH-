import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EbayProduct } from './ebay-product.entity';
import { EbaySkuPriceSelection } from './ebay-sku-price-selection.entity';
import { ProductsService } from './products.service';
import { ProductsController } from './products.controller';
import { ProductsSyncService } from './products-sync.service';
import { EbayItemPageService } from './scrape/ebay-item-page.service';
import { EbayOfficialProductsSyncService } from './ebay-official-products-sync.service';
import { EbayOfficialProductsService } from './ebay-official-products.service';
import { EbayModule } from '../ebay/ebay.module';
import { LingxingModule } from '../lingxing/lingxing.module';
import { SyncModule } from '../sync/sync.module';
import { InventoryLine } from '../inventory/inventory-line.entity';

@Module({
  imports: [TypeOrmModule.forFeature([EbayProduct, EbaySkuPriceSelection, InventoryLine]), LingxingModule, SyncModule, EbayModule],
  providers: [ProductsService, ProductsSyncService, EbayOfficialProductsSyncService, EbayOfficialProductsService, EbayItemPageService],
  controllers: [ProductsController],
  exports: [ProductsService, ProductsSyncService, EbayOfficialProductsSyncService, EbayOfficialProductsService, EbayItemPageService],
})
export class ProductsModule {}
