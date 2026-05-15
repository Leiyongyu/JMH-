import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { DistributorOrder } from './order.entity';

@Entity({ name: 'distributor_order_lines' })
export class OrderLine {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ name: 'order_id', type: 'varchar', length: 36 })
  orderId!: string;

  @ManyToOne(() => DistributorOrder, (o) => o.lines, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'order_id' })
  order!: DistributorOrder;

  @Column({ length: 191 })
  sku!: string;

  @Column({ name: 'title_snapshot', type: 'varchar', length: 512, nullable: true })
  titleSnapshot?: string | null;

  @Column({ type: 'int' })
  qty!: number;

  @Column({ name: 'unit_price_snapshot', type: 'numeric', precision: 14, scale: 2 })
  unitPriceSnapshot!: string;

  @Column({ name: 'currency_snapshot', length: 8 })
  currencySnapshot!: string;

  @Column({ name: 'item_url_snapshot', type: 'varchar', length: 1024, nullable: true })
  itemUrlSnapshot?: string | null;

  @Column({ name: 'ebay_product_ref', type: 'varchar', length: 36, nullable: true })
  ebayProductRef?: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}
