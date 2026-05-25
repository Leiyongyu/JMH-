import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';

@Entity({ name: 'distributor_group_prices' })
@Unique('uq_distributor_group_price_group_sku', ['groupId', 'sku'])
export class DistributorGroupPrice {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ name: 'group_id', type: 'varchar', length: 36 })
  groupId!: string;

  @Column({ type: 'varchar', length: 191 })
  sku!: string;

  @Column({ type: 'decimal', precision: 14, scale: 2, default: 0 })
  price!: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
