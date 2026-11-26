jest.mock('@nestjs/common', () => {
  class UnauthorizedException extends Error {}
  class ForbiddenException extends Error {}
  class HttpException extends Error { constructor(message: string, public status: number) { super(message); } }
  return { UnauthorizedException, ForbiddenException, HttpException, HttpStatus: { TOO_MANY_REQUESTS: 429 }, Injectable: () => (target: unknown) => target };
});
jest.mock('@nestjs/core', () => ({ Reflector: class Reflector {} }));
jest.mock('@nestjs/jwt', () => ({ JwtService: class JwtService {} }));
jest.mock('../infra/redis.service', () => ({ RedisService: class RedisService {} }));
jest.mock('../infra/prisma.service', () => ({ PrismaService: class PrismaService {} }));
import { ForbiddenException, HttpException, UnauthorizedException } from '@nestjs/common';
import { firstValueFrom, of } from 'rxjs';
import { AuditInterceptor } from './audit.interceptor';
import { JwtAuthGuard, RolesGuard } from './auth.guards';
import { CsrfGuard } from './csrf.guard';
import { RateLimitGuard } from './rate-limit.guard';

function context(request: Record<string, any>, metadata: Record<string, unknown> = {}) {
  const handler = jest.fn();
  const target = class Controller {};
  return { handler, target, getHandler: () => handler, getClass: () => target, switchToHttp: () => ({ getRequest: () => request }), metadata } as never;
}

describe('request security guards and audit interceptor', () => {
  it('allows public routes, authenticates bearer or cookie tokens, and rejects missing or revoked sessions', async () => {
    const reflector = { getAllAndOverride: jest.fn().mockReturnValueOnce(true).mockReturnValue(false) };
    const jwt = { verifyAsync: jest.fn(async () => ({ sid: 's1', id: 8, role: 'PATIENT' })) };
    const redis = { client: { exists: jest.fn(async () => 1) } };
    const guard = new JwtAuthGuard(reflector as never, jwt as never, redis as never);
    expect(await guard.canActivate(context({ headers: {} }))).toBe(true);
    const req: Record<string, any> = { headers: { authorization: 'Bearer token' }, cookies: {} };
    expect(await guard.canActivate(context(req))).toBe(true);
    expect(req.user).toMatchObject({ id: 8, sid: 's1' });
    await expect(guard.canActivate(context({ headers: {}, cookies: {} }))).rejects.toThrow(UnauthorizedException);
    redis.client.exists.mockResolvedValueOnce(0);
    await expect(guard.canActivate(context({ headers: { authorization: 'Bearer expired' } }))).rejects.toThrow('Session expired');
  });

  it('checks role metadata and permits routes without an explicit role restriction', () => {
    const reflector = { getAllAndOverride: jest.fn().mockReturnValueOnce(undefined).mockReturnValueOnce(['DOCTOR']).mockReturnValue(['PATIENT']) };
    const guard = new RolesGuard(reflector as never);
    expect(guard.canActivate(context({}))).toBe(true);
    expect(guard.canActivate(context({ user: { role: 'DOCTOR' } }))).toBe(true);
    expect(() => guard.canActivate(context({ user: { role: 'DOCTOR' } }))).toThrow(ForbiddenException);
  });

  it('enforces CSRF on state-changing requests and exempts safe reads and signed webhooks', () => {
    const guard = new CsrfGuard();
    expect(guard.canActivate(context({ method: 'GET', path: '/patients', cookies: {}, headers: {} }))).toBe(true);
    expect(guard.canActivate(context({ method: 'POST', path: '/billing/payments/webhook', cookies: {}, headers: {} }))).toBe(true);
    expect(guard.canActivate(context({ method: 'PATCH', path: '/profile', cookies: { csrf_token: 'same' }, headers: { 'x-csrf-token': 'same' } }))).toBe(true);
    expect(() => guard.canActivate(context({ method: 'POST', path: '/profile', cookies: { csrf_token: 'expected' }, headers: { 'x-csrf-token': 'different' } }))).toThrow(ForbiddenException);
  });

  it('applies Redis rate limits and fails closed for production Redis errors', async () => {
    const redis = { client: { incr: jest.fn(async () => 1), expire: jest.fn(async () => 1) } };
    const guard = new RateLimitGuard(redis as never);
    const req = { originalUrl: '/auth/login', ip: '127.0.0.1' };
    expect(await guard.canActivate(context(req))).toBe(true);
    expect(redis.client.expire).toHaveBeenCalled();
    redis.client.incr.mockResolvedValueOnce(101);
    await expect(guard.canActivate(context(req))).rejects.toThrow(HttpException);
    redis.client.incr.mockRejectedValueOnce(new Error('Redis unavailable'));
    process.env.NODE_ENV = 'production';
    await expect(guard.canActivate(context(req))).rejects.toThrow(HttpException);
    process.env.NODE_ENV = 'test';
    redis.client.incr.mockRejectedValueOnce(new Error('Redis unavailable'));
    await expect(guard.canActivate(context(req))).resolves.toBe(true);
  });

  it('audits successful state changes and skips reads and auth paths', async () => {
    const prisma = { auditLog: { create: jest.fn(async () => undefined) } };
    const interceptor = new AuditInterceptor(prisma as never);
    const request = { user: { id: 8, hospitalId: 7 }, method: 'PATCH', path: '/patients/me/profile', route: { path: '/patients/me/profile' }, ip: '127.0.0.1' };
    await firstValueFrom(interceptor.intercept(context(request), { handle: () => of('saved') } as never));
    await new Promise((resolve) => setImmediate(resolve));
    expect(prisma.auditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ userId: 8, hospitalId: 7, action: 'PATCH', entity: '/patients/me/profile' }) });
    prisma.auditLog.create.mockClear();
    await firstValueFrom(interceptor.intercept(context({ ...request, method: 'POST', path: '/auth/login' }), { handle: () => of('ok') } as never));
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
    await firstValueFrom(interceptor.intercept(context({ ...request, method: 'GET' }), { handle: () => of('ok') } as never));
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
  });
});
