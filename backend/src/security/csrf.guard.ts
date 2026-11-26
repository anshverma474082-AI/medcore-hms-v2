import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';

@Injectable()
export class CsrfGuard implements CanActivate {
  canActivate(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest();
    if (!['POST', 'PATCH', 'DELETE', 'PUT'].includes(req.method)) return true;
    if (req.path === '/billing/payments/webhook') return true; // Razorpay signature is verified by the webhook controller.
    const cookie = String(req.cookies?.csrf_token || '');
    const header = String(req.headers['x-csrf-token'] || '');
    const a = Buffer.from(cookie); const b = Buffer.from(header);
    if (!cookie || a.length !== b.length || !timingSafeEqual(a, b)) throw new ForbiddenException('A valid CSRF token is required');
    return true;
  }
}
