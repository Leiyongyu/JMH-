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

  await dataSource.query(`
    CREATE TABLE IF NOT EXISTS lingxing_warehouses (
      id varchar(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
      wid int NOT NULL,
      type int NOT NULL,
      name varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
      is_delete int NOT NULL DEFAULT 0,
      t_country_area_name varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL,
      t_status int NULL,
      t_warehouse_code varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL,
      t_warehouse_name varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL,
      country_code varchar(16) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL,
      wp_id int NULL,
      wp_name varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL,
      raw_payload longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL,
      synced_at datetime NOT NULL,
      created_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id) USING BTREE,
      UNIQUE KEY uq_lingxing_warehouse_wid (wid) USING BTREE,
      KEY idx_lingxing_warehouse_type (type) USING BTREE,
      KEY idx_lingxing_warehouse_country_code (country_code) USING BTREE,
      KEY idx_lingxing_warehouse_t_warehouse_code (t_warehouse_code) USING BTREE
    ) ENGINE=InnoDB CHARACTER SET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=Dynamic;
  `);

  try {
    await dataSource.query(
      `ALTER TABLE lingxing_warehouses MODIFY updated_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP;`,
    );
  } catch {}

  await dataSource.destroy();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
