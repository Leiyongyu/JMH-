import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseEnumPipe,
  Patch,
  Post,
  Put,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../common/roles.guard';
import { Roles } from '../common/roles.decorator';
import { AccessControlService } from '../access/access-control.service';

@ApiTags('admin-distributor-groups')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
@Controller('admin/distributor-groups')
export class AdminDistributorGroupsController {
  constructor(private readonly access: AccessControlService) {}

  @ApiOperation({ summary: '管理员：分销商分组列表' })
  @Get()
  list() {
    return this.access.listGroups();
  }

  @ApiOperation({ summary: '管理员：创建分销商分组' })
  @Post()
  create(@Body() body: { code: string; name: string; description?: string | null }) {
    return this.access.createGroup(body);
  }

  @ApiOperation({ summary: '管理员：更新分销商分组' })
  @HttpCode(200)
  @Patch(':id')
  update(@Param('id') id: string, @Body() patch: Partial<{ code: string; name: string; description: string | null }>) {
    return this.access.updateGroup(id, patch);
  }

  @ApiOperation({ summary: '管理员：删除分销商分组（连带成员/商品授权）' })
  @HttpCode(200)
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.access.deleteGroup(id);
  }

  @ApiOperation({ summary: '管理员：分组成员列表' })
  @Get(':id/members')
  members(@Param('id') id: string) {
    return this.access.listGroupMembers(id);
  }

  @ApiOperation({ summary: '管理员：设置分组成员（全量覆盖）' })
  @HttpCode(200)
  @Put(':id/members')
  setMembers(@Param('id') id: string, @Body() body: { userIds: string[] }) {
    return this.access.setGroupMembers(id, body?.userIds ?? []);
  }

  @ApiOperation({ summary: '管理员：分组可见商品 SKU 列表' })
  @Get(':id/products')
  products(@Param('id') id: string) {
    return this.access.listGroupProductSkus(id);
  }

  @ApiOperation({ summary: '管理员：设置分组可见商品（按 SKU，全量覆盖）' })
  @HttpCode(200)
  @Put(':id/products')
  setProducts(@Param('id') id: string, @Body() body: { skus: string[] }) {
    return this.access.setGroupProductsBySkus(id, body?.skus ?? []);
  }

  @ApiOperation({ summary: '管理员：导入分组可见商品（Excel，第 1 列 SKU，可选第 2 列 price 为专属定价）' })
  @HttpCode(200)
  @Post(':id/products/import/xlsx')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 10 * 1024 * 1024 },
    }),
  )
  importProductsXlsx(
    @Param('id') id: string,
    @Query('mode', new ParseEnumPipe(['replace', 'add', 'remove'] as const, { optional: true }))
    mode: 'replace' | 'add' | 'remove' | undefined,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    return this.access.importGroupProductsXlsx({ groupId: id, fileBuffer: file?.buffer ?? Buffer.alloc(0), mode });
  }

  @ApiOperation({ summary: '管理员：获取分组专属定价列表' })
  @Get(':id/prices')
  getPrices(@Param('id') id: string) {
    return this.access.getGroupPrices(id);
  }

  @ApiOperation({ summary: '管理员：删除分组某个 SKU 的专属定价（按前缀）' })
  @HttpCode(200)
  @Delete(':id/prices/:sku')
  deletePrice(@Param('id') id: string, @Param('sku') sku: string) {
    return this.access.deleteGroupPrice(id, sku);
  }
}

