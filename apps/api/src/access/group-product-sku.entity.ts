import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';

@Entity({ name: 'group_product_skus' })
@Unique('uq_group_prefix', ['groupId', 'skuPrefix'])
@Index(['groupId'])
@Index(['skuPrefix'])
export class GroupProductSku {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'group_id', type: 'varchar', length: 36 })
  groupId!: string;

  @Column({ name: 'sku_prefix', type: 'varchar', length: 191 })
  skuPrefix!: string;

  /** 专属价格，NULL = 使用系统默认价 */
  @Column({ type: 'decimal', precision: 14, scale: 2, nullable: true })
  price?: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
