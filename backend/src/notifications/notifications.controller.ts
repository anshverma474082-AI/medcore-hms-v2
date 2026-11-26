import { Controller, Get, NotFoundException, Param, ParseIntPipe, Patch, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Prisma } from '@prisma/client';
import { Role } from '@prisma/client';
import { PrismaService } from '../infra/prisma.service';
import { CurrentUser, SessionUser } from '../security/current-user.decorator';
import { Roles } from '../security/roles.decorator';
import { PageQueryDto } from '../common/pagination.dto';
import { pageResult, pageWindow } from '../common/pagination';

@ApiTags('notifications')
@Controller('notifications')
export class NotificationsController {
  constructor(private prisma: PrismaService) {}
  @Get('me')
  async list(@CurrentUser() user: SessionUser) {
    const rows = await this.prisma.notification.findMany({ where: { userId: user.id }, orderBy: { createdAt: 'desc' }, take: 100 });
    return { success: true, data: rows, message: 'OK' };
  }
  @Get('me/page')
  async listPage(@Query() query: PageQueryDto, @CurrentUser() user: SessionUser) {
    const where: Prisma.NotificationWhereInput = { userId: user.id };
    const search = query.q?.trim();
    if (search) {
      const numericId = /^\\d+$/.test(search) ? Number(search) : undefined;
      where.OR = [
        { title: { contains: search, mode: 'insensitive' } },
        { body: { contains: search, mode: 'insensitive' } },
        ...(numericId && Number.isSafeInteger(numericId) ? [{ id: numericId }] : []),
      ];
    }
    const total = await this.prisma.notification.count({ where });
    const window = pageWindow(query, total);
    const rows = await this.prisma.notification.findMany({ where, orderBy: { createdAt: 'desc' }, skip: window.skip, take: window.pageSize });
    return { success: true, data: pageResult(rows, total, window), message: 'OK' };
  }
  @Patch(':id/read')
  async read(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: SessionUser) {
    const changed = await this.prisma.notification.updateMany({ where: { id, userId: user.id, readAt: null }, data: { readAt: new Date() } });
    if (!changed.count) throw new NotFoundException('Notification not found');
    return { success: true, data: null, message: 'Marked as read' };
  }
  @Get('hospital')
  @Roles(Role.HOSPITAL_ADMIN)
  async hospitalFeed(@CurrentUser() user: SessionUser) {
    const rows = await this.prisma.notification.findMany({ where: { hospitalId: user.hospitalId! }, orderBy: { createdAt: 'desc' }, take: 100 });
    return { success: true, data: rows, message: 'OK' };
  }
  @Get('hospital/page')
  @Roles(Role.HOSPITAL_ADMIN)
  async hospitalFeedPage(@Query() query: PageQueryDto, @CurrentUser() user: SessionUser) {
    const where: Prisma.NotificationWhereInput = { hospitalId: user.hospitalId ?? -1 };
    const search = query.q?.trim();
    if (search) {
      const numericId = /^\\d+$/.test(search) ? Number(search) : undefined;
      where.OR = [
        { title: { contains: search, mode: 'insensitive' } },
        { body: { contains: search, mode: 'insensitive' } },
        ...(numericId && Number.isSafeInteger(numericId) ? [{ id: numericId }] : []),
      ];
    }
    const total = await this.prisma.notification.count({ where });
    const window = pageWindow(query, total);
    const rows = await this.prisma.notification.findMany({ where, orderBy: { createdAt: 'desc' }, skip: window.skip, take: window.pageSize });
    return { success: true, data: pageResult(rows, total, window), message: 'OK' };
  }
}
