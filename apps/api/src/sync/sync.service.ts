import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SyncRun, SyncStatus, SyncType } from './sync-run.entity';
import { Logger } from '@nestjs/common';

@Injectable()
export class SyncService {
  private readonly logger = new Logger(SyncService.name);
  constructor(@InjectRepository(SyncRun) private readonly repo: Repository<SyncRun>) {}

  async start(type: SyncType, triggeredBy?: string | null): Promise<SyncRun> {
    const run = this.repo.create({
      type,
      status: 'RUNNING' as SyncStatus,
      startedAt: new Date(),
      successCount: 0,
      errorCount: 0,
      processedCount: 0,
      totalCount: 0,
      triggeredBy: triggeredBy ?? null,
    });
    return this.repo.save(run);
  }

  /** 同步中更新进度（前端轮询获取实时进度） */
  async updateProgress(
    run: SyncRun,
    args: {
      processedCount?: number;
      totalCount?: number;
      successCount?: number;
      errorCount?: number;
      detailSummary?: string | null;
    },
  ): Promise<SyncRun> {
    if (args.processedCount !== undefined) run.processedCount = args.processedCount;
    if (args.totalCount !== undefined) run.totalCount = args.totalCount;
    if (args.successCount !== undefined) run.successCount = args.successCount;
    if (args.errorCount !== undefined) run.errorCount = args.errorCount;
    if (args.detailSummary !== undefined) run.detailSummary = args.detailSummary;
    return this.repo.save(run);
  }

  async finish(
    run: SyncRun,
    args: { status: SyncStatus; successCount?: number; errorCount?: number; errorMessage?: string | null },
  ): Promise<SyncRun> {
    run.status = args.status;
    run.finishedAt = new Date();
    run.successCount = args.successCount ?? run.successCount;
    run.errorCount = args.errorCount ?? run.errorCount;
    run.errorMessage = args.errorMessage ?? null;
    /** 不要将 processedCount 收成 success+error：那会覆盖分页累计的「已从源读取条数」，进度条会失真 */
    if (run.totalCount <= 0 && run.processedCount > 0) {
      run.totalCount = run.processedCount;
    }
    return this.repo.save(run);
  }

  list(args: { type?: SyncType; limit?: number }) {
    const qb = this.repo.createQueryBuilder('s').orderBy('s.createdAt', 'DESC');
    if (args.type) qb.andWhere('s.type = :t', { t: args.type });
    return qb.take(args.limit ?? 50).getMany();
  }

  getById(id: string): Promise<SyncRun | null> {
    const key = String(id ?? '').trim();
    if (!key) return Promise.resolve(null);
    return this.repo.findOne({ where: { id: key } });
  }

  lastSuccessAt(type: SyncType): Promise<Date | null> {
    return this.repo
      .findOne({
        where: { type, status: 'SUCCESS' as SyncStatus },
        order: { finishedAt: 'DESC' },
      })
      .then((row) => row?.finishedAt ?? null);
  }
}
