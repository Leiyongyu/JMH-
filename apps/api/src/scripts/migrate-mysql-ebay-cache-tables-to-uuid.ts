import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { config as dotenv } from 'dotenv';
import { resolve } from 'path';

dotenv({ path: resolve(process.cwd(), 'apps/api/.env') });
dotenv({ path: resolve(process.cwd(), '.env') });

async function colType(ds: DataSource, table: string, column: string): Promise<{ dataType: string; extra: string } | null> {
  const rows = (await ds.query(
    `
      SELECT DATA_TYPE AS dataType, EXTRA AS extra
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = ?
        AND COLUMN_NAME = ?
      LIMIT 1
    `,
    [table, column],
  )) as Array<{ dataType?: string; extra?: string }>;
  const r = rows?.[0];
  if (!r?.dataType) return null;
  return { dataType: String(r.dataType).toLowerCase(), extra: String(r.extra ?? '').toLowerCase() };
}

async function migrateTable(ds: DataSource, table: string) {
  const idCol = await colType(ds, table, 'id');
  if (!idCol) return;
  if (idCol.dataType === 'varchar' || idCol.dataType === 'char') return;

  await ds.query(`ALTER TABLE \`${table}\` ADD COLUMN id_uuid varchar(36) NULL;`);
  await ds.query(`UPDATE \`${table}\` SET id_uuid = UUID() WHERE id_uuid IS NULL;`);
  await ds.query(`ALTER TABLE \`${table}\` DROP PRIMARY KEY;`);
  await ds.query(`ALTER TABLE \`${table}\` DROP COLUMN id;`);
  await ds.query(`ALTER TABLE \`${table}\` CHANGE COLUMN id_uuid id varchar(36) NOT NULL;`);
  await ds.query(`ALTER TABLE \`${table}\` ADD PRIMARY KEY (id) USING BTREE;`);
}

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

  try {
    await migrateTable(dataSource, 'ebay_cached_item_details');
  } catch {
    // ignore
  }

  try {
    await migrateTable(dataSource, 'ebay_cached_item_fitments');
  } catch {
    // ignore
  }

  await dataSource.destroy();
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});

