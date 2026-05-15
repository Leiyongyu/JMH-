import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { UsersService } from '../users/users.service';
import { JwtUser } from '../common/current-user.decorator';

@Injectable()
export class AuthService {
  constructor(
    private readonly users: UsersService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  async login(account: string, password: string) {
    const user = await this.users.resolveByLogin(account);
    if (!user) throw new UnauthorizedException('账号或密码错误');

    const adminOnly =
      String(this.config.get<string>('ADMIN_ONLY_LOGIN', 'false')).toLowerCase() === 'true';
    if (adminOnly && user.role !== 'ADMIN') {
      throw new UnauthorizedException('当前系统仅管理员可登录');
    }

    const phoneOnlyLogin =
      String(this.config.get<string>('ADMIN_LOGIN_PHONE_ONLY', 'false')).toLowerCase() ===
      'true';
    const seedPhone = this.config.get<string>('SEED_ADMIN_PHONE')?.trim();
    if (phoneOnlyLogin && seedPhone) {
      const want = this.users.normalizePhoneDigits(seedPhone);
      const got = user.phone ? this.users.normalizePhoneDigits(user.phone) : '';
      if (!got || got !== want) {
        throw new UnauthorizedException(
          '已启用管理员手机号登录：请使用与 SEED_ADMIN_PHONE 一致的手机号；若刚改 .env，请重启 API 以同步账号',
        );
      }
    }

    const ok = await this.users.verifyPassword(password, user.passwordHash);
    if (!ok) throw new UnauthorizedException('账号或密码错误');

    const phone = user.phone ?? undefined;
    const payload: JwtUser = {
      sub: user.id,
      email: user.email,
      role: user.role,
      phone,
      displayName: user.displayName ?? undefined,
    };
    const token = await this.jwt.signAsync(payload);
    return {
      token,
      user: {
        id: user.id,
        email: user.email,
        phone: phone ?? null,
        role: user.role,
        displayName: user.displayName,
      },
    };
  }
}
