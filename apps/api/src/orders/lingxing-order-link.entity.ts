import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, Unique, UpdateDateColumn } from 'typeorm';

export type LingxingPushStatus = 'PENDING' | 'SUCCESS' | 'FAILED';

@Entity({ name: 'lingxing_order_links' })
@Unique('uq_lx_order_no', ['orderNo'])
@Unique('uq_lx_store_platform_order', ['storeId', 'platformOrderNo'])
export class LingxingOrderLink {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ name: 'order_no', length: 32 })
  orderNo!: string;

  @Index()
  @Column({ name: 'store_id', length: 64 })
  storeId!: string;

  @Index()
  @Column({ name: 'platform_code', type: 'int' })
  platformCode!: number;

  @Index()
  @Column({ name: 'platform_order_no', length: 64 })
  platformOrderNo!: string;

  @Index()
  @Column({ name: 'global_order_no', type: 'varchar', length: 64, nullable: true })
  globalOrderNo?: string | null;

  @Column({ name: 'push_status', length: 16, default: 'PENDING' })
  pushStatus!: LingxingPushStatus;

  @Column({ name: 'push_attempts', type: 'int', default: 0 })
  pushAttempts!: number;

  @Column({ name: 'last_error', type: 'varchar', length: 1000, nullable: true })
  lastError?: string | null;

  @Column({ name: 'last_pushed_at', type: 'datetime', nullable: true })
  lastPushedAt?: Date | null;

  @Column({ name: 'last_checked_at', type: 'datetime', nullable: true })
  lastCheckedAt?: Date | null;

  @Column({ name: 'last_lingxing_status', type: 'int', nullable: true })
  lastLingxingStatus?: number | null;

  @Column({ name: 'raw_payload', type: 'simple-json', nullable: true })
  rawPayload?: Record<string, unknown> | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
