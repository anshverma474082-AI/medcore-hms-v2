import { Body, Controller, Get, Param, ParseIntPipe, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { CurrentUser, SessionUser } from '../security/current-user.decorator';
import { Roles } from '../security/roles.decorator';
import { HospitalsService } from './hospitals.service';
import { CreateDepartmentDto, CreateHospitalDto } from './hospitals.dto';

@ApiTags('hospitals')
@Controller()
export class HospitalsController {
  constructor(private service: HospitalsService) {}
  @Post('hospitals') @Roles(Role.SUPER_ADMIN)
  async create(@Body() dto: CreateHospitalDto) { return { success: true, data: await this.service.create(dto), message: 'Hospital created' }; }
  @Post('hospitals/:id/verify') @Roles(Role.SUPER_ADMIN)
  async verify(@Param('id', ParseIntPipe) id: number) { return { success: true, data: await this.service.verify(id), message: 'Hospital verified' }; }
  @Get('hospitals') @Roles(Role.SUPER_ADMIN, Role.HOSPITAL_ADMIN)
  async list(@CurrentUser() user: SessionUser) { return { success: true, data: await this.service.list(user), message: 'OK' }; }
  @Post('departments') @Roles(Role.HOSPITAL_ADMIN)
  async department(@Body() dto: CreateDepartmentDto, @CurrentUser() user: SessionUser) { return { success: true, data: await this.service.createDepartment(user, dto), message: 'Department created' }; }
  @Get('hospitals/:id/departments')
  async departments(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: SessionUser) { return { success: true, data: await this.service.departments(user, id), message: 'OK' }; }
}
