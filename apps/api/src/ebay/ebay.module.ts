import { Module } from '@nestjs/common';
import { EbayOAuthService } from './ebay-oauth.service';
import { EbayBrowseService } from './ebay-browse.service';
import { EbayTradingService } from './ebay-trading.service';
import { EbayUserOAuthService } from './ebay-user-oauth.service';
import { EbayUrlTestService } from './ebay-url-test.service';
import { EbayTestCacheService } from './ebay-test-cache.service';

@Module({
  providers: [
    EbayOAuthService,
    EbayUserOAuthService,
    EbayBrowseService,
    EbayTradingService,
    EbayUrlTestService,
    EbayTestCacheService,
  ],
  exports: [
    EbayOAuthService,
    EbayUserOAuthService,
    EbayBrowseService,
    EbayTradingService,
    EbayUrlTestService,
    EbayTestCacheService,
  ],
})
export class EbayModule {}
