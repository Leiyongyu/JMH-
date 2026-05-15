import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { LingxingSignService } from './lingxing-sign.service';
import { LingxingTokenService } from './lingxing-token.service';
import { LingxingHttpService } from './lingxing-http.service';
import { LingxingMpOrderService } from './lingxing-mp-order.service';

@Module({
  imports: [ConfigModule],
  providers: [LingxingSignService, LingxingTokenService, LingxingHttpService, LingxingMpOrderService],
  exports: [LingxingSignService, LingxingTokenService, LingxingHttpService, LingxingMpOrderService],
})
export class LingxingModule {}
