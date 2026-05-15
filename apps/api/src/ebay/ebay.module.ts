import { Module } from '@nestjs/common';
import { EbayOAuthService } from './ebay-oauth.service';
import { EbayBrowseService } from './ebay-browse.service';
import { EbayTradingService } from './ebay-trading.service';

@Module({
  providers: [EbayOAuthService, EbayBrowseService, EbayTradingService],
  exports: [EbayOAuthService, EbayBrowseService, EbayTradingService],
})
export class EbayModule {}
