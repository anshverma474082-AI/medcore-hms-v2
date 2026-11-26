import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { OperationsController } from './operations.controller';
import { OperationsService } from './operations.service';
@Module({ imports: [NotificationsModule], controllers: [OperationsController], providers: [OperationsService] })
export class OperationsModule {}
