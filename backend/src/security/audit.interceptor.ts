import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable, tap } from 'rxjs';
import { PrismaService } from '../infra/prisma.service';

@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(private prisma: PrismaService) {}
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest();
    const user = req.user;
    const writes = ['POST', 'PATCH', 'DELETE'];
    if (user && writes.includes(req.method) && !req.path?.startsWith('/auth/')) {
      return next.handle().pipe(tap(() => {
        void this.prisma.auditLog.create({ data: {
          hospitalId: user.hospitalId ?? undefined,
          userId: user.id,
          action: req.method,
          entity: String(req.route?.path || req.path || '').slice(0, 200),
          ip: String(req.ip || '').slice(0, 64),
        } }).catch(() => undefined);
      }));
    }
    return next.handle();
  }
}
