import { CanActivate, ExecutionContext, HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { RedisService } from '../infra/redis.service';
import { rateLimitBucketKey, rateLimitPolicy, shouldRejectRequest } from './rate-limit.rules';

@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(private redis: RedisService) {}
  async canActivate(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest();
    const path = String(req.originalUrl || req.path || '');
    const ip = String(req.ip || req.socket?.remoteAddress || 'unknown').replace(/[^a-zA-Z0-9:._-]/g, '_');
    const policy = rateLimitPolicy(path);
    const key = rateLimitBucketKey(ip, policy.category, policy.windowSeconds);
    let count: number;
    try {
      count = await this.redis.client.incr(key);
      if (count === 1) await this.redis.client.expire(key, policy.windowSeconds + 1);
    } catch {
      if (process.env.NODE_ENV === 'production') throw new HttpException('Request protection is temporarily unavailable', HttpStatus.TOO_MANY_REQUESTS);
      return true;
    }
    if (shouldRejectRequest(count, policy.limit)) throw new HttpException('Request limit reached. Try again later.', HttpStatus.TOO_MANY_REQUESTS);
    return true;
  }
}
