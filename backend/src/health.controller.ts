import { Controller, Get } from '@nestjs/common';
import { ApiExcludeEndpoint } from '@nestjs/swagger';
import { Public } from './security/public.decorator';
import { PrismaService } from './infra/prisma.service';
import { RedisService } from './infra/redis.service';

@Controller('health')
export class HealthController {
  constructor(private prisma: PrismaService, private redis: RedisService) {}
  @Public()
  @ApiExcludeEndpoint()
  @Get()
  async health() {
    await this.prisma.$queryRaw`SELECT 1`;
    await this.redis.client.ping();
    return { success: true, data: { status: 'ok' }, message: 'OK' };
  }
}
