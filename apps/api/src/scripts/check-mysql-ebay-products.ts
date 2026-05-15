import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { EbayProduct } from '../products/ebay-product.entity';

async function main() {
  const dataSource = new DataSource({
    type: 'mysql',
    host: process.env.DATABASE_HOST ?? 'localhost',
    port: Number(process.env.DATABASE_PORT ?? 3306),
    username: process.env.DATABASE_USER ?? 'root',
    password: process.env.DATABASE_PASSWORD ?? '',
    database: process.env.DATABASE_NAME ?? 'distribution',
    charset: 'utf8mb4',
    entities: [EbayProduct],
    synchronize: false,
  });

  await dataSource.initialize();
  const repo = dataSource.getRepository(EbayProduct);
  const total = await repo.count();
  // eslint-disable-next-line no-console
  console.log(`ebay_products total=${total}`);

  const last = await repo
    .createQueryBuilder('p')
    .orderBy('p.syncedAt', 'DESC')
    .addOrderBy('p.updatedAt', 'DESC')
    .limit(5)
    .getMany();

  for (const it of last) {
    // eslint-disable-next-line no-console
    console.log(`${it.syncedAt.toISOString()} | ${it.sku} | ${it.currency} ${it.price} | stock=${it.stockQty} | ${it.status}`);
  }

  await dataSource.destroy();
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});

