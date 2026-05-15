import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export type UserRole = 'ADMIN' | 'DISTRIBUTOR';

@Entity({ name: 'users' })
export class User {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index({ unique: true })
  @Column({ length: 191 })
  email!: string;

  /** 登录用手机号（仅数字，可与邮箱二选一作为主登录标识种子） */
  @Index({ unique: true })
  @Column({ type: 'varchar', length: 20, nullable: true })
  phone?: string | null;

  @Column({ name: 'password_hash', length: 255 })
  passwordHash!: string;

  @Column({ type: 'varchar', length: 32, default: 'DISTRIBUTOR' })
  role!: UserRole;

  @Column({ name: 'display_name', type: 'varchar', length: 64, nullable: true })
  displayName?: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
