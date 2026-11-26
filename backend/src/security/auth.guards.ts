import { CanActivate, ExecutionContext, Injectable, UnauthorizedException, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { RedisService } from '../infra/redis.service';
import { IS_PUBLIC } from './public.decorator';
import { ROLES_KEY } from './roles.decorator';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private reflector: Reflector, private jwt: JwtService, private redis: RedisService) {}
  async canActivate(context: ExecutionContext) {
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [context.getHandler(), context.getClass()])) return true;
    const request = context.switchToHttp().getRequest();
    const bearer = String(request.headers.authorization || '').replace(/^Bearer\s+/i, '');
    const token = request.cookies?.access_token || bearer;
    if (!token) throw new UnauthorizedException('Login required');
    try {
      const payload = await this.jwt.verifyAsync(token, { secret: process.env.JWT_ACCESS_SECRET });
      if (!payload.sid || !(await this.redis.client.exists('session:' + payload.sid))) throw new Error('session revoked');
      request.user = payload;
      return true;
    } catch {
      throw new UnauthorizedException('Session expired or invalid');
    }
  }
}

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}
  canActivate(context: ExecutionContext) {
    const roles = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [context.getHandler(), context.getClass()]);
    if (!roles?.length) return true;
    const user = context.switchToHttp().getRequest().user;
    if (!user || !roles.includes(user.role)) throw new ForbiddenException('This role cannot perform the requested action');
    return true;
  }
}
