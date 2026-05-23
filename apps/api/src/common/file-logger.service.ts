import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { appendFileSync, existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'fs';
import { resolve } from 'path';

@Injectable()
export class FileLoggerService implements OnModuleInit {
  private readonly console = new Logger(FileLoggerService.name);
  private readonly logDir: string;
  private readonly maxDays: number;

  constructor(private readonly config: ConfigService) {
    this.logDir = resolve(
      config.get<string>('LOG_DIR', './logs') || './logs',
    );
    this.maxDays = Math.max(1, Number(config.get('LOG_RETENTION_DAYS', 30)) || 30);
  }

  onModuleInit() {
    if (!existsSync(this.logDir)) {
      mkdirSync(this.logDir, { recursive: true });
    }
    this.cleanOldLogs();
  }

  private todayFile(): string {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return resolve(this.logDir, `sync-${y}-${m}-${day}.log`);
  }

  private formatLine(level: string, message: string): string {
    const now = new Date().toISOString();
    return `[${now}] [${level}] ${message}\n`;
  }

  private write(level: string, message: string) {
    const line = this.formatLine(level, message);
    try {
      appendFileSync(this.todayFile(), line, 'utf8');
    } catch (err) {
      this.console.error(`写日志文件失败: ${(err as Error).message}`);
    }
  }

  info(message: string) {
    this.console.log(message);
    this.write('INFO', message);
  }

  warn(message: string) {
    this.console.warn(message);
    this.write('WARN', message);
  }

  error(message: string) {
    this.console.error(message);
    this.write('ERROR', message);
  }

  syncStart(type: string) {
    const msg = `========== 开始同步: ${type} ==========`;
    this.console.log(msg);
    this.write('INFO', msg);
  }

  syncEnd(type: string, status: string, success: number, errors: number, durationMs: number) {
    const msg = `========== 同步完成: ${type} | 状态=${status} | 成功=${success} | 失败=${errors} | 耗时=${(durationMs / 1000).toFixed(1)}s ==========`;
    if (status === 'FAILED') this.error(msg);
    else this.info(msg);
  }

  /** 清理超过 maxDays 天的旧日志 */
  cleanOldLogs() {
    try {
      if (!existsSync(this.logDir)) return;
      const now = Date.now();
      const cutoff = now - this.maxDays * 24 * 60 * 60 * 1000;
      const files = readdirSync(this.logDir);
      let removed = 0;
      for (const f of files) {
        if (!f.endsWith('.log')) continue;
        const full = resolve(this.logDir, f);
        try {
          const s = statSync(full);
          if (s.mtimeMs < cutoff) {
            unlinkSync(full);
            removed++;
          }
        } catch {
          // 跳过无法读取的文件
        }
      }
      if (removed > 0) {
        this.console.log(`清理了 ${removed} 个旧日志文件（超过 ${this.maxDays} 天）`);
      }
    } catch (err) {
      this.console.warn(`日志清理失败: ${(err as Error).message}`);
    }
  }
}
