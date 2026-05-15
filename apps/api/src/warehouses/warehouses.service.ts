import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';
import { LingxingWarehouse } from './lingxing-warehouse.entity';

export type LingxingWarehouseRow = {
  wid: number;
  type: number;
  name: string;
  isDelete: number;
  tCountryAreaName: string | null;
  tStatus: number | null;
  tWarehouseCode: string | null;
  tWarehouseName: string | null;
  countryCode: string | null;
  wpId: number | null;
  wpName: string | null;
  rawPayload: Record<string, unknown>;
};

@Injectable()
export class WarehousesService {
  constructor(
    @InjectRepository(LingxingWarehouse) private readonly repo: Repository<LingxingWarehouse>,
  ) {}

  async upsertMany(rows: LingxingWarehouseRow[], syncedAt: Date): Promise<number> {
    if (rows.length === 0) return 0;
    const values = rows.map((r) => ({
      wid: r.wid,
      type: r.type,
      name: r.name,
      isDelete: r.isDelete,
      tCountryAreaName: r.tCountryAreaName,
      tStatus: r.tStatus,
      tWarehouseCode: r.tWarehouseCode,
      tWarehouseName: r.tWarehouseName,
      countryCode: r.countryCode,
      wpId: r.wpId,
      wpName: r.wpName,
      rawPayload: r.rawPayload,
      syncedAt,
    })) as unknown as QueryDeepPartialEntity<LingxingWarehouse>[];

    await this.repo
      .createQueryBuilder()
      .insert()
      .into(LingxingWarehouse)
      .values(values)
      .orUpdate(
        [
          'type',
          'name',
          'is_delete',
          't_country_area_name',
          't_status',
          't_warehouse_code',
          't_warehouse_name',
          'country_code',
          'wp_id',
          'wp_name',
          'raw_payload',
          'synced_at',
          'updated_at',
        ],
        ['wid'],
      )
      .execute();

    return values.length;
  }

  async listOverseas(limit = 2000) {
    const rows = await this.repo
      .createQueryBuilder('w')
      .where('w.type = :t', { t: 3 })
      .andWhere('w.isDelete = 0')
      .orderBy('w.name', 'ASC')
      .limit(Math.min(5000, Math.max(1, limit)))
      .getMany();
    return rows;
  }
}

