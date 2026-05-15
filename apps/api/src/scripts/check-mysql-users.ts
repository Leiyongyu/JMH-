import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { User } from '../users/user.entity';

async function main() {
  const dataSource = new DataSource({
    type: 'mysql',
    host: process.env.DATABASE_HOST ?? 'localhost',
    port: Number(process.env.DATABASE_PORT ?? 3306),
    username: process.env.DATABASE_USER ?? 'root',
    password: process.env.DATABASE_PASSWORD ?? '',
    database: process.env.DATABASE_NAME ?? 'distribution',
    charset: 'utf8mb4',
    entities: [User],
    synchronize: false,
  });

  await dataSource.initialize();

  const repo = dataSource.getRepository(User);
  const total = await repo.count();
  // eslint-disable-next-line no-console
  console.log(`users total=${total}`);

  const admins = await repo.find({ where: { role: 'ADMIN' as any }, take: 5, order: { createdAt: 'DESC' as any } });
  for (const u of admins) {
    // eslint-disable-next-line no-console
    console.log(`ADMIN ${u.email} phone=${u.phone ?? '-'} createdAt=${u.createdAt.toISOString()}`);
  }

  await dataSource.destroy();
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});

