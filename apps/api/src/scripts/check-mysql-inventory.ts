import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { InventoryLine } from '../inventory/inventory-line.entity';

async function main() {
  const dataSource = new DataSource({
    type: 'mysql',
    host: process.env.DATABASE_HOST ?? 'localhost',
    port: Number(process.env.DATABASE_PORT ?? 3306),
    username: process.env.DATABASE_USER ?? 'root',
    password: process.env.DATABASE_PASSWORD ?? '',
    database: process.env.DATABASE_NAME ?? 'distribution',
    charset: 'utf8mb4',
    entities: [InventoryLine],
    synchronize: false,
  });

  await dataSource.initialize();

  const repo = dataSource.getRepository(InventoryLine);
  const total = await repo.count();
  // eslint-disable-next-line no-console
  console.log(`inventory_lines total=${total}`);

  const last = await repo
    .createQueryBuilder('i')
    .orderBy('i.syncedAt', 'DESC')
    .addOrderBy('i.updatedAt', 'DESC')
    .limit(5)
    .getMany();

  for (const it of last) {
    // eslint-disable-next-line no-console
    console.log(
      `${it.syncedAt.toISOString()} | ${it.sku} | ${it.platform} | ${it.warehouseCode} | avail=${it.availableQty}`,
    );
  }

  await dataSource.destroy();
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});

