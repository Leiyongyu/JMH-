import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { EbayTradingService } from '../ebay/ebay-trading.service';

async function main() {
  const url = String(process.argv[2] ?? '').trim();
  if (!url) throw new Error('missing url arg');

  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  try {
    const svc = app.get(EbayTradingService);
    const res = await svc.getItemByUrl(url);
    const summary = {
      itemId: res?.itemId ?? null,
      siteId: res?.siteId ?? null,
      marketplaceId: res?.marketplaceId ?? null,
      basic: res?.basic ?? null,
      specificsCount: Array.isArray(res?.specifics) ? res.specifics.length : 0,
      specificsSample: Array.isArray(res?.specifics) ? res.specifics.slice(0, 10) : [],
      vehiclesCount: Array.isArray(res?.vehicles?.items) ? res.vehicles.items.length : 0,
      vehiclesTotalCount: res?.vehicles?.totalCount ?? null,
      vehiclesRawSample: res?.vehicles?.rawSample ?? null,
    };
    console.log(JSON.stringify(summary, null, 2));
  } finally {
    await app.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
