import 'reflect-metadata';
import { config as dotenv } from 'dotenv';
import { resolve } from 'path';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';
import { LoggingInterceptor } from './common/logging.interceptor';

// 手动加载根目录 .env 到 process.env（兜底 ConfigModule 路径解析）
const cwd = process.cwd();
const dotenvPaths = [
  resolve(cwd, '.env'),
  resolve(cwd, '../../.env'),
  resolve(__dirname, '../../../.env'),
  resolve(__dirname, '../../.env'),
];
for (const p of dotenvPaths) {
  const loaded = dotenv({ path: p });
  if (loaded.parsed) {
    Logger.log(`[DOTENV] loaded: ${p}`, 'Bootstrap');
    break;
  }
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: false });
  const config = app.get(ConfigService);

  const instance = app.getHttpAdapter().getInstance() as any;
  if (instance && typeof instance.disable === 'function') {
    instance.disable('etag');
  }

  // 全局请求日志
  app.useGlobalInterceptors(new LoggingInterceptor());

  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: false,
    }),
  );

  const corsRaw =
    config.get<string>('API_CORS_ORIGIN', 'http://localhost:5173,http://127.0.0.1:5173') ?? '';
  const corsOrigins = corsRaw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  /** 开发时常用：用 192.168.x 等打开 Vite 时浏览器 Origin 不在白名单会失败；true 时反射请求 Origin（勿在生产开启） */
  const corsRelax = String(config.get<string>('API_CORS_RELAX', 'false')).toLowerCase() === 'true';
  const corsStar = corsOrigins.includes('*') || corsRaw.trim() === '*';
  app.enableCors({
    origin: corsRelax || corsStar ? true : corsOrigins,
    credentials: true,
  });

  const swaggerConfig = new DocumentBuilder()
    .setTitle('Distribution System API')
    .setDescription('跨境电商分销系统 - REST API')
    .setVersion('0.1.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('docs', app, document);

  const port = Number(config.get('API_PORT', 3001));
  const host = config.get<string>('API_HOST', '0.0.0.0').trim() || '0.0.0.0';

  // 启动配置概览
  const envLog = [
    `DB_TYPE=${config.get('DB_TYPE')}`,
    `LINGXING_APP_ID=${config.get('LINGXING_APP_ID') ? '****' + config.get('LINGXING_APP_ID')?.slice(-4) : '(not set)'}`,
    `LINGXING_EBAY_SIDS=${config.get('LINGXING_EBAY_SIDS') || '(not set)'}`,
    `SEED_ADMIN_EMAIL=${config.get('SEED_ADMIN_EMAIL') || '(not set)'}`,
    `API_HOST=${host}`,
    `API_CORS_RELAX=${String(config.get<string>('API_CORS_RELAX', 'false'))}`,
  ];
  new Logger('Config').log(`启动配置: ${envLog.join(' | ')}`);

  await app.listen(port, host);
  new Logger('Bootstrap').log(
    `API listening on http://localhost:${port} and http://127.0.0.1:${port} (docs: /docs)`,
  );
}

bootstrap();
