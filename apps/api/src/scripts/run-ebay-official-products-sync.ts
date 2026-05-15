import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { DataSource } from 'typeorm';
import { AppModule } from '../app.module';
import { EbayOfficialProductsSyncService } from '../products/ebay-official-products-sync.service';

async function main() {
  process.env.EBAY_OFFICIAL_SYNC_LIMIT = process.env.EBAY_OFFICIAL_SYNC_LIMIT || '1';
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  try {
    const ds = app.get(DataSource);
    const svc = app.get(EbayOfficialProductsSyncService);

    const sources = await ds.query(
      `SELECT sku, item_url AS itemUrl FROM ebay_products WHERE item_url IS NOT NULL AND item_url<>'' ORDER BY updated_at DESC LIMIT 1`,
    );
    console.log({ sources: sources.length, sample: sources?.[0] ?? null });

    const run = await svc.run('script');
    console.log({ run });

    const mainCount = await ds.query(`SELECT COUNT(1) as c FROM ebay_products_main`);
    const detailCount = await ds.query(`SELECT COUNT(1) as c FROM ebay_product_details`);
    const vehicleCount = await ds.query(`SELECT COUNT(1) as c FROM ebay_product_vehicles`);
    console.log({
      ebay_products_main: mainCount?.[0]?.c,
      ebay_product_details: detailCount?.[0]?.c,
      ebay_product_vehicles: vehicleCount?.[0]?.c,
    });

    const sampleMain = await ds.query(
      `SELECT sku,item_id,title,price_value,price_currency,seller_username FROM ebay_products_main ORDER BY id DESC LIMIT 3`,
    );
    console.log({ sampleMain });
  } finally {
    await app.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
