import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { ProductsService } from '../products/products.service';

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  try {
    const svc = app.get(ProductsService);
    const res = await svc.list({ page: 1, pageSize: 5, sortBy: 'stockQty', sortOrder: 'DESC' });
    console.log({ total: res.total, page: res.page, pageSize: res.pageSize, sample: res.items?.[0] ?? null });
  } finally {
    await app.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

