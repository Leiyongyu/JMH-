import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { DataSource } from 'typeorm';

function parseLegacyItemId(url: string): string | null {
  const s = String(url || '').trim();
  if (!s) return null;
  const m = s.match(/\/itm\/(\d{6,})/i);
  if (m?.[1]) return m[1];
  const m2 = s.match(/[?&]item=(\d{6,})/i);
  if (m2?.[1]) return m2[1];
  return null;
}

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  try {
    const ds = app.get(DataSource);
    const rows = (await ds.query(
      `
      SELECT sku, item_url AS url
      FROM ebay_products
      WHERE item_url IS NOT NULL AND TRIM(item_url) <> ''
      ORDER BY updated_at DESC
      LIMIT 5
      `,
    )) as Array<{ sku: string; url: string }>;
    console.log(
      rows.map((r) => ({
        sku: r.sku,
        url: r.url,
        legacyItemId: parseLegacyItemId(r.url),
      })),
    );
  } finally {
    await app.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

