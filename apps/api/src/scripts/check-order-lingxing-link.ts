import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { config as dotenv } from 'dotenv';
import { resolve } from 'path';

dotenv({ path: resolve(process.cwd(), 'apps/api/.env') });
dotenv({ path: resolve(process.cwd(), '.env') });

async function main() {
  const orderNo = process.argv[2];
  if (!orderNo) {
    // eslint-disable-next-line no-console
    console.error('Usage: pnpm -C apps/api exec ts-node src/scripts/check-order-lingxing-link.ts <orderNo>');
    process.exit(1);
  }

  const ds = new DataSource({
    type: 'mysql',
    host: process.env.DATABASE_HOST ?? 'localhost',
    port: Number(process.env.DATABASE_PORT ?? 3306),
    username: process.env.DATABASE_USER ?? 'root',
    password: process.env.DATABASE_PASSWORD ?? '',
    database: process.env.DATABASE_NAME ?? 'distribution',
    charset: 'utf8mb4',
    synchronize: false,
  });

  await ds.initialize();
  const rows = await ds.query(
    `SELECT order_no,push_status,platform_code,store_id,platform_order_no,global_order_no,push_attempts,last_error,last_pushed_at,last_checked_at,last_lingxing_status,updated_at
     FROM lingxing_order_links
     WHERE order_no = ?
     ORDER BY updated_at DESC
     LIMIT 1`,
    [orderNo],
  );

  // eslint-disable-next-line no-console
  console.log(JSON.stringify(rows[0] ?? null, null, 2));
  await ds.destroy();
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});

