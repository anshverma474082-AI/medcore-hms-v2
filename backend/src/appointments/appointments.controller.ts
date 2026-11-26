import { Body, Controller, Get, Param, ParseIntPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { CurrentUser, SessionUser } from '../security/current-user.decorator';
import { Roles } from '../security/roles.decorator';
import { AvailabilityDto, AppointmentListQueryDto, AppointmentStatusDto, BookAppointmentDto } from './appointments.dto';
import { AppointmentsService } from './appointments.service';

@ApiTags('appointments')
@Controller()
export class AppointmentsController {
  constructor(private service: AppointmentsService) {}
  @Post('doctors/:id/availability') @Roles(Role.DOCTOR, Role.HOSPITAL_ADMIN)
  async addAvailability(@Param('id', ParseIntPipe) id: number, @Body() dto: AvailabilityDto, @CurrentUser() user: SessionUser) { return { success: true, data: await this.service.addAvailability(id, dto, user), message: 'Availability saved' }; }
  @Get('doctors/:id/availability')
  async availability(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: SessionUser) { return { success: true, data: await this.service.availability(id, user), message: 'OK' }; }
  @Post('appointments') @Roles(Role.PATIENT, Role.HOSPITAL_ADMIN, Role.RECEPTIONIST)
  async book(@Body() dto: BookAppointmentDto, @CurrentUser() user: SessionUser) { return { success: true, data: await this.service.book(dto, user), message: 'Appointment requested' }; }
  @Get('appointments')
  async list(@CurrentUser() user: SessionUser) { return { success: true, data: await this.service.list(user), message: 'OK' }; }
  @Get('appointments/page')
  async listPage(@Query() query: AppointmentListQueryDto, @CurrentUser() user: SessionUser) { return { success: true, data: await this.service.listPage(query, user), message: 'OK' }; }
  @Get('appointments/:id')
  async get(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: SessionUser) { return { success: true, data: await this.service.get(id, user), message: 'OK' }; }
  @Patch('appointments/:id/cancel')
  async cancel(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: SessionUser) { return { success: true, data: await this.service.cancel(id, user), message: 'Appointment cancelled' }; }
  @Patch('appointments/:id/status') @Roles(Role.DOCTOR, Role.HOSPITAL_ADMIN, Role.RECEPTIONIST)
  async updateStatus(@Param('id', ParseIntPipe) id: number, @Body() dto: AppointmentStatusDto, @CurrentUser() user: SessionUser) { return { success: true, data: await this.service.updateStatus(id, dto.status, user), message: 'Status updated' }; }
}
