import { Module } from '@nestjs/common';
import { EbayOAuthService } from './ebay-oauth.service';
import { EbayBrowseService } from './ebay-browse.service';
import { EbayTradingService } from './ebay-trading.service';
import { EbayUserOAuthService } from './ebay-user-oauth.service';

@Module({
  providers: [EbayOAuthService, EbayUserOAuthService, EbayBrowseService, EbayTradingService],
  exports: [EbayOAuthService, EbayUserOAuthService, EbayBrowseService, EbayTradingService],
})
export class EbayModule {}
