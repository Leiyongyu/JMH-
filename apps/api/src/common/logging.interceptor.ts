import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { Observable, tap, catchError, throwError } from 'rxjs';

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<Request>();
    const { method, url } = req;
    const now = Date.now();

    return next.handle().pipe(
      tap(() => {
        const res = context.switchToHttp().getResponse();
        const status = res.statusCode;
        const duration = Date.now() - now;
        if (status >= 500) {
          this.logger.error(`${method} ${url} → ${status} (${duration}ms)`);
        } else if (status >= 400) {
          this.logger.warn(`${method} ${url} → ${status} (${duration}ms)`);
        } else {
          this.logger.log(`${method} ${url} → ${status} (${duration}ms)`);
        }
      }),
      catchError((err) => {
        const duration = Date.now() - now;
        const status = err?.status ?? err?.response?.statusCode ?? 500;
        const msg = err?.message ?? 'Unknown error';
        this.logger.error(`${method} ${url} → ${status} (${duration}ms): ${msg}`);
        return throwError(() => err);
      }),
    );
  }
}
