import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { CartItem } from '../cart/cart-item.entity';

async function main() {
  const dataSource = new DataSource({
    type: 'mysql',
    host: process.env.DATABASE_HOST ?? 'localhost',
    port: Number(process.env.DATABASE_PORT ?? 3306),
    username: process.env.DATABASE_USER ?? 'root',
    password: process.env.DATABASE_PASSWORD ?? '',
    database: process.env.DATABASE_NAME ?? 'distribution',
    charset: 'utf8mb4',
    entities: [CartItem],
    synchronize: false,
  });

  await dataSource.initialize();
  const repo = dataSource.getRepository(CartItem);
  const total = await repo.count();
  // eslint-disable-next-line no-console
  console.log(`cart_items total=${total}`);
  const last = await repo.find({ order: { updatedAt: 'DESC' as any }, take: 5 });
  for (const it of last) {
    // eslint-disable-next-line no-console
    console.log(`${it.userId} | ${it.sku} | qty=${it.qty} | ${it.currencySnapshot} ${it.unitPriceSnapshot}`);
  }
  await dataSource.destroy();
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});

