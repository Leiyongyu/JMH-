import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity({ name: 'ebay_product_visibility_groups' })
@Index(['groupId', 'productId'], { unique: true })
@Index(['productId'])
export class EbayProductVisibilityGroup {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'group_id', type: 'varchar', length: 36 })
  groupId!: string;

  @Column({ name: 'product_id', type: 'varchar', length: 36 })
  productId!: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}
