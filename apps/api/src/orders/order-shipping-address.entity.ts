import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  OneToOne,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';
import { DistributorOrder } from './order.entity';

@Entity({ name: 'order_shipping_addresses' })
export class OrderShippingAddress {
  @PrimaryColumn({ name: 'order_no', type: 'varchar', length: 32 })
  orderNo!: string;

  @Column({ name: 'recipient_name', type: 'varchar', length: 64 })
  recipientName!: string;

  @Column({ type: 'varchar', length: 20 })
  phone!: string;

  @Column({ name: 'postal_code', type: 'varchar', length: 20, nullable: true })
  postalCode?: string | null;

  @Column({ name: 'country_region', type: 'varchar', length: 64 })
  countryRegion!: string;

  @Column({ name: 'state_province', type: 'varchar', length: 64 })
  stateProvince!: string;

  @Column({ type: 'varchar', length: 64 })
  city!: string;

  @Column({ type: 'varchar', length: 64, nullable: true })
  district?: string | null;

  @Column({ name: 'address_line', type: 'varchar', length: 512 })
  addressLine!: string;

  @OneToOne(() => DistributorOrder, (o) => o.shippingAddress, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'order_no', referencedColumnName: 'orderNo' })
  order!: DistributorOrder;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}

