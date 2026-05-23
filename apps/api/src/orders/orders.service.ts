import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { DistributorOrder } from './order.entity';
import { OrderLine } from './order-line.entity';
import { EbayProduct } from '../products/ebay-product.entity';
import { User } from '../users/user.entity';
import { JwtUser } from '../common/current-user.decorator';
import { CreateOrderDto } from './dto/create-order.dto';
import { OrderShippingAddress } from './order-shipping-address.entity';
import { LingxingOrderPushService } from './lingxing-order-push.service';
import { LingxingOrderLink } from './lingxing-order-link.entity';
import { lingxingOrderStatusText } from './lingxing-order-status.util';
import { LingxingWarehouse } from '../warehouses/lingxing-warehouse.entity';
import { AccessControlService } from '../access/access-control.service';

export interface OrderListQuery {
  page?: number;
  pageSize?: number;
  all?: boolean;
  keyword?: string;
  status?: string;
  lingxingStatusText?: string;
}

export type BillRow = {
  orderId: string;
  orderNo: string;
  createdAtText: string;
  buyerEmail: string;
  statusText: string;
  currency: string;
  orderTotal: string;
  itemsCount: number;
  sku: string;
  title: string;
  qty: number;
  unitPrice: string;
  lineTotal: string;
};

@Injectable()
export class OrdersService {
  constructor(
    @InjectRepository(DistributorOrder) private readonly orderRepo: Repository<DistributorOrder>,
    @InjectRepository(EbayProduct) private readonly productRepo: Repository<EbayProduct>,
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    @InjectRepository(LingxingOrderLink) private readonly linkRepo: Repository<LingxingOrderLink>,
    @InjectRepository(LingxingWarehouse) private readonly whRepo: Repository<LingxingWarehouse>,
    private readonly dataSource: DataSource,
    private readonly lingxingPush: LingxingOrderPushService,
    private readonly access: AccessControlService,
  ) {}

  private normalizeShipWarehouseCode(input?: string | null): string | null {
    const s = String(input ?? '').trim();
    return s ? s : null;
  }

  private genOrderNo(): string {
    const d = new Date();
    const pad = (n: number, w = 2) => n.toString().padStart(w, '0');
    const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
    const rand = Math.floor(Math.random() * 9000 + 1000);
    return `D${stamp}${rand}`;
  }

  async create(currentUser: JwtUser, dto: CreateOrderDto): Promise<DistributorOrder> {
    if (!dto.items || dto.items.length === 0) {
      throw new BadRequestException('购物车为空');
    }
    if (!dto.shippingAddress) {
      throw new BadRequestException('请填写收货地址');
    }
    if (currentUser.role !== 'ADMIN') {
      for (const it of dto.items) {
        await this.access.assertEbaySkuVisibleToUser(String(it?.sku ?? ''), currentUser);
      }
    }
    const created = await this.dataSource.transaction(async (mgr) => {
      const buyer = await mgr.getRepository(User).findOne({ where: { id: currentUser.sub } });
      if (!buyer) throw new NotFoundException('当前用户不存在');

      const shipWarehouseCode = this.normalizeShipWarehouseCode(dto.shipWarehouseCode);
      const shipWarehouseWidFromCode =
        shipWarehouseCode && /^\d+$/.test(shipWarehouseCode) ? Number.parseInt(shipWarehouseCode, 10) : null;
      const wh = shipWarehouseCode
        ? await mgr
            .getRepository(LingxingWarehouse)
            .createQueryBuilder('w')
            .where(
              shipWarehouseWidFromCode !== null
                ? 'w.wid = :wid'
                : 'w.tWarehouseCode = :c',
              shipWarehouseWidFromCode !== null ? { wid: shipWarehouseWidFromCode } : { c: shipWarehouseCode },
            )
            .andWhere('w.isDelete = 0')
            .orderBy('w.updatedAt', 'DESC')
            .getOne()
        : null;

      const order = mgr.getRepository(DistributorOrder).create({
        orderNo: this.genOrderNo(),
        buyerUserId: buyer.id,
        snapshotBuyerEmail: buyer.email,
        snapshotBuyerName: buyer.displayName ?? null,
        status: 'CREATED',
        totalAmount: '0',
        currencySnapshot: 'USD',
        remark: dto.remark ?? null,
        shipWarehouseCode,
        shipWarehouseName: wh?.tWarehouseName ?? wh?.name ?? null,
        shipWarehouseWid: wh?.wid ?? null,
      });
      const savedOrder = await mgr.getRepository(DistributorOrder).save(order);

      const addr = dto.shippingAddress;
      await mgr.getRepository(OrderShippingAddress).save(
        mgr.getRepository(OrderShippingAddress).create({
          orderNo: savedOrder.orderNo,
          recipientName: String(addr.recipientName || '').trim(),
          phone: String(addr.phone || '').trim(),
          postalCode: addr.postalCode ? String(addr.postalCode).trim() : null,
          countryRegion: String(addr.countryRegion || '').trim(),
          stateProvince: String(addr.stateProvince || '').trim(),
          city: String(addr.city || '').trim(),
          district: addr.district ? String(addr.district).trim() : null,
          addressLine: String(addr.addressLine || '').trim(),
        }),
      );

      const lineRepo = mgr.getRepository(OrderLine);
      const productRepo = mgr.getRepository(EbayProduct);

      let total = 0;
      let currency: string | null = null;
      const linesToInsert: OrderLine[] = [];

      for (const item of dto.items) {
        const product = await productRepo.findOne({ where: { sku: item.sku } });
        if (!product) {
          throw new BadRequestException(`SKU ${item.sku} 不存在或尚未同步`);
        }
        const unitPrice = Number(product.price);
        if (!Number.isFinite(unitPrice)) {
          throw new BadRequestException(`SKU ${item.sku} 价格无效`);
        }
        if (!currency) currency = product.currency;
        total += unitPrice * item.qty;

        linesToInsert.push(
          lineRepo.create({
            orderId: savedOrder.id,
            sku: product.sku,
            titleSnapshot: product.title ?? null,
            qty: item.qty,
            unitPriceSnapshot: product.price,
            currencySnapshot: product.currency,
            itemUrlSnapshot: product.itemUrl ?? null,
            ebayProductRef: product.id,
          }),
        );
      }

      await lineRepo.save(linesToInsert);

      savedOrder.totalAmount = total.toFixed(2);
      savedOrder.currencySnapshot = currency ?? 'USD';
      await mgr.getRepository(DistributorOrder).save(savedOrder);

      const full = await mgr.getRepository(DistributorOrder).findOne({
        where: { id: savedOrder.id },
        relations: { lines: true, shippingAddress: true },
      });
      return full!;
    });

    this.lingxingPush.pushOrder(created as DistributorOrder & { lines: OrderLine[]; shippingAddress: OrderShippingAddress }).catch(() => {});

    return created;
  }

  async list(currentUser: JwtUser, q: OrderListQuery) {
    const page = Math.max(1, Number(q.page ?? 1));
    const pageSize = Math.min(100, Math.max(1, Number(q.pageSize ?? 20)));
    const qb = this.orderRepo
      .createQueryBuilder('o')
      .leftJoinAndSelect('o.lines', 'l')
      .leftJoinAndSelect('o.shippingAddress', 'a')
      .orderBy('o.createdAt', 'DESC');
    if (currentUser.role !== 'ADMIN') qb.where('o.buyerUserId = :uid', { uid: currentUser.sub });

    const kw = q.keyword?.trim();
    if (kw) {
      const like = `%${kw.toLowerCase()}%`;
      qb.andWhere('(LOWER(o.orderNo) LIKE :like OR LOWER(o.snapshotBuyerEmail) LIKE :like)', { like });
    }

    const lxTextRaw = q.lingxingStatusText?.trim();
    if (lxTextRaw) {
      const v = lxTextRaw === 'NULL' ? null : lxTextRaw;
      if (v === null) qb.andWhere('o.lingxingStatusText IS NULL');
      else qb.andWhere('o.lingxingStatusText = :lxText', { lxText: v });
    }

    const statusRaw = q.status?.trim();
    if (statusRaw) {
      const s = statusRaw.toUpperCase();
      if (s === 'CREATED' || s === 'CANCELLED') {
        qb.andWhere('o.status = :os', { os: s });
      } else if (s.startsWith('LX_')) {
        const codeStr = s.slice(3);
        if (codeStr === 'NONE') {
          qb.andWhere('o.lingxingStatus IS NULL');
        } else {
          const code = Number(codeStr);
          if (Number.isFinite(code)) {
            qb.andWhere('o.lingxingStatus = :ls', { ls: Math.trunc(code) });
          }
        }
      }
    }
    const [items, total] = await qb
      .skip((page - 1) * pageSize)
      .take(pageSize)
      .getManyAndCount();
    const orderNos = items.map((x) => x.orderNo).filter(Boolean);
    const links = orderNos.length ? await this.linkRepo.find({ where: { orderNo: In(orderNos) } }) : [];
    const linkMap = new Map<string, LingxingOrderLink>();
    for (const l of links) linkMap.set(l.orderNo, l);
    const wids = Array.from(
      new Set(
        items
          .flatMap((o) => {
            const wid = (o as unknown as { shipWarehouseWid?: number | null }).shipWarehouseWid;
            if (typeof wid === 'number' && Number.isFinite(wid)) return [wid];
            const code = String((o as any).shipWarehouseCode ?? '').trim();
            if (code && /^\d+$/.test(code)) return [Number.parseInt(code, 10)];
            return [];
          }),
      ),
    );
    const warehouses = wids.length ? await this.whRepo.find({ where: { wid: In(wids), isDelete: 0 } }) : [];
    const whMap = new Map<number, LingxingWarehouse>();
    for (const w of warehouses) whMap.set(w.wid, w);

    return {
      items: items.map((o) => {
        const l = linkMap.get(o.orderNo);
        const widRaw = (o as unknown as { shipWarehouseWid?: number | null }).shipWarehouseWid;
        const codeRaw = String((o as any).shipWarehouseCode ?? '').trim();
        const wid =
          typeof widRaw === 'number' && Number.isFinite(widRaw)
            ? widRaw
            : codeRaw && /^\d+$/.test(codeRaw)
              ? Number.parseInt(codeRaw, 10)
              : null;
        const wh = wid !== null ? whMap.get(wid) : undefined;
        const shipWarehouseName = wh ? (wh.name ?? wh.tWarehouseName ?? null) : (o as any).shipWarehouseName ?? null;
        return {
          ...o,
          shipWarehouseName,
          lingxing: l
            ? {
                pushStatus: l.pushStatus,
                globalOrderNo: l.globalOrderNo ?? null,
                status: l.lastLingxingStatus ?? null,
                statusText: lingxingOrderStatusText(l.lastLingxingStatus),
                checkedAt: l.lastCheckedAt ? l.lastCheckedAt.toISOString() : null,
                lastError: l.lastError ?? null,
                pushAttempts: l.pushAttempts ?? 0,
                lastPushedAt: l.lastPushedAt ? l.lastPushedAt.toISOString() : null,
              }
            : null,
        };
      }),
      total,
      page,
      pageSize,
    };
  }

  async findByOrderNo(currentUser: JwtUser, orderNo: string) {
    const order = await this.orderRepo.findOne({
      where: { orderNo },
      relations: { lines: true, shippingAddress: true },
    });
    if (!order) throw new NotFoundException('订单不存在');
    if (currentUser.role !== 'ADMIN' && order.buyerUserId !== currentUser.sub) {
      throw new ForbiddenException('无权查看该订单');
    }
    const link = await this.linkRepo.findOne({ where: { orderNo } });
    const widRaw = (order as unknown as { shipWarehouseWid?: number | null }).shipWarehouseWid;
    const codeRaw = String((order as any).shipWarehouseCode ?? '').trim();
    const wid =
      typeof widRaw === 'number' && Number.isFinite(widRaw)
        ? widRaw
        : codeRaw && /^\d+$/.test(codeRaw)
          ? Number.parseInt(codeRaw, 10)
          : null;
    const wh =
      typeof wid === 'number' && Number.isFinite(wid)
        ? await this.whRepo.findOne({ where: { wid, isDelete: 0 } })
        : null;
    const shipWarehouseName = wh ? (wh.name ?? wh.tWarehouseName ?? null) : (order as any).shipWarehouseName ?? null;
    return {
      ...order,
      shipWarehouseName,
      lingxing: link
        ? {
            pushStatus: link.pushStatus,
            globalOrderNo: link.globalOrderNo ?? null,
            status: link.lastLingxingStatus ?? null,
            statusText: lingxingOrderStatusText(link.lastLingxingStatus),
            checkedAt: link.lastCheckedAt ? link.lastCheckedAt.toISOString() : null,
            lastError: link.lastError ?? null,
            pushAttempts: link.pushAttempts ?? 0,
            lastPushedAt: link.lastPushedAt ? link.lastPushedAt.toISOString() : null,
          }
        : null,
    };
  }

  async listLingxingStatusTextOptions(currentUser: JwtUser): Promise<Array<string | null>> {
    const qb = this.orderRepo.createQueryBuilder('o').select('DISTINCT o.lingxingStatusText', 't');
    if (currentUser.role !== 'ADMIN') qb.where('o.buyerUserId = :uid', { uid: currentUser.sub });
    qb.orderBy('t', 'ASC');

    const rows = await qb.getRawMany<{ t: string | null }>();
    const out: Array<string | null> = [];
    for (const r of rows) {
      if (r.t === null) out.push(null);
      else {
        const s = String(r.t).trim();
        if (s) out.push(s);
        else out.push(null);
      }
    }
    const hasNull = out.includes(null);
    const uniq = Array.from(new Set(out.filter((x): x is string => x !== null)));
    uniq.sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'));
    return hasNull ? [null, ...uniq] : uniq;
  }

  async billRowsByIds(currentUser: JwtUser, orderIds: string[]): Promise<BillRow[]> {
    const ids = Array.from(new Set((orderIds ?? []).map((x) => String(x).trim()).filter(Boolean)));
    if (!ids.length) throw new BadRequestException('请选择需要导出的订单');

    const orders = await this.orderRepo.find({
      where: currentUser.role === 'ADMIN' ? ({ id: In(ids) } as any) : ({ id: In(ids), buyerUserId: currentUser.sub } as any),
      relations: { lines: true },
      order: { createdAt: 'DESC' },
    });
    if (currentUser.role !== 'ADMIN' && orders.length !== ids.length) {
      throw new ForbiddenException('包含无权导出的订单');
    }

    const rows: BillRow[] = [];
    for (const o of orders) {
      const itemsCount = Array.isArray(o.lines) ? o.lines.reduce((sum, l) => sum + Math.max(0, Number(l.qty) || 0), 0) : 0;
      const statusText =
        (o.lingxingStatusText ?? '').trim() ||
        lingxingOrderStatusText(o.lingxingStatus ?? null) ||
        (o.status as unknown as string);
      const createdAtText = o.createdAt ? o.createdAt.toISOString().slice(0, 19).replace('T', ' ') : '';

      const lines = Array.isArray(o.lines) && o.lines.length ? o.lines : [null];
      for (const l of lines) {
        const qty = l ? Number(l.qty) || 0 : 0;
        const unitPrice = l ? String(l.unitPriceSnapshot ?? '') : '';
        const lineTotalNum = l ? (Number(l.unitPriceSnapshot) || 0) * qty : 0;
        rows.push({
          orderId: o.id,
          orderNo: o.orderNo,
          createdAtText,
          buyerEmail: o.snapshotBuyerEmail,
          statusText,
          currency: o.currencySnapshot,
          orderTotal: String(o.totalAmount),
          itemsCount,
          sku: l?.sku ?? '',
          title: l?.titleSnapshot ?? '',
          qty,
          unitPrice,
          lineTotal: l ? lineTotalNum.toFixed(2) : '',
        });
      }
    }

    return rows;
  }

  async setLingxingStatusTextByAdmin(currentUser: JwtUser, orderNo: string, statusText: string | null) {
    if (currentUser.role !== 'ADMIN') throw new ForbiddenException('无权操作');
    const order = await this.orderRepo.findOne({ where: { orderNo } });
    if (!order) throw new NotFoundException('订单不存在');
    order.lingxingStatusText = statusText ? String(statusText).trim() : null;
    order.lingxingStatus = null;
    order.lingxingCheckedAt = new Date();
    await this.orderRepo.save(order);
    return order;
  }
}
