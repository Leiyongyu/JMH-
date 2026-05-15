import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { config as dotenv } from 'dotenv';
import { resolve } from 'path';
import { InventoryLine } from '../inventory/inventory-line.entity';
import { EbayProduct } from '../products/ebay-product.entity';

async function main() {
  dotenv({ path: resolve(process.cwd(), 'apps/api/.env') });
  dotenv({ path: resolve(process.cwd(), '.env') });

  const dbType = (process.env.DB_TYPE ?? 'mysql').toLowerCase();
  if (dbType !== 'mysql') {
    throw new Error(`DB_TYPE must be mysql, got ${dbType}`);
  }

  const ds = new DataSource({
    type: 'mysql',
    host: process.env.DATABASE_HOST ?? 'localhost',
    port: Number(process.env.DATABASE_PORT ?? 3306),
    username: process.env.DATABASE_USER ?? 'root',
    password: process.env.DATABASE_PASSWORD ?? '',
    database: process.env.DATABASE_NAME ?? 'distribution',
    charset: 'utf8mb4',
    entities: [InventoryLine, EbayProduct],
    synchronize: false,
  });
  await ds.initialize();

  const inv = ds.getRepository(InventoryLine);
  const pro = ds.getRepository(EbayProduct);
  const now = new Date();

  for (let i = 1; i <= 20; i += 1) {
    const n = String(i).padStart(3, '0');
    const sku = `SKU-EBAY-${n}`;
    const title = `Test Product ${n}`;
    const stock = 50 + i * 3;
    const price = (19.9 + i).toFixed(2);
    const platform = i % 2 === 0 ? 'EBAY' : 'AMAZON';
    const warehouseCode = i % 3 === 0 ? 'WH-UK-1' : 'WH-US-1';
    const warehouseName = i % 3 === 0 ? 'UK Warehouse 1' : 'US Warehouse 1';

    const existInv = await inv.findOne({
      where: { sku, platform, warehouseCode },
    });
    if (existInv) {
      existInv.availableQty = stock;
      existInv.reservedQty = Math.floor(stock * 0.08);
      existInv.inboundQty = Math.floor(stock * 0.15);
      existInv.warehouseName = warehouseName;
      existInv.rawPayload = { seed: true, batch: '20' };
      existInv.syncedAt = now;
      await inv.save(existInv);
    } else {
      await inv.save(
        inv.create({
          sku,
          platform,
          warehouseCode,
          warehouseName,
          availableQty: stock,
          reservedQty: Math.floor(stock * 0.08),
          inboundQty: Math.floor(stock * 0.15),
          rawPayload: { seed: true, batch: '20' },
          syncedAt: now,
        }),
      );
    }

    const existPro = await pro.findOne({ where: { sku } });
    if (existPro) {
      existPro.title = title;
      existPro.stockQty = stock;
      existPro.price = price;
      existPro.currency = 'USD';
      existPro.itemUrl = `https://www.ebay.com/itm/${sku}`;
      existPro.lingxingProductId = `LXP-${1000 + i}`;
      existPro.rawPayload = { seed: true, batch: '20' };
      existPro.syncedAt = now;
      await pro.save(existPro);
    } else {
      await pro.save(
        pro.create({
          sku,
          title,
          stockQty: stock,
          price,
          currency: 'USD',
          itemUrl: `https://www.ebay.com/itm/${sku}`,
          lingxingProductId: `LXP-${1000 + i}`,
          rawPayload: { seed: true, batch: '20' },
          syncedAt: now,
        }),
      );
    }
  }

  const invCount = await inv.count();
  const proCount = await pro.count();
  console.log(`[seed-20] inventory=${invCount}, products=${proCount}`);
  await ds.destroy();
}

main().catch((err) => {
  console.error('[seed-20] failed', err);
  process.exit(1);
});
