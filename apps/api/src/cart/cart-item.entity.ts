import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

@Entity({ name: 'cart_items' })
@Index('uq_cart_user_sku', ['userId', 'sku'], { unique: true })
export class CartItem {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'user_id', type: 'varchar', length: 36 })
  userId!: string;

  @Column({ type: 'varchar', length: 191 })
  sku!: string;

  @Column({ name: 'title_snapshot', type: 'varchar', length: 512, nullable: true })
  titleSnapshot!: string | null;

  @Column({ type: 'int' })
  qty!: number;

  @Column({ name: 'unit_price_snapshot', type: 'decimal', precision: 14, scale: 2 })
  unitPriceSnapshot!: string;

  @Column({ name: 'currency_snapshot', type: 'varchar', length: 8 })
  currencySnapshot!: string;

  @Column({ name: 'item_url_snapshot', type: 'varchar', length: 1024, nullable: true })
  itemUrlSnapshot!: string | null;

  @Column({ name: 'ebay_product_ref', type: 'varchar', length: 36, nullable: true })
  ebayProductRef!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'datetime' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'datetime' })
  updatedAt!: Date;
}

