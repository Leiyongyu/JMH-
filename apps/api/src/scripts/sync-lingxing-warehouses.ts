import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { WarehousesSyncService } from '../warehouses/warehouses-sync.service';

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  try {
    const sync = app.get(WarehousesSyncService);
    const run = await sync.run('script');
    console.log(JSON.stringify(run, null, 2));
  } finally {
    await app.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
