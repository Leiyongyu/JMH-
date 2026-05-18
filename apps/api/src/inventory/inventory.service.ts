import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';
import { InventoryLine } from './inventory-line.entity';
import { SyncService } from '../sync/sync.service';

export interface InventoryListQuery {
  sku?: string;
  platform?: string;
  warehouse?: string;
  lowStockOnly?: boolean;
  lowStockThreshold?: number;
  sortBy?: string;
  sortOrder?: 'ASC' | 'DESC';
  page?: number;
  pageSize?: number;
}

@Injectable()
export class InventoryService {
  constructor(
    @InjectRepository(InventoryLine) private readonly repo: Repository<InventoryLine>,
    private readonly sync: SyncService,
  ) {}

  async list(q: InventoryListQuery) {
    const page = Math.max(1, Number(q.page ?? 1));
    const pageSize = Math.min(100, Math.max(1, Number(q.pageSize ?? 20)));
    const lowStockThreshold = Math.max(0, Number(q.lowStockThreshold ?? 10));
    const order = String(q.sortOrder ?? 'ASC').toUpperCase() === 'DESC' ? 'DESC' : 'ASC';
    const qb = this.repo
      .createQueryBuilder('i')
      .orderBy('i.sku', 'ASC')
      .addOrderBy('i.platform', 'ASC');
    if (q.sku) {
      const sku = q.sku.trim();
      qb.andWhere('LOWER(i.sku) LIKE LOWER(:skuLike)', { skuLike: `%${sku}%` });
    }
    if (q.platform) qb.andWhere('i.platform = :p', { p: q.platform });
    if (q.warehouse) {
      const w = q.warehouse.trim();
      qb.andWhere(
        '(LOWER(i.warehouseCode) LIKE LOWER(:whLike) OR LOWER(COALESCE(i.warehouseName, \'\')) LIKE LOWER(:whLike))',
        { whLike: `%${w}%` },
      );
    }
    if (q.lowStockOnly) {
      qb.andWhere(
        `i.sku IN (
          SELECT sku
          FROM inventory_lines
          GROUP BY sku
          HAVING SUM(available_qty) < :t
        )`,
        { t: lowStockThreshold },
      );
    }
    const sortableMap: Record<string, string> = {
      sku: 'i.sku',
      availableQty: 'i.availableQty',
      reservedQty: 'i.reservedQty',
      inboundQty: 'i.inboundQty',
      syncedAt: 'i.syncedAt',
    };
    const sortable = sortableMap[String(q.sortBy ?? '')];
    if (sortable) {
      qb.orderBy(sortable, order);
      qb.addOrderBy('i.sku', 'ASC');
      qb.addOrderBy('i.platform', 'ASC');
    }
    const [items, total] = await qb
      .skip((page - 1) * pageSize)
      .take(pageSize)
      .getManyAndCount();
    return { items, total, page, pageSize };
  }

  async summary(lowStockThreshold: number) {
    const repo = this.repo;
    const totalSkuRow = await repo
      .createQueryBuilder('i')
      .select('COUNT(DISTINCT i.sku)', 'c')
      .getRawOne<{ c: string }>();
    const totalSku = Number(totalSkuRow?.c ?? 0);

    const lowStockRow = await repo
      .createQueryBuilder('i')
      .select('COUNT(DISTINCT i.sku)', 'c')
      .where(
        'i.sku IN (SELECT sku FROM inventory_lines GROUP BY sku HAVING SUM(available_qty) < :t)',
        { t: lowStockThreshold },
      )
      .getRawOne<{ c: string }>();
    const lowStockSku = Number(lowStockRow?.c ?? 0);

    const platforms = await repo
      .createQueryBuilder('i')
      .select('i.platform', 'platform')
      .addSelect('SUM(i.availableQty)', 'available')
      .groupBy('i.platform')
      .orderBy('available', 'DESC')
      .limit(10)
      .getRawMany<{ platform: string; available: string }>();

    const lastSyncedAt = await this.sync.lastSuccessAt('INVENTORY');

    return {
      lastSyncedAt,
      totalSku,
      lowStockSku,
      platformCount: platforms.length,
      platforms: platforms.map((p) => ({ platform: p.platform, available: Number(p.available) })),
      threshold: lowStockThreshold,
    };
  }

  async upsertMany(
    items: Array<{
      sku: string;
      platform: string;
      warehouseCode: string;
      warehouseName: string | null;
      availableQty: number;
      reservedQty: number;
      inboundQty: number;
      rawPayload: Record<string, unknown>;
    }>,
    syncedAt: Date,
  ): Promise<number> {
    if (items.length === 0) return 0;
    const rows = items.map((it) => ({ ...it, syncedAt })) as unknown as QueryDeepPartialEntity<InventoryLine>[];
    await this.repo
      .createQueryBuilder()
      .insert()
      .into(InventoryLine)
      .values(rows)
      .orUpdate(
        ['warehouse_name', 'available_qty', 'reserved_qty', 'inbound_qty', 'raw_payload', 'synced_at', 'updated_at'],
        ['sku', 'platform', 'warehouse_code'],
      )
      .execute();
    return rows.length;
  }

  async refreshWarehouseNamesFromLingxingOverseas(): Promise<number> {
    const res = (await this.repo.query(`
      UPDATE inventory_lines i
      LEFT JOIN lingxing_warehouses w
        ON i.warehouse_code REGEXP '^[0-9]+$'
       AND w.wid = CAST(i.warehouse_code AS UNSIGNED)
       AND w.type = 3
       AND w.is_delete = 0
      SET i.warehouse_name = w.name,
          i.updated_at = CURRENT_TIMESTAMP
      WHERE i.platform = 'LINGXING'
    `)) as unknown;
    const affected = (res as { affectedRows?: number })?.affectedRows;
    return typeof affected === 'number' ? affected : 0;
  }
}
