import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

export type SyncType =
  | 'INVENTORY'
  | 'EBAY_PRODUCT'
  | 'EBAY_OFFICIAL_PRODUCT'
  | 'LINGXING_WAREHOUSE'
  | 'LINGXING_ORDER_STATUS';
export type SyncStatus = 'RUNNING' | 'SUCCESS' | 'FAILED';

@Entity({ name: 'sync_runs' })
export class SyncRun {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'varchar', length: 32 })
  type!: SyncType;

  @Index()
  @Column({ type: 'varchar', length: 16 })
  status!: SyncStatus;

  @Column({ name: 'started_at', type: 'datetime' })
  startedAt!: Date;

  @Column({ name: 'finished_at', type: 'datetime', nullable: true })
  finishedAt?: Date | null;

  @Column({ name: 'success_count', type: 'int', default: 0 })
  successCount!: number;

  @Column({ name: 'error_count', type: 'int', default: 0 })
  errorCount!: number;

  /** 已处理的记录数（用于进度计算） */
  @Column({ name: 'processed_count', type: 'int', default: 0 })
  processedCount!: number;

  /** 预估总记录数（0 = 未知，如分页未完成） */
  @Column({ name: 'total_count', type: 'int', default: 0 })
  totalCount!: number;

  /** 最近处理的数据摘要（如 "SKU001, SKU002..."） */
  @Column({ name: 'detail_summary', type: 'text', nullable: true })
  detailSummary?: string | null;

  @Column({ name: 'error_message', type: 'text', nullable: true })
  errorMessage?: string | null;

  @Column({ name: 'triggered_by', type: 'varchar', length: 191, nullable: true })
  triggeredBy?: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}
