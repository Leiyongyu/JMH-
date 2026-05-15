import {
  BadRequestException,
  Body,
  Controller,
  DefaultValuePipe,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../common/roles.guard';
import { Roles } from '../common/roles.decorator';
import { CurrentUser, JwtUser } from '../common/current-user.decorator';
import { UsersService } from '../users/users.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';

type SafeUser = {
  id: string;
  email: string;
  phone: string | null;
  role: 'ADMIN' | 'DISTRIBUTOR';
  displayName: string | null;
  createdAt: Date;
  updatedAt: Date;
};

@ApiTags('admin-users')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
@Controller('admin/users')
export class AdminUsersController {
  constructor(private readonly users: UsersService) {}

  private toSafe(u: { id: string; email: string; phone?: string | null; role: SafeUser['role']; displayName?: string | null; createdAt: Date; updatedAt: Date }): SafeUser {
    return {
      id: u.id,
      email: u.email,
      phone: u.phone ?? null,
      role: u.role,
      displayName: u.displayName ?? null,
      createdAt: u.createdAt,
      updatedAt: u.updatedAt,
    };
  }

  private mapDupError(err: unknown): never {
    const code = (err as { code?: string })?.code;
    if (code === 'ER_DUP_ENTRY' || code === 'SQLITE_CONSTRAINT' || code === '23505') {
      throw new BadRequestException('邮箱或手机号已存在');
    }
    throw err;
  }

  @ApiOperation({ summary: '管理员：用户列表（分页）' })
  @Get()
  async list(
    @Query('q') q?: string,
    @Query('role') role?: SafeUser['role'],
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page?: number,
    @Query('pageSize', new DefaultValuePipe(20), ParseIntPipe) pageSize?: number,
  ) {
    const res = await this.users.adminList({ q, role, page, pageSize });
    return {
      ...res,
      items: res.items.map((u) => this.toSafe(u)),
    };
  }

  @ApiOperation({ summary: '管理员：创建用户' })
  @Post()
  async create(@Body() dto: CreateUserDto) {
    try {
      const u = await this.users.create({
        email: dto.email,
        phone: dto.phone,
        password: dto.password,
        role: dto.role,
        displayName: dto.displayName,
      });
      return this.toSafe(u);
    } catch (err) {
      this.mapDupError(err);
    }
  }

  @ApiOperation({ summary: '管理员：更新用户' })
  @HttpCode(200)
  @Patch(':id')
  async update(@CurrentUser() current: JwtUser, @Param('id') id: string, @Body() dto: UpdateUserDto) {
    if (id === current.sub && dto.role && dto.role !== 'ADMIN') {
      throw new BadRequestException('不能将自己的角色降级');
    }
    try {
      const u = await this.users.adminUpdate(id, {
        email: dto.email,
        phone: dto.phone,
        role: dto.role,
        displayName: dto.displayName,
        password: dto.password,
      });
      return this.toSafe(u);
    } catch (err) {
      this.mapDupError(err);
    }
  }

  @ApiOperation({ summary: '管理员：删除用户' })
  @HttpCode(200)
  @Delete(':id')
  async remove(@CurrentUser() current: JwtUser, @Param('id') id: string) {
    if (id === current.sub) throw new BadRequestException('不能删除当前登录用户');
    const u = await this.users.adminRemove(id);
    return this.toSafe(u);
  }
}

