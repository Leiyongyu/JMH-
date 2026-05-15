import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';

@Entity({ name: 'inventory_lines' })
@Unique('uq_inventory_sku_platform_warehouse', ['sku', 'platform', 'warehouseCode'])
export class InventoryLine {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ length: 191 })
  sku!: string;

  @Index()
  @Column({ length: 64 })
  platform!: string;

  @Column({ name: 'warehouse_code', length: 64 })
  warehouseCode!: string;

  @Column({ name: 'warehouse_name', type: 'varchar', length: 191, nullable: true })
  warehouseName?: string | null;

  @Column({ name: 'available_qty', type: 'int', default: 0 })
  availableQty!: number;

  @Column({ name: 'reserved_qty', type: 'int', default: 0 })
  reservedQty!: number;

  @Column({ name: 'inbound_qty', type: 'int', default: 0 })
  inboundQty!: number;

  @Column({ name: 'raw_payload', type: 'simple-json', nullable: true })
  rawPayload?: Record<string, unknown> | null;

  @Column({ name: 'synced_at', type: 'datetime' })
  syncedAt!: Date;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
