import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtAuthGuard, RolesGuard } from '../security/auth.guards';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [JwtModule.register({ secret: process.env.JWT_ACCESS_SECRET || 'development-only-secret-change-this-32-bytes', signOptions: { expiresIn: '15m' } }), NotificationsModule],
  controllers: [AuthController],
  providers: [AuthService, JwtAuthGuard, RolesGuard],
  exports: [JwtModule, JwtAuthGuard, RolesGuard],
})
export class AuthModule {}
