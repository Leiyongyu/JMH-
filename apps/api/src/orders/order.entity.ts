import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  OneToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { OrderLine } from './order-line.entity';
import { OrderShippingAddress } from './order-shipping-address.entity';

export type OrderStatus = 'CREATED' | 'CANCELLED';

@Entity({ name: 'distributor_orders' })
export class DistributorOrder {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index({ unique: true })
  @Column({ name: 'order_no', length: 32 })
  orderNo!: string;

  @Index()
  @Column({ name: 'buyer_user_id', type: 'varchar', length: 36 })
  buyerUserId!: string;

  @Column({ name: 'snapshot_buyer_email', length: 191 })
  snapshotBuyerEmail!: string;

  @Column({ name: 'snapshot_buyer_name', type: 'varchar', length: 64, nullable: true })
  snapshotBuyerName?: string | null;

  @Column({ type: 'varchar', length: 16, default: 'CREATED' })
  status!: OrderStatus;

  @Column({ name: 'lingxing_status', type: 'int', nullable: true })
  lingxingStatus?: number | null;

  @Column({ name: 'lingxing_status_text', type: 'varchar', length: 32, nullable: true })
  lingxingStatusText?: string | null;

  @Column({ name: 'lingxing_checked_at', type: 'datetime', nullable: true })
  lingxingCheckedAt?: Date | null;

  @Column({ name: 'lingxing_global_order_no', type: 'varchar', length: 64, nullable: true })
  lingxingGlobalOrderNo?: string | null;

  @Column({ name: 'total_amount', type: 'numeric', precision: 14, scale: 2, default: 0 })
  totalAmount!: string;

  @Column({ name: 'currency_snapshot', length: 8, default: 'USD' })
  currencySnapshot!: string;

  @Column({ type: 'varchar', length: 500, nullable: true })
  remark?: string | null;

  @Column({ name: 'ship_warehouse_code', type: 'varchar', length: 64, nullable: true })
  shipWarehouseCode?: string | null;

  @Column({ name: 'ship_warehouse_name', type: 'varchar', length: 191, nullable: true })
  shipWarehouseName?: string | null;

  @Column({ name: 'ship_warehouse_wid', type: 'int', nullable: true })
  shipWarehouseWid?: number | null;

  @OneToMany(() => OrderLine, (line) => line.order, { cascade: true })
  lines!: OrderLine[];

  @OneToOne(() => OrderShippingAddress, (addr) => addr.order)
  shippingAddress?: OrderShippingAddress;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
