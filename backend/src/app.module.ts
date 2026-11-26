import { Module } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { PrismaModule } from './infra/prisma.module';
import { RedisModule } from './infra/redis.module';
import { AuthModule } from './auth/auth.module';
import { HealthController } from './health.controller';
import { HospitalsModule } from './hospitals/hospitals.module';
import { UsersModule } from './users/users.module';
import { AppointmentsModule } from './appointments/appointments.module';
import { ClinicalModule } from './clinical/clinical.module';
import { OperationsModule } from './operations/operations.module';
import { BillingModule } from './billing/billing.module';
import { NotificationsModule } from './notifications/notifications.module';
import { RateLimitGuard } from './security/rate-limit.guard';
import { JwtAuthGuard, RolesGuard } from './security/auth.guards';
import { AuditInterceptor } from './security/audit.interceptor';
import { CsrfGuard } from './security/csrf.guard';

@Module({
  imports: [PrismaModule, RedisModule, AuthModule, HospitalsModule, UsersModule, AppointmentsModule, ClinicalModule, OperationsModule, BillingModule, NotificationsModule],
  controllers: [HealthController],
  providers: [
    { provide: APP_GUARD, useClass: RateLimitGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_GUARD, useClass: CsrfGuard },
    { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
  ],
})
export class AppModule {}
