import { Body, Controller, Get, Param, ParseIntPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { CurrentUser, SessionUser } from '../security/current-user.decorator';
import { Roles } from '../security/roles.decorator';
import { UsersService } from './users.service';
import { CreateStaffDto, UpdatePatientProfileDto } from './users.dto';

@ApiTags('users')
@Controller()
export class UsersController {
  constructor(private service: UsersService) {}
  @Post('users') @Roles(Role.HOSPITAL_ADMIN)
  async create(@Body() dto: CreateStaffDto, @CurrentUser() user: SessionUser) { return { success: true, data: await this.service.create(dto, user), message: 'Staff account created' }; }
  @Get('users') @Roles(Role.HOSPITAL_ADMIN, Role.SUPER_ADMIN)
  async list(@CurrentUser() user: SessionUser) { return { success: true, data: await this.service.list(user), message: 'OK' }; }
  @Get('doctors')
  async doctors(@CurrentUser() user: SessionUser, @Query('specialisation') specialization?: string) { return { success: true, data: await this.service.doctors(user, specialization), message: 'OK' }; }
  @Get('doctors/me') @Roles(Role.DOCTOR)
  async me(@CurrentUser() user: SessionUser) { return { success: true, data: await this.service.myDoctor(user), message: 'OK' }; }
  @Get('patients/me/profile') @Roles(Role.PATIENT)
  async patientProfile(@CurrentUser() user: SessionUser) { return { success: true, data: await this.service.patientProfile(user), message: 'OK' }; }
  @Patch('patients/me/profile') @Roles(Role.PATIENT)
  async updatePatientProfile(@Body() dto: UpdatePatientProfileDto, @CurrentUser() user: SessionUser) { return { success: true, data: await this.service.updatePatientProfile(dto, user), message: 'Profile updated' }; }
  @Get('users/:id') @Roles(Role.HOSPITAL_ADMIN, Role.SUPER_ADMIN)
  async get(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: SessionUser) { return { success: true, data: await this.service.get(id, user), message: 'OK' }; }
}
