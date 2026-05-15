import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity({ name: 'ebay_products' })
export class EbayProduct {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index({ unique: true })
  @Column({ length: 191 })
  sku!: string;

  @Column({ type: 'varchar', length: 512, nullable: true })
  title?: string | null;

  @Column({ name: 'stock_qty', type: 'int', default: 0 })
  stockQty!: number;

  @Column({ type: 'numeric', precision: 14, scale: 2, default: 0 })
  price!: string;

  @Column({ length: 8, default: 'USD' })
  currency!: string;

  @Column({ name: 'item_url', type: 'varchar', length: 1024, nullable: true })
  itemUrl?: string | null;

  @Column({ name: 'lingxing_product_id', type: 'varchar', length: 128, nullable: true })
  lingxingProductId?: string | null;

  @Column({ length: 32, nullable: true, default: 'ACTIVE' })
  status?: string;

  @Column({ name: 'raw_payload', type: 'simple-json', nullable: true })
  rawPayload?: Record<string, unknown> | null;

  @Column({ name: 'synced_at', type: 'datetime' })
  syncedAt!: Date;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
