import { Controller, Get, HttpCode, NotFoundException, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../common/roles.decorator';
import { RolesGuard } from '../common/roles.guard';
import { DistributorOrder } from './order.entity';
import { LingxingOrderPushService } from './lingxing-order-push.service';

@ApiTags('admin-lingxing-orders')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
@Controller('admin/lingxing/orders')
export class OrdersLingxingController {
  constructor(
    @InjectRepository(DistributorOrder) private readonly orderRepo: Repository<DistributorOrder>,
    private readonly push: LingxingOrderPushService,
  ) {}

  @ApiOperation({ summary: '查询订单推送领星状态' })
  @Get(':orderNo')
  get(@Param('orderNo') orderNo: string) {
    return this.push.getLink(orderNo);
  }

  @ApiOperation({ summary: '手动推送订单到领星' })
  @HttpCode(200)
  @Post(':orderNo/push')
  async pushNow(@Param('orderNo') orderNo: string) {
    const order = await this.orderRepo.findOne({ where: { orderNo }, relations: { lines: true, shippingAddress: true } });
    if (!order) throw new NotFoundException('订单不存在');
    return this.push.pushOrder(order as any);
  }

  @ApiOperation({ summary: '查询领星订单管理状态（按本地订单号）' })
  @Get(':orderNo/lingxing-status')
  async lingxingStatus(@Param('orderNo') orderNo: string, @Query('storeId') storeId?: string, @Query('platformCode') platformCode?: string) {
    const link = await this.push.getLink(orderNo);
    if (!link) throw new NotFoundException('未找到推送记录');
    const pc = platformCode ? Number(platformCode) : link.platformCode;
    const sid = storeId ? String(storeId) : link.storeId;
    return this.push.findGlobalOrderNoByPlatformOrderNo(pc, sid, link.platformOrderNo);
  }
}

