import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LingxingHttpService } from '../lingxing/lingxing-http.service';
import { LingxingApiError, LingxingNotConfiguredError } from '../lingxing/lingxing.types';
import { SyncService } from '../sync/sync.service';
import { SyncRun } from '../sync/sync-run.entity';
import { WarehousesService, type LingxingWarehouseRow } from './warehouses.service';

type LingxingWarehouseApiRow = Record<string, unknown> & {
  wid?: unknown;
  type?: unknown;
  name?: unknown;
  is_delete?: unknown;
  t_country_area_name?: unknown;
  t_status?: unknown;
  t_warehouse_code?: unknown;
  t_warehouse_name?: unknown;
  country_code?: unknown;
  wp_id?: unknown;
  wp_name?: unknown;
};

function toInt(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return Math.trunc(v);
  if (typeof v === 'string' && v.trim() && Number.isFinite(Number(v))) return Math.trunc(Number(v));
  return null;
}

function toText(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string') {
    const s = v.trim();
    return s ? s : null;
  }
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return null;
}

@Injectable()
export class WarehousesSyncService {
  private readonly logger = new Logger(WarehousesSyncService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly http: LingxingHttpService,
    private readonly warehouses: WarehousesService,
    private readonly sync: SyncService,
  ) {}

  async triggerRun(triggeredBy?: string | null): Promise<SyncRun> {
    this.validateConfig();
    const run = await this.sync.start('LINGXING_WAREHOUSE', triggeredBy);
    this.executeRun(run).catch((err) => this.logger.error(`后台同步异常: ${err.message}`));
    return run;
  }

  async run(triggeredBy?: string | null): Promise<SyncRun> {
    this.validateConfig();
    const run = await this.sync.start('LINGXING_WAREHOUSE', triggeredBy);
    await this.executeRun(run);
    return run;
  }

  private async executeRun(run: SyncRun): Promise<void> {
    const syncedAt = new Date();
    let success = 0;
    try {
      const res = await this.http.request<LingxingWarehouseApiRow[]>({
        method: 'POST',
        path: '/erp/sc/data/local_inventory/warehouse',
        body: {
          type: 3,
          is_delete: 0,
          offset: 0,
          length: 1000,
        },
      });

      const list = Array.isArray(res.data) ? res.data : [];
      const rows: LingxingWarehouseRow[] = [];
      for (const raw of list) {
        const wid = toInt(raw.wid);
        if (wid === null) continue;
        const type = toInt(raw.type) ?? 0;
        if (type !== 3) continue;
        const name = toText(raw.name) ?? '';
        if (!name) continue;
        const isDelete = toInt(raw.is_delete) ?? 0;
        if (isDelete !== 0) continue;
        rows.push({
          wid,
          type,
          name,
          isDelete,
          tCountryAreaName: toText(raw.t_country_area_name),
          tStatus: toInt(raw.t_status),
          tWarehouseCode: toText(raw.t_warehouse_code),
          tWarehouseName: toText(raw.t_warehouse_name),
          countryCode: toText(raw.country_code),
          wpId: toInt(raw.wp_id),
          wpName: toText(raw.wp_name),
          rawPayload: raw as unknown as Record<string, unknown>,
        });
      }

      success = await this.warehouses.upsertMany(rows, syncedAt);
      await this.sync.updateProgress(run, {
        processedCount: list.length,
        totalCount: list.length,
        successCount: success,
        errorCount: 0,
        detailSummary: rows.slice(0, 5).map((x) => x.name).join(', ') || undefined,
      });
      await this.sync.finish(run, { status: 'SUCCESS', successCount: success });
    } catch (err) {
      const msg =
        err instanceof LingxingNotConfiguredError || err instanceof LingxingApiError
          ? err.message
          : (err as Error).message;
      await this.sync.finish(run, { status: 'FAILED', successCount: success, errorMessage: msg });
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
}
