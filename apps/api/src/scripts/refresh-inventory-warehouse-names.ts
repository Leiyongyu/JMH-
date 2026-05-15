import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { DataSource } from 'typeorm';
import { AppModule } from '../app.module';
import { InventoryService } from '../inventory/inventory.service';

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  try {
    const inv = app.get(InventoryService);
    const ds = app.get(DataSource);
    const before = await ds.query(
      `SELECT COUNT(1) as c FROM inventory_lines WHERE platform='LINGXING' AND warehouse_name IS NOT NULL AND warehouse_name<>''`,
    );
    const affected = await inv.refreshWarehouseNamesFromLingxingOverseas();
    const after = await ds.query(
      `SELECT COUNT(1) as c FROM inventory_lines WHERE platform='LINGXING' AND warehouse_name IS NOT NULL AND warehouse_name<>''`,
    );
    console.log({ before: before?.[0]?.c, affected, after: after?.[0]?.c });
  } finally {
    await app.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

