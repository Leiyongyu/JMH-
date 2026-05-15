import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcryptjs';
import { User, UserRole } from './user.entity';

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    @InjectRepository(User) private readonly repo: Repository<User>,
    private readonly config: ConfigService,
  ) {}

  findByEmail(email: string) {
    return this.repo.findOne({ where: { email: email.toLowerCase().trim() } });
  }

  normalizePhoneDigits(phone: string): string {
    return phone.replace(/\D/g, '').trim();
  }

  findByPhone(phoneDigits: string) {
    const p = this.normalizePhoneDigits(phoneDigits);
    if (!p) return Promise.resolve(null);
    return this.repo.findOne({ where: { phone: p } });
  }

  /** 前端传入手机号或邮箱，解析为 User */
  async resolveByLogin(account: string): Promise<User | null> {
    const raw = account.trim();
    if (!raw) return null;
    if (raw.includes('@')) {
      return this.findByEmail(raw);
    }
    const digits = this.normalizePhoneDigits(raw);
    const byPhone = await this.findByPhone(digits);
    if (byPhone) return byPhone;
    return this.findByEmail(raw);
  }

  findById(id: string) {
    return this.repo.findOne({ where: { id } });
  }

  async adminList(q: {
    q?: string;
    role?: UserRole;
    page?: number;
    pageSize?: number;
  }): Promise<{ items: User[]; total: number; page: number; pageSize: number }> {
    const page = Math.max(1, Number(q.page ?? 1));
    const pageSize = Math.min(100, Math.max(1, Number(q.pageSize ?? 20)));
    const qb = this.repo.createQueryBuilder('u').orderBy('u.createdAt', 'DESC');
    const kw = q.q?.trim();
    if (kw) {
      const like = `%${kw}%`;
      const phoneDigits = this.normalizePhoneDigits(kw);
      qb.andWhere(
        `(
          LOWER(u.email) LIKE LOWER(:like)
          OR LOWER(COALESCE(u.displayName, '')) LIKE LOWER(:like)
          ${phoneDigits ? 'OR u.phone LIKE :phoneLike' : ''}
        )`,
        {
          like,
          ...(phoneDigits ? { phoneLike: `%${phoneDigits}%` } : {}),
        },
      );
    }
    if (q.role) qb.andWhere('u.role = :role', { role: q.role });
    const [items, total] = await qb
      .skip((page - 1) * pageSize)
      .take(pageSize)
      .getManyAndCount();
    return { items, total, page, pageSize };
  }

  async adminUpdate(
    id: string,
    patch: {
      email?: string;
      phone?: string;
      password?: string;
      role?: UserRole;
      displayName?: string;
    },
  ): Promise<User> {
    const u = await this.findById(id);
    if (!u) throw new NotFoundException('用户不存在');

    if (patch.email !== undefined) u.email = patch.email.toLowerCase().trim();
    if (patch.phone !== undefined) {
      const p = this.normalizePhoneDigits(patch.phone);
      u.phone = p ? p : null;
    }
    if (patch.role !== undefined) u.role = patch.role;
    if (patch.displayName !== undefined) {
      const name = patch.displayName.trim();
      u.displayName = name ? name : null;
    }
    if (patch.password !== undefined) {
      const pwd = patch.password.trim();
      if (pwd) u.passwordHash = await bcrypt.hash(pwd, 10);
    }

    return this.repo.save(u);
  }

  async adminRemove(id: string): Promise<User> {
    const u = await this.findById(id);
    if (!u) throw new NotFoundException('用户不存在');
    await this.repo.remove(u);
    return u;
  }

  async create(args: {
    email: string;
    phone?: string | null;
    password: string;
    role: UserRole;
    displayName?: string;
  }): Promise<User> {
    const passwordHash = await bcrypt.hash(args.password, 10);
    const phoneNorm = args.phone ? this.normalizePhoneDigits(args.phone) : null;
    const entity = this.repo.create({
      email: args.email.toLowerCase().trim(),
      phone: phoneNorm || null,
      passwordHash,
      role: args.role,
      displayName: args.displayName ?? null,
    });
    return this.repo.save(entity);
  }

  verifyPassword(plain: string, hash: string) {
    return bcrypt.compare(plain, hash);
  }

  async seedFromEnv(): Promise<void> {
    return;
  }
}
