import 'reflect-metadata';
import { DataSource } from 'typeorm';
import * as bcrypt from 'bcryptjs';
import { config as dotenv } from 'dotenv';
import { resolve } from 'path';
import { User } from '../users/user.entity';
import { InventoryLine } from '../inventory/inventory-line.entity';
import { EbayProduct } from '../products/ebay-product.entity';

async function main() {
  dotenv({ path: resolve(process.cwd(), 'apps/api/.env') });
  dotenv({ path: resolve(process.cwd(), '.env') });

  const dbType = (process.env.DB_TYPE ?? 'mysql').toLowerCase();
  if (dbType !== 'mysql') {
    throw new Error(`DB_TYPE must be mysql, got ${dbType}`);
  }

  const dataSource = new DataSource({
    type: 'mysql',
    host: process.env.DATABASE_HOST ?? 'localhost',
    port: Number(process.env.DATABASE_PORT ?? 3306),
    username: process.env.DATABASE_USER ?? 'root',
    password: process.env.DATABASE_PASSWORD ?? '',
    database: process.env.DATABASE_NAME ?? 'distribution',
    charset: 'utf8mb4',
    entities: [User, InventoryLine, EbayProduct],
    synchronize: false,
  });

  await dataSource.initialize();
  const now = new Date();

  const userRepo = dataSource.getRepository(User);
  const invRepo = dataSource.getRepository(InventoryLine);
  const productRepo = dataSource.getRepository(EbayProduct);

  const ensureUser = async (email: string, password: string, role: 'ADMIN' | 'DISTRIBUTOR', displayName: string) => {
    const exist = await userRepo.findOne({ where: { email } });
    if (exist) return exist;
    const passwordHash = await bcrypt.hash(password, 10);
    return userRepo.save(
      userRepo.create({
        email,
        passwordHash,
        role,
        displayName,
      }),
    );
  };

  await ensureUser('admin@example.com', 'admin123', 'ADMIN', 'Admin');
  await ensureUser('dist@example.com', 'dist123', 'DISTRIBUTOR', 'Distributor');

  const inventorySeeds: Array<Partial<InventoryLine>> = [
    {
      sku: 'SKU-EBAY-001',
      platform: 'EBAY',
      warehouseCode: 'WH-US-1',
      warehouseName: 'US Warehouse 1',
      availableQty: 120,
      reservedQty: 8,
      inboundQty: 20,
      rawPayload: { seed: true, source: 'manual' },
      syncedAt: now,
    },
    {
      sku: 'SKU-EBAY-002',
      platform: 'EBAY',
      warehouseCode: 'WH-US-1',
      warehouseName: 'US Warehouse 1',
      availableQty: 75,
      reservedQty: 5,
      inboundQty: 10,
      rawPayload: { seed: true, source: 'manual' },
      syncedAt: now,
    },
    {
      sku: 'SKU-EBAY-003',
      platform: 'AMAZON',
      warehouseCode: 'WH-UK-1',
      warehouseName: 'UK Warehouse 1',
      availableQty: 35,
      reservedQty: 2,
      inboundQty: 5,
      rawPayload: { seed: true, source: 'manual' },
      syncedAt: now,
    },
  ];

  for (const item of inventorySeeds) {
    const found = await invRepo.findOne({
      where: {
        sku: item.sku!,
        platform: item.platform!,
        warehouseCode: item.warehouseCode!,
      },
    });
    if (found) {
      found.warehouseName = item.warehouseName ?? null;
      found.availableQty = Number(item.availableQty ?? 0);
      found.reservedQty = Number(item.reservedQty ?? 0);
      found.inboundQty = Number(item.inboundQty ?? 0);
      found.rawPayload = item.rawPayload as Record<string, unknown>;
      found.syncedAt = now;
      await invRepo.save(found);
    } else {
      await invRepo.save(invRepo.create(item));
    }
  }

  const productSeeds: Array<Partial<EbayProduct>> = [
    {
      sku: 'SKU-EBAY-001',
      title: 'Wireless Barcode Scanner',
      stockQty: 120,
      price: '49.90',
      currency: 'USD',
      itemUrl: 'https://www.ebay.com/itm/SKU-EBAY-001',
      lingxingProductId: 'LXP-1001',
      rawPayload: { seed: true, source: 'manual' },
      syncedAt: now,
    },
    {
      sku: 'SKU-EBAY-002',
      title: 'Mini Label Printer',
      stockQty: 75,
      price: '89.00',
      currency: 'USD',
      itemUrl: 'https://www.ebay.com/itm/SKU-EBAY-002',
      lingxingProductId: 'LXP-1002',
      rawPayload: { seed: true, source: 'manual' },
      syncedAt: now,
    },
    {
      sku: 'SKU-EBAY-003',
      title: 'Bluetooth Thermal Label',
      stockQty: 35,
      price: '15.50',
      currency: 'USD',
      itemUrl: 'https://www.ebay.com/itm/SKU-EBAY-003',
      lingxingProductId: 'LXP-1003',
      rawPayload: { seed: true, source: 'manual' },
      syncedAt: now,
    },
  ];

  for (const item of productSeeds) {
    const found = await productRepo.findOne({ where: { sku: item.sku! } });
    if (found) {
      found.title = item.title ?? null;
      found.stockQty = Number(item.stockQty ?? 0);
      found.price = String(item.price ?? '0');
      found.currency = String(item.currency ?? 'USD');
      found.itemUrl = item.itemUrl ?? null;
      found.lingxingProductId = item.lingxingProductId ?? null;
      found.rawPayload = item.rawPayload as Record<string, unknown>;
      found.syncedAt = now;
      await productRepo.save(found);
    } else {
      await productRepo.save(productRepo.create(item));
    }
  }

  console.log('[seed] users ok, inventory seeded:', inventorySeeds.length, 'products seeded:', productSeeds.length);
  await dataSource.destroy();
}

main().catch((err) => {
  console.error('[seed] failed:', err);
  process.exit(1);
});
