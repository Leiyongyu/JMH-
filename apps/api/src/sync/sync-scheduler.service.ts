import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { FileLoggerService } from '../common/file-logger.service';
import { InventorySyncService } from '../inventory/inventory-sync.service';
import { ProductsSyncService } from '../products/products-sync.service';
import { EbayOfficialProductsSyncService } from '../products/ebay-official-products-sync.service';
import { WarehousesSyncService } from '../warehouses/warehouses-sync.service';
import { LingxingOrderStatusSyncService } from '../orders/lingxing-order-status-sync.service';

@Injectable()
export class SyncSchedulerService {
  private readonly console = new Logger(SyncSchedulerService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly fileLog: FileLoggerService,
    private readonly inventorySync: InventorySyncService,
    private readonly productsSync: ProductsSyncService,
    private readonly ebayOfficialSync: EbayOfficialProductsSyncService,
    private readonly warehousesSync: WarehousesSyncService,
    private readonly lingxingOrderStatusSync: LingxingOrderStatusSyncService,
  ) {}

  private isConfigured(): boolean {
    const appId = this.config.get<string>('LINGXING_APP_ID')?.trim();
    return !!appId;
  }

  /** 每日 01:00 — 同步领星海外仓列表 */
  @Cron(process.env.SYNC_CRON_WAREHOUSES ?? '0 1 * * *', { name: 'sync-warehouses' })
  async scheduledSyncWarehouses() {
    if (!this.isConfigured()) {
      this.console.warn('领星未配置，跳过仓库同步');
      return;
    }
    await this.runSync('WAREHOUSES', () => this.warehousesSync.run('SCHEDULER'));
  }

  /** 每日 02:00 — 同步库存明细 */
  @Cron(process.env.SYNC_CRON_INVENTORY ?? '0 2 * * *', { name: 'sync-inventory' })
  async scheduledSyncInventory() {
    if (!this.isConfigured()) {
      this.console.warn('领星未配置，跳过库存同步');
      return;
    }
    await this.runSync('INVENTORY', () => this.inventorySync.run('SCHEDULER'));
  }

  /** 每日 03:00 — 同步 eBay 商品 */
  @Cron(process.env.SYNC_CRON_EBAY_PRODUCTS ?? '0 3 * * *', { name: 'sync-ebay-products' })
  async scheduledSyncEbayProducts() {
    if (!this.isConfigured()) {
      this.console.warn('领星未配置，跳过 eBay 商品同步');
      return;
    }
    await this.runSync('EBAY_PRODUCTS', () => this.productsSync.run('SCHEDULER'));
  }

  /** 每日 04:00 — 从 eBay 官方 API 拉取商品详情 */
  @Cron(process.env.SYNC_CRON_EBAY_OFFICIAL ?? '0 4 * * *', { name: 'sync-ebay-official' })
  async scheduledSyncEbayOfficial() {
    await this.runSync('EBAY_OFFICIAL', () => this.ebayOfficialSync.run('SCHEDULER'));
  }

  /** 每 30 分钟 — 同步领星订单状态 */
  @Cron(process.env.SYNC_CRON_ORDER_STATUS ?? '*/30 * * * *', { name: 'sync-order-status' })
  async scheduledSyncOrderStatus() {
    if (!this.isConfigured()) {
      return; // 静默跳过，避免每30分钟刷屏
    }
    try {
      await this.lingxingOrderStatusSync.run('SCHEDULER');
    } catch (err) {
      this.fileLog.warn(`订单状态同步失败: ${(err as Error).message}`);
    }
  }

  /** 每日 06:00 — 清理 30 天前的旧日志 */
  @Cron('0 6 * * *', { name: 'clean-logs' })
  scheduledCleanLogs() {
    this.fileLog.cleanOldLogs();
  }

  private async runSync(type: string, fn: () => Promise<unknown>) {
    const start = Date.now();
    this.fileLog.syncStart(type);
    try {
      await fn();
      this.fileLog.syncEnd(type, 'SUCCESS', 0, 0, Date.now() - start);
    } catch (err) {
      this.fileLog.syncEnd(type, 'FAILED', 0, 1, Date.now() - start);
      this.fileLog.error(`${type} 同步异常: ${(err as Error).message}`);
    }
  }
}
