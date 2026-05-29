/**
 * 迁移脚本：为 ebay_products 和 distributor_group_prices 添加 SKU 前缀计算列和索引
 *
 * 用途：现有查询大量使用 SUBSTRING_INDEX(TRIM(sku), '-', 2) 做前缀匹配，
 *       无法走 MySQL 索引。添加 GENERATED STORED 列后可利用索引加速。
 *
 * 执行方式：
 *   npx ts-node src/scripts/add-mysql-sku-prefix-indexes.ts
 *   或通过 NestJS 加载为临时服务启动。
 *
 * 注意：需要 MySQL 5.7+（支持 GENERATED ALWAYS AS 语法）
 */

import { createConnection } from 'mysql2/promise';
import { config } from 'dotenv';
import { resolve } from 'path';

// 加载环境变量
config({ path: resolve(__dirname, '../../../.env') });
config({ path: resolve(__dirname, '../../.env') });
config({ path: resolve(__dirname, '../.env') });

async function main() {
  const host = process.env.DATABASE_HOST || 'localhost';
  const port = Number(process.env.DATABASE_PORT || 3306);
  const user = process.env.DATABASE_USER || 'root';
  const password = process.env.DATABASE_PASSWORD || '';
  const database = process.env.DATABASE_NAME || 'distribution';

  console.log(`连接 MySQL: ${user}@${host}:${port}/${database}`);

  const conn = await createConnection({ host, port, user, password, database, charset: 'utf8mb4' });

  const migrations: Array<{ name: string; sql: string }> = [
    {
      name: 'ebay_products 前缀计算列',
      sql: `ALTER TABLE ebay_products
            ADD COLUMN prefix VARCHAR(191)
            GENERATED ALWAYS AS (LOWER(SUBSTRING_INDEX(TRIM(sku), '-', 2))) STORED`,
    },
    {
      name: 'ebay_products 前缀索引',
      sql: `CREATE INDEX idx_ebay_products_prefix ON ebay_products(prefix)`,
    },
    {
      name: 'distributor_group_prices 前缀计算列',
      sql: `ALTER TABLE distributor_group_prices
            ADD COLUMN prefix VARCHAR(191)
            GENERATED ALWAYS AS (LOWER(SUBSTRING_INDEX(TRIM(sku), '-', 2))) STORED`,
    },
    {
      name: 'distributor_group_prices 前缀索引',
      sql: `CREATE INDEX idx_distributor_group_prices_prefix ON distributor_group_prices(prefix)`,
    },
  ];

  for (const { name, sql } of migrations) {
    try {
      console.log(`执行: ${name}...`);
      await conn.execute(sql);
      console.log(`  ✅ 完成`);
    } catch (err: unknown) {
      const code = (err as { code?: string })?.code;
      const msg = String((err as { message?: string })?.message ?? err);
      // ER_DUP_FIELDNAME / ER_DUP_KEYNAME — 已存在则跳过
      if (code === 'ER_DUP_FIELDNAME' || code === 'ER_DUP_KEYNAME' || code === 'ER_DUP_ENTRY') {
        console.log(`  ⏭️  已存在，跳过 (${msg})`);
        continue;
      }
      // 表不存在 — 跳过
      if (code === 'ER_NO_SUCH_TABLE' || msg.includes("doesn't exist")) {
        console.log(`  ⚠️  表不存在，跳过`);
        continue;
      }
      console.error(`  ❌ 失败: ${msg}`);
    }
  }

  await conn.end();
  console.log('迁移完成');
}

main().catch((err) => {
  console.error('迁移脚本执行失败:', err);
  process.exit(1);
});
