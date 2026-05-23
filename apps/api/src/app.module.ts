import { Module, OnModuleInit } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScheduleModule } from '@nestjs/schedule';
import { resolve } from 'path';

import { UsersModule } from './users/users.module';
import { AuthModule } from './auth/auth.module';
import { LingxingModule } from './lingxing/lingxing.module';
import { InventoryModule } from './inventory/inventory.module';
import { ProductsModule } from './products/products.module';
import { OrdersModule } from './orders/orders.module';
import { AdminModule } from './admin/admin.module';
import { UsersService } from './users/users.service';
import { CartModule } from './cart/cart.module';
import { WarehousesModule } from './warehouses/warehouses.module';
import { SyncSchedulerService } from './sync/sync-scheduler.service';
import { FileLoggerService } from './common/file-logger.service';

@Module({
  imports: [
    // 尝试多个路径：根目录 .env、上级目录、本目录
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: [
        resolve(__dirname, '../.env'), // apps/api/.env（无论从根目录还是子目录启动都能读取）
        resolve(__dirname, '../../../.env'),  // 从 src 或 dist 到根目录 .env
        '.env',
      ],
    }),
    ScheduleModule.forRoot(),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (cfg: ConfigService) => {
        const dbType = cfg.get<string>('DB_TYPE', 'mysql').toLowerCase();
        if (dbType !== 'mysql') {
          throw new Error(`DB_TYPE 必须为 mysql（当前=${dbType}）`);
        }
        return {
          type: 'mysql' as const,
          host: cfg.get<string>('DATABASE_HOST', 'localhost'),
          port: Number(cfg.get('DATABASE_PORT', 3306)),
          username: cfg.get<string>('DATABASE_USER', 'root'),
          password: cfg.get<string>('DATABASE_PASSWORD', ''),
          database: cfg.get<string>('DATABASE_NAME', 'distribution'),
          charset: 'utf8mb4',
          autoLoadEntities: true,
          synchronize: false,
          logging: ['error', 'warn'] as const,
        };
      },
    }),
    UsersModule,
    AuthModule,
    LingxingModule,
    InventoryModule,
    WarehousesModule,
    ProductsModule,
    OrdersModule,
    CartModule,
    AdminModule,
  ],
  providers: [SyncSchedulerService, FileLoggerService],
})
export class AppModule implements OnModuleInit {
  constructor(private readonly users: UsersService) {}

  async onModuleInit() {
    await this.users.seedFromEnv();
  }
}
