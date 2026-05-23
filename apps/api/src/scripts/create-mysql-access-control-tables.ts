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
    CREATE TABLE IF NOT EXISTS distributor_groups (
      id varchar(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
      code varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
      name varchar(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
      description varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
      created_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id) USING BTREE,
      UNIQUE KEY uq_distributor_groups_code (code) USING BTREE
    ) ENGINE=InnoDB CHARACTER SET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=Dynamic;
  `);

  await dataSource.query(`
    CREATE TABLE IF NOT EXISTS distributor_group_members (
      id varchar(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
      group_id varchar(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
      user_id varchar(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
      created_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id) USING BTREE,
      UNIQUE KEY uq_distributor_group_member (group_id, user_id) USING BTREE,
      KEY idx_distributor_group_members_user_id (user_id) USING BTREE,
      KEY idx_distributor_group_members_group_id (group_id) USING BTREE
    ) ENGINE=InnoDB CHARACTER SET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=Dynamic;
  `);

  await dataSource.query(`
    CREATE TABLE IF NOT EXISTS ebay_product_visibility_groups (
      id varchar(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
      group_id varchar(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
      product_id varchar(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
      created_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id) USING BTREE,
      UNIQUE KEY uq_ebay_product_visibility_group (group_id, product_id) USING BTREE,
      KEY idx_ebay_product_visibility_groups_product_id (product_id) USING BTREE,
      KEY idx_ebay_product_visibility_groups_group_id (group_id) USING BTREE
    ) ENGINE=InnoDB CHARACTER SET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=Dynamic;
  `);

  try {
    await dataSource.query(
      `ALTER TABLE distributor_groups MODIFY updated_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP;`,
    );
  } catch {}

  await dataSource.destroy();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
