import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { LingxingMpOrderService } from '../lingxing/lingxing-mp-order.service';
import { LingxingApiError } from '../lingxing/lingxing.types';
import { DistributorOrder } from './order.entity';
import { OrderShippingAddress } from './order-shipping-address.entity';
import { OrderLine } from './order-line.entity';
import { LingxingOrderLink } from './lingxing-order-link.entity';

function iso2(v: string): string {
  const s = String(v ?? '').trim();
  if (!s) return 'US';
  if (/^[a-zA-Z]{2}$/.test(s)) return s.toUpperCase();
  const x = s.toLowerCase();
  const map: Record<string, string> = {
    china: 'CN',
    '中国': 'CN',
    cn: 'CN',
    '中华人民共和国': 'CN',
    usa: 'US',
    us: 'US',
    america: 'US',
    '美国': 'US',
    uk: 'GB',
    gb: 'GB',
    britain: 'GB',
    england: 'GB',
    '英国': 'GB',
    germany: 'DE',
    '德国': 'DE',
    france: 'FR',
    '法国': 'FR',
    canada: 'CA',
    '加拿大': 'CA',
    australia: 'AU',
    '澳大利亚': 'AU',
  };
  return map[x] ?? 'US';
}

function safeNum(v: unknown): number | undefined {
  if (v === null || v === undefined || v === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

@Injectable()
export class LingxingOrderPushService {
  private readonly logger = new Logger(LingxingOrderPushService.name);

  constructor(
    private readonly cfg: ConfigService,
    private readonly mp: LingxingMpOrderService,
    @InjectRepository(LingxingOrderLink) private readonly linkRepo: Repository<LingxingOrderLink>,
    @InjectRepository(DistributorOrder) private readonly orderRepo: Repository<DistributorOrder>,
  ) {}

  private getPlatformCode(): number {
    const v = (this.cfg.get<string>('LINGXING_PUSH_PLATFORM_CODE') ?? process.env.LINGXING_PUSH_PLATFORM_CODE ?? '').trim();
    const n = Number(v || '10003');
    return Number.isFinite(n) ? n : 10003;
  }

  private getStoreId(): string {
    const v =
      (this.cfg.get<string>('LINGXING_PUSH_STORE_ID') ?? process.env.LINGXING_PUSH_STORE_ID ?? '').trim() ||
      (this.cfg.get<string>('LINGXING_EBAY_SIDS') ?? process.env.LINGXING_EBAY_SIDS ?? '').trim();
    return v;
  }

  private getWid(): string | undefined {
    const v = (this.cfg.get<string>('LINGXING_PUSH_WID') ?? process.env.LINGXING_PUSH_WID ?? '').trim();
    return v || undefined;
  }

  private getLogisticsTypeId(): string | undefined {
    const v = (this.cfg.get<string>('LINGXING_PUSH_LOGISTICS_TYPE_ID') ?? process.env.LINGXING_PUSH_LOGISTICS_TYPE_ID ?? '').trim();
    return v || '38422';
  }

  private platformNeedsOrderNames(platformCode: number): boolean {
    return new Set([10003, 10014, 10020, 10002, 10012, 10016]).has(platformCode);
  }

  async pushOrder(order: DistributorOrder & { lines?: OrderLine[]; shippingAddress?: OrderShippingAddress }) {
    const storeId = this.getStoreId();
    const platformCode = this.getPlatformCode();
    if (!storeId) {
      return {
        success: false,
        orderNo: order.orderNo,
        error: 'LINGXING_PUSH_STORE_ID 未配置（或 LINGXING_EBAY_SIDS 为空）',
      };
    }

    const existing = await this.linkRepo.findOne({ where: { orderNo: order.orderNo } });
    if (existing?.globalOrderNo) {
      return {
        success: true,
        orderNo: order.orderNo,
        globalOrderNo: existing.globalOrderNo,
        platformCode: existing.platformCode,
        storeId: existing.storeId,
      };
    }

    const link =
      existing ??
      this.linkRepo.create({
        orderNo: order.orderNo,
        storeId,
        platformCode,
        platformOrderNo: order.orderNo,
        pushStatus: 'PENDING',
        pushAttempts: 0,
      });
    link.storeId = storeId;
    link.platformCode = platformCode;
    link.platformOrderNo = order.orderNo;
    await this.linkRepo.save(link);

    const addr = order.shippingAddress;
    const lines = order.lines ?? [];
    if (!addr) {
      link.pushStatus = 'FAILED';
      link.lastError = '订单缺少收货地址';
      link.pushAttempts += 1;
      await this.linkRepo.save(link);
      return { success: false, orderNo: order.orderNo, error: link.lastError };
    }
    if (!lines || lines.length === 0) {
      link.pushStatus = 'FAILED';
      link.lastError = '订单缺少商品明细';
      link.pushAttempts += 1;
      await this.linkRepo.save(link);
      return { success: false, orderNo: order.orderNo, error: link.lastError };
    }

    const orderWidRaw = (order as unknown as { shipWarehouseWid?: number | null }).shipWarehouseWid;
    const wid = orderWidRaw ? String(orderWidRaw) : this.getWid();

    const buyerNoteParts: string[] = [];
    if (order.snapshotBuyerEmail) buyerNoteParts.push(`buyer=${order.snapshotBuyerEmail}`);
    if (addr.phone) buyerNoteParts.push(`phone=${addr.phone}`);
    if (addr.postalCode) buyerNoteParts.push(`zip=${addr.postalCode}`);
    if (addr.stateProvince) buyerNoteParts.push(`state=${addr.stateProvince}`);
    if (addr.district) buyerNoteParts.push(`district=${addr.district}`);
    const buyerNote = buyerNoteParts.join(' | ') || undefined;

    link.pushAttempts += 1;
    link.lastPushedAt = new Date();
    await this.linkRepo.save(link);

    try {
      const resp = await this.mp.createOrdersV2({
        platform_code: platformCode,
        store_id: storeId,
        orders: [
          {
            platform_order_no: order.orderNo,
            buyer_note: buyerNote,
            remark: order.remark ? String(order.remark).slice(0, 950) : undefined,
            receiver_country_code: iso2(addr.countryRegion),
            receiver_name: addr.recipientName,
            city: addr.city,
            address_line1: addr.addressLine,
            amount_currency: order.currencySnapshot || undefined,
            order_total_amount: safeNum(order.totalAmount),
            items: lines.map((l) => ({
              sku: l.sku,
              quantity: l.qty,
              unit_price: safeNum(l.unitPriceSnapshot) ?? 0,
              stock_deduction_type: 1,
            })),
          },
        ],
      });

      const data = resp.data ?? { error_details: [], success_details: [] };
      const ok = data.success_details?.find((x) => x.platform_order_no === order.orderNo);
      const err = data.error_details?.find((x) => x.platform_order_no === order.orderNo);

      link.rawPayload = data as unknown as Record<string, unknown>;
      if (ok?.global_order_no) {
        link.pushStatus = 'SUCCESS';
        link.globalOrderNo = String(ok.global_order_no);
        link.lastError = null;
        await this.linkRepo.save(link);
        await this.markOrderPendingReview(order.orderNo, link.globalOrderNo);
        return {
          success: true,
          orderNo: order.orderNo,
          globalOrderNo: link.globalOrderNo,
          platformCode,
          storeId,
        };
      }

      const msg = err?.error_message ? String(err.error_message) : '领星返回未知失败';
      link.pushStatus = 'FAILED';
      link.lastError = msg.slice(0, 1000);
      await this.linkRepo.save(link);

      const maybeDup = msg.includes('重复') || msg.toLowerCase().includes('repeat') || msg.toLowerCase().includes('exist');
      if (maybeDup) {
        const found = await this.findGlobalOrderNoByPlatformOrderNo(platformCode, storeId, order.orderNo);
        if (found?.globalOrderNo) {
          link.pushStatus = 'SUCCESS';
          link.globalOrderNo = found.globalOrderNo;
          link.lastError = null;
          link.lastLingxingStatus = found.status ?? null;
          link.lastCheckedAt = new Date();
          await this.linkRepo.save(link);
          await this.markOrderPendingReview(order.orderNo, link.globalOrderNo);
          return {
            success: true,
            orderNo: order.orderNo,
            globalOrderNo: link.globalOrderNo,
            platformCode,
            storeId,
            dedupRecovered: true,
          };
        }
      }

      return { success: false, orderNo: order.orderNo, error: link.lastError };
    } catch (e) {
      link.pushStatus = 'FAILED';
      if (e instanceof LingxingApiError) {
        link.lastError = `领星API错误 code=${String(e.code)} ${String(e.message)}`.slice(0, 1000);
        if (e.raw !== undefined) {
          link.rawPayload = { error: e.raw } as unknown as Record<string, unknown>;
        }
      } else {
        link.lastError = e instanceof Error ? String(e.message).slice(0, 1000) : String(e).slice(0, 1000);
      }
      await this.linkRepo.save(link);
      this.logger.warn(`pushOrder failed orderNo=${order.orderNo}: ${link.lastError}`);
      return { success: false, orderNo: order.orderNo, error: link.lastError };
    }
  }

  private async markOrderPendingReview(orderNo: string, globalOrderNo?: string | null): Promise<void> {
    const no = String(orderNo ?? '').trim();
    if (!no) return;
    try {
      const now = new Date();
      await this.orderRepo.query(
        `
        UPDATE distributor_orders
        SET
          lingxing_status = 4,
          lingxing_status_text = '待审核',
          lingxing_global_order_no = COALESCE(?, lingxing_global_order_no),
          lingxing_checked_at = ?,
          updated_at = CURRENT_TIMESTAMP
        WHERE order_no = ?
      `,
        [globalOrderNo ?? null, now, no],
      );
    } catch {
      // ignore
    }
  }

  async findGlobalOrderNoByPlatformOrderNo(platformCode: number, storeId: string, platformOrderNo: string) {
    const body: any = {
      offset: 0,
      length: 20,
      store_id: [storeId],
      platform_code: [platformCode],
    };
    if (this.platformNeedsOrderNames(platformCode)) body.platform_order_names = [platformOrderNo];
    else body.platform_order_nos = [platformOrderNo];

    const resp = await this.mp.listOrdersV2(body);
    const list = resp.data?.list ?? [];
    const hit =
      list.find((x) => x.global_order_no && x.platform_info?.some((p) => p.platform_order_no === platformOrderNo || p.platform_order_name === platformOrderNo)) ??
      list.find((x) => x.global_order_no);
    if (!hit?.global_order_no) return null;
    return {
      globalOrderNo: String(hit.global_order_no),
      status: typeof hit.status === 'number' ? hit.status : Number(hit.status),
    };
  }

  async getLink(orderNo: string) {
    return this.linkRepo.findOne({ where: { orderNo } });
  }
}
