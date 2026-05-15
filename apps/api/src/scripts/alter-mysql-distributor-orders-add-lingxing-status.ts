import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { config as dotenv } from 'dotenv';
import { resolve } from 'path';

dotenv({ path: resolve(process.cwd(), 'apps/api/.env') });
dotenv({ path: resolve(process.cwd(), '.env') });

async function main() {
  const dataSource = new DataSource({
    type: 'mysql',
    host: process.env.DATABASE_HOST ?? 'localhost',
    port: Number(process.env.DATABASE_PORT ?? 3306),
    username: process.env.DATABASE_USER ?? 'root',
    password: process.env.DATABASE_PASSWORD ?? '',
    database: process.env.DATABASE_NAME ?? 'distribution',
    charset: 'utf8mb4',
    synchronize: false,
  });

  await dataSource.initialize();

  const alterSql = `
    ALTER TABLE distributor_orders
      ADD COLUMN lingxing_status int NULL,
      ADD COLUMN lingxing_status_text varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL,
      ADD COLUMN lingxing_checked_at datetime NULL,
      ADD COLUMN lingxing_global_order_no varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL;
  `;

  try {
    await dataSource.query(alterSql);
  } catch (err: any) {
    const msg = String(err?.message ?? '');
    if (!msg.toLowerCase().includes('duplicate column') && !msg.toLowerCase().includes('exists')) throw err;
  }

  await dataSource.destroy();
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});

