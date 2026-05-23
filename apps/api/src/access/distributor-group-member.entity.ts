import { CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, Column } from 'typeorm';

@Entity({ name: 'distributor_group_members' })
@Index(['groupId', 'userId'], { unique: true })
@Index(['userId'])
export class DistributorGroupMember {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'group_id', type: 'varchar', length: 36 })
  groupId!: string;

  @Column({ name: 'user_id', type: 'varchar', length: 36 })
  userId!: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}
