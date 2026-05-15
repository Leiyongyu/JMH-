import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DistributorOrder } from './order.entity';
import { LingxingOrderLink } from './lingxing-order-link.entity';
import { LingxingOrderPushService } from './lingxing-order-push.service';

@Injectable()
export class LingxingOrderRetryService {
  constructor(
    @InjectRepository(LingxingOrderLink) private readonly linkRepo: Repository<LingxingOrderLink>,
    @InjectRepository(DistributorOrder) private readonly orderRepo: Repository<DistributorOrder>,
    private readonly push: LingxingOrderPushService,
  ) {}

  @Cron('*/2 * * * *')
  async retryFailed() {
    const links = await this.linkRepo.find({
      where: { pushStatus: 'FAILED' },
      order: { updatedAt: 'ASC' },
      take: 10,
    });
    for (const l of links) {
      if ((l.pushAttempts ?? 0) >= 5) continue;
      const order = await this.orderRepo.findOne({ where: { orderNo: l.orderNo }, relations: { lines: true, shippingAddress: true } });
      if (!order) continue;
      await this.push.pushOrder(order as any);
    }
  }
}

