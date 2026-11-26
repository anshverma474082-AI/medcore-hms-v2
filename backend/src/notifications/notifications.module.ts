import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { JwtModule } from '@nestjs/jwt';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { DeliveryService } from './delivery.service';
import { OutboundProcessor } from './outbound.processor';
import { NotificationGateway } from './notification.gateway';

const redisUrl = new URL(process.env.REDIS_URL || 'redis://127.0.0.1:6379');

@Module({
  imports: [
    JwtModule.register({ secret: process.env.JWT_ACCESS_SECRET || 'development-only-secret-change-this-32-bytes', signOptions: { expiresIn: '15m' } }),
    BullModule.forRoot({ connection: { host: redisUrl.hostname, port: Number(redisUrl.port || 6379), password: redisUrl.password || undefined, maxRetriesPerRequest: null } }),
    BullModule.registerQueue({ name: 'outbound' }),
  ],
  controllers: [NotificationsController],
  providers: [NotificationsService, DeliveryService, OutboundProcessor, NotificationGateway],
  exports: [NotificationsService, DeliveryService, JwtModule],
})
export class NotificationsModule {}
