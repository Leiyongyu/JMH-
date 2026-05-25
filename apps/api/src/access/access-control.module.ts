import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../users/user.entity';
import { EbayProduct } from '../products/ebay-product.entity';
import { DistributorGroup } from './distributor-group.entity';
import { DistributorGroupMember } from './distributor-group-member.entity';
import { DistributorGroupPrice } from './distributor-group-price.entity';
import { EbayProductVisibilityGroup } from './ebay-product-visibility-group.entity';
import { AccessControlService } from './access-control.service';

@Module({
  imports: [TypeOrmModule.forFeature([DistributorGroup, DistributorGroupMember, DistributorGroupPrice, EbayProductVisibilityGroup, User, EbayProduct])],
  providers: [AccessControlService],
  exports: [AccessControlService],
})
export class AccessControlModule {}

