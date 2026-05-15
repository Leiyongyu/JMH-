import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { LingxingHttpService } from '../lingxing/lingxing-http.service';
import { LingxingMpOrderService } from '../lingxing/lingxing-mp-order.service';
import { LingxingApiError, LingxingNotConfiguredError } from '../lingxing/lingxing.types';
import { SyncRun } from '../sync/sync-run.entity';
import { SyncService } from '../sync/sync.service';
import { LingxingOrderLink } from './lingxing-order-link.entity';
import { lingxingOrderStatusText } from './lingxing-order-status.util';
import { DistributorOrder } from './order.entity';

function chunk<T>(arr: T[], size: number): T[][] {
  if (size <= 0) return [arr];
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function platformNeedsOrderNames(platformCode: number): boolean {
  return new Set([10003, 10014, 10020, 10002, 10012, 10016]).has(platformCode);
}

@Injectable()
export class LingxingOrderStatusSyncService {
  private readonly logger = new Logger(LingxingOrderStatusSyncService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly http: LingxingHttpService,
    private readonly mp: LingxingMpOrderService,
    private readonly sync: SyncService,
    @InjectRepository(LingxingOrderLink) private readonly linkRepo: Repository<LingxingOrderLink>,
    @InjectRepository(DistributorOrder) private readonly orderRepo: Repository<DistributorOrder>,
  ) {}

  async triggerRun(triggeredBy?: string | null): Promise<SyncRun> {
    this.validateConfig();
    const run = await this.sync.start('LINGXING_ORDER_STATUS', triggeredBy);
    this.executeRun(run).catch((err) => this.logger.error(`后台同步异常: ${err.message}`));
    return run;
  }

  async run(triggeredBy?: string | null): Promise<SyncRun> {
    this.validateConfig();
    const run = await this.sync.start('LINGXING_ORDER_STATUS', triggeredBy);
    await this.executeRun(run);
    return run;
  }

  private async executeRun(run: SyncRun): Promise<void> {
    const now = new Date();
    let processed = 0;
    let success = 0;
    let errors = 0;

    try {
      const links = await this.linkRepo.find({
        where: { pushStatus: 'SUCCESS' },
        order: { updatedAt: 'DESC' },
        take: 10000,
      });

      const total = links.length;
      await this.sync.updateProgress(run, { totalCount: total, processedCount: 0 });
      if (total === 0) {
        await this.sync.finish(run, { status: 'SUCCESS', successCount: 0, errorCount: 0 });
        return;
      }

      const groups = new Map<string, LingxingOrderLink[]>();
      for (const link of links) {
        const key = `${link.storeId}::${link.platformCode}`;
        const arr = groups.get(key) ?? [];
        arr.push(link);
        groups.set(key, arr);
      }

      for (const [key, group] of groups.entries()) {
        const [storeId, platformCodeRaw] = key.split('::');
        const platformCode = Number(platformCodeRaw);
        const useNames = platformNeedsOrderNames(platformCode);
        const linkByPlatformOrderNo = new Map<string, LingxingOrderLink>();
        for (const x of group) {
          if (x.platformOrderNo) linkByPlatformOrderNo.set(x.platformOrderNo, x);
        }
        const orderNos = Array.from(linkByPlatformOrderNo.keys());

        for (const batch of chunk(orderNos, 200)) {
          const body: any = {
            offset: 0,
            length: 500,
            store_id: [storeId],
            platform_code: [platformCode],
            include_delete: true,
          };
          if (useNames) body.platform_order_names = batch;
          else body.platform_order_nos = batch;

          const resp = await this.mp.listOrdersV2(body);
          const list = (resp.data?.list ?? []) as Array<Record<string, any>>;

          const hitByOrderNo = new Map<string, Record<string, any>>();
          for (const row of list) {
            const pi = Array.isArray(row.platform_info) ? row.platform_info : [];
            for (const p of pi) {
              const no = typeof p?.platform_order_no === 'string' ? p.platform_order_no : null;
              const name = typeof p?.platform_order_name === 'string' ? p.platform_order_name : null;
              if (no) hitByOrderNo.set(no, row);
              if (name) hitByOrderNo.set(name, row);
            }
          }

          const toSave: LingxingOrderLink[] = [];
          const orderUpdates: Array<{
            orderNo: string;
            status: number | null;
            statusText: string | null;
            checkedAt: Date;
            globalOrderNo: string | null;
          }> = [];
          for (const platformOrderNo of batch) {
            const link = linkByPlatformOrderNo.get(platformOrderNo);
            if (!link) continue;
            const hit = hitByOrderNo.get(platformOrderNo);
            if (!hit?.global_order_no) {
              errors += 1;
              processed += 1;
              continue;
            }

            link.globalOrderNo = String(hit.global_order_no);
            const s = Number(hit.status);
            link.lastLingxingStatus = Number.isFinite(s) ? Math.trunc(s) : null;
            link.lastCheckedAt = now;
            link.rawPayload = {
              ...hit,
              status_text: lingxingOrderStatusText(link.lastLingxingStatus),
              checked_at: now.toISOString(),
            } as Record<string, unknown>;
            toSave.push(link);
            orderUpdates.push({
              orderNo: link.orderNo,
              status: link.lastLingxingStatus ?? null,
              statusText: lingxingOrderStatusText(link.lastLingxingStatus),
              checkedAt: now,
              globalOrderNo: link.globalOrderNo ?? null,
            });
            success += 1;
            processed += 1;
          }

          if (toSave.length) await this.linkRepo.save(toSave);
          if (orderUpdates.length) await this.updateOrdersSnapshot(orderUpdates);
          await this.sync.updateProgress(run, {
            processedCount: processed,
            totalCount: total,
            successCount: success,
            errorCount: errors,
            detailSummary: batch.slice(0, 5).join(', ') || undefined,
          });
        }
      }

      await this.sync.finish(run, { status: 'SUCCESS', successCount: success, errorCount: errors });
    } catch (err) {
      const msg =
        err instanceof LingxingNotConfiguredError || err instanceof LingxingApiError
          ? err.message
          : (err as Error).message;
      await this.sync.finish(run, { status: 'FAILED', successCount: success, errorCount: errors, errorMessage: msg });
    }
  }

  private validateConfig(): void {
    const getCfg = (key: string): string => this.config.get<string>(key)?.trim() || process.env[key]?.trim() || '';
    const appId = getCfg('LINGXING_APP_ID');
    const appSecret = getCfg('LINGXING_APP_SECRET');
    if (!appId || !appSecret) {
      throw new ServiceUnavailableException('领星 API 未配置（LINGXING_APP_ID / LINGXING_APP_SECRET 为空）。');
    }
    if (!this.http.isConfigured()) {
      throw new ServiceUnavailableException('领星 API 未正确配置，无法同步。请检查 .env 中的 LINGXING_APP_ID 与 LINGXING_APP_SECRET。');
    }
  }

  private async updateOrdersSnapshot(
    rows: Array<{ orderNo: string; status: number | null; statusText: string | null; checkedAt: Date; globalOrderNo: string | null }>,
  ): Promise<void> {
    const orderNos = rows.map((r) => r.orderNo).filter(Boolean);
    if (!orderNos.length) return;

    const checkedAt = rows[0]!.checkedAt;
    const inSql = orderNos.map(() => '?').join(', ');
    const params: any[] = [];

    const caseStatus: string[] = ['CASE order_no'];
    for (const r of rows) {
      caseStatus.push('WHEN ? THEN ?');
      params.push(r.orderNo, r.status);
    }
    caseStatus.push('ELSE lingxing_status END');

    const caseText: string[] = ['CASE order_no'];
    for (const r of rows) {
      caseText.push('WHEN ? THEN ?');
      params.push(r.orderNo, r.statusText);
    }
    caseText.push('ELSE lingxing_status_text END');

    const caseGlobal: string[] = ['CASE order_no'];
    for (const r of rows) {
      caseGlobal.push('WHEN ? THEN ?');
      params.push(r.orderNo, r.globalOrderNo);
    }
    caseGlobal.push('ELSE lingxing_global_order_no END');

    params.push(checkedAt);
    params.push(...orderNos);

    await this.orderRepo.query(
      `
      UPDATE distributor_orders
      SET
        lingxing_status = ${caseStatus.join(' ')},
        lingxing_status_text = ${caseText.join(' ')},
        lingxing_global_order_no = ${caseGlobal.join(' ')},
        lingxing_checked_at = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE order_no IN (${inSql})
    `,
      params,
    );
  }
}
