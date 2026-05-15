import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';

@Entity({ name: 'lingxing_warehouses' })
@Unique('uq_lingxing_warehouse_wid', ['wid'])
export class LingxingWarehouse {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'int' })
  wid!: number;

  @Index()
  @Column({ type: 'int' })
  type!: number;

  @Column({ type: 'varchar', length: 191 })
  name!: string;

  @Column({ name: 'is_delete', type: 'int', default: 0 })
  isDelete!: number;

  @Column({ name: 't_country_area_name', type: 'varchar', length: 64, nullable: true })
  tCountryAreaName?: string | null;

  @Column({ name: 't_status', type: 'int', nullable: true })
  tStatus?: number | null;

  @Index()
  @Column({ name: 't_warehouse_code', type: 'varchar', length: 64, nullable: true })
  tWarehouseCode?: string | null;

  @Column({ name: 't_warehouse_name', type: 'varchar', length: 191, nullable: true })
  tWarehouseName?: string | null;

  @Index()
  @Column({ name: 'country_code', type: 'varchar', length: 16, nullable: true })
  countryCode?: string | null;

  @Column({ name: 'wp_id', type: 'int', nullable: true })
  wpId?: number | null;

  @Column({ name: 'wp_name', type: 'varchar', length: 191, nullable: true })
  wpName?: string | null;

  @Column({ name: 'raw_payload', type: 'simple-json', nullable: true })
  rawPayload?: Record<string, unknown> | null;

  @Column({ name: 'synced_at', type: 'datetime' })
  syncedAt!: Date;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}

