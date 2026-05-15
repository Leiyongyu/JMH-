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

  const [run] = await ds.query(
    `SELECT id,type,status,started_at,finished_at,processed_count,total_count,success_count,error_count,error_message,detail_summary
     FROM sync_runs
     WHERE type='EBAY_PRODUCT'
     ORDER BY created_at DESC
     LIMIT 1`,
  );

  const [total] = await ds.query(`SELECT COUNT(*) AS n FROM ebay_products`);
  const [active] = await ds.query(
    `SELECT COUNT(*) AS n
     FROM ebay_products
     WHERE (LOWER(TRIM(COALESCE(status, ''))) IN ('active','1') OR TRIM(COALESCE(status,'')) = '在售')`,
  );
  const [nullTitle] = await ds.query(`SELECT COUNT(*) AS n FROM ebay_products WHERE title IS NULL`);

  // eslint-disable-next-line no-console
  console.log(
    JSON.stringify(
      {
        latestRun: run ?? null,
        ebayProducts: { total: Number(total?.n ?? 0), active: Number(active?.n ?? 0), titleNull: Number(nullTitle?.n ?? 0) },
      },
      null,
      2,
    ),
  );

  await ds.destroy();
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});

