import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, Unique, UpdateDateColumn } from 'typeorm';

@Entity({ name: 'ebay_sku_price_selections' })
@Unique('uq_ebay_sku_price_selection_sku', ['sku'])
export class EbaySkuPriceSelection {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ length: 191 })
  sku!: string;

  @Column({ type: 'numeric', precision: 14, scale: 2, default: 0 })
  price!: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
