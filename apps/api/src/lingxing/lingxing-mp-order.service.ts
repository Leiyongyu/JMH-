import { Injectable } from '@nestjs/common';
import { LingxingHttpService } from './lingxing-http.service';
import type {
  CreateOrdersV2Body,
  CreateOrdersV2Data,
  MpOrderListV2Body,
  MpOrderListV2Data,
  SellerListV2Body,
  SellerListV2Data,
} from './lingxing-mp-order.types';

@Injectable()
export class LingxingMpOrderService {
  constructor(private readonly http: LingxingHttpService) {}

  createOrdersV2(body: CreateOrdersV2Body) {
    return this.http.request<CreateOrdersV2Data>({
      method: 'POST',
      path: '/pb/mp/order/v2/create',
      body: body as unknown as Record<string, unknown>,
    });
  }

  listOrdersV2(body: MpOrderListV2Body) {
    return this.http.request<MpOrderListV2Data>({
      method: 'POST',
      path: '/pb/mp/order/v2/list',
      body: body as unknown as Record<string, unknown>,
    });
  }

  getSellerListV2(body: SellerListV2Body) {
    return this.http.request<SellerListV2Data>({
      method: 'POST',
      path: '/pb/mp/shop/v2/getSellerList',
      body: body as unknown as Record<string, unknown>,
    });
  }
}

