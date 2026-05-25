import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { config as dotenv } from 'dotenv';
import { resolve } from 'path';

dotenv({ path: resolve(process.cwd(), 'apps/api/.env') });
dotenv({ path: resolve(process.cwd(), '.env') });

async function main() {
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

  await ds.query(`
    CREATE TABLE IF NOT EXISTS distributor_group_prices (
      id varchar(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
      group_id varchar(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
      sku varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
      price decimal(14,2) NOT NULL DEFAULT 0.00,
      created_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id) USING BTREE,
      UNIQUE KEY uq_distributor_group_price_group_sku (group_id, sku) USING BTREE,
      KEY idx_distributor_group_prices_group_id (group_id) USING BTREE,
      KEY idx_distributor_group_prices_sku (sku) USING BTREE
    ) ENGINE=InnoDB CHARACTER SET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=Dynamic;
  `);

  console.log('distributor_group_prices 表创建成功');
  await ds.destroy();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
