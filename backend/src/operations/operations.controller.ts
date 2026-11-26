import { Body, Controller, Get, Param, ParseIntPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { CurrentUser, SessionUser } from '../security/current-user.decorator';
import { Roles } from '../security/roles.decorator';
import { OperationsService } from './operations.service';
import { BatchDto, DispenseDto, LabOrderDto, LabResultDto, MedicineDto } from './operations.dto';
import { PageQueryDto } from '../common/pagination.dto';

@ApiTags('laboratory and pharmacy')
@Controller()
export class OperationsController {
  constructor(private service: OperationsService) {}
  @Post('appointments/:id/lab-orders') @Roles(Role.DOCTOR)
  async createLab(@Param('id', ParseIntPipe) id: number, @Body() dto: LabOrderDto, @CurrentUser() user: SessionUser) { return { success: true, data: await this.service.createLab(id, dto, user), message: 'Test ordered' }; }
  @Get('lab-orders') @Roles(Role.PATIENT, Role.DOCTOR, Role.HOSPITAL_ADMIN, Role.LAB_TECHNICIAN)
  async labs(@CurrentUser() user: SessionUser) { return { success: true, data: await this.service.labs(user), message: 'OK' }; }
  @Get('lab-orders/page') @Roles(Role.PATIENT, Role.DOCTOR, Role.HOSPITAL_ADMIN, Role.LAB_TECHNICIAN)
  async labsPage(@Query() query: PageQueryDto, @CurrentUser() user: SessionUser) { return { success: true, data: await this.service.labsPage(query, user), message: 'OK' }; }
  @Patch('lab-orders/:id/result') @Roles(Role.LAB_TECHNICIAN)
  async result(@Param('id', ParseIntPipe) id: number, @Body() dto: LabResultDto, @CurrentUser() user: SessionUser) { return { success: true, data: await this.service.result(id, dto, user), message: 'Result uploaded' }; }
  @Patch('lab-orders/:id/approve') @Roles(Role.DOCTOR, Role.HOSPITAL_ADMIN)
  async approve(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: SessionUser) { return { success: true, data: await this.service.approveLab(id, user), message: 'Result approved' }; }
  @Post('medicines') @Roles(Role.HOSPITAL_ADMIN, Role.PHARMACIST)
  async medicine(@Body() dto: MedicineDto, @CurrentUser() user: SessionUser) { return { success: true, data: await this.service.createMedicine(dto, user), message: 'Medicine created' }; }
  @Get('medicines') @Roles(Role.HOSPITAL_ADMIN, Role.PHARMACIST, Role.DOCTOR)
  async medicines(@CurrentUser() user: SessionUser) { return { success: true, data: await this.service.medicines(user), message: 'OK' }; }
  @Get('medicines/page') @Roles(Role.HOSPITAL_ADMIN, Role.PHARMACIST, Role.DOCTOR)
  async medicinesPage(@Query() query: PageQueryDto, @CurrentUser() user: SessionUser) { return { success: true, data: await this.service.medicinesPage(query, user), message: 'OK' }; }
  @Post('medicines/:id/batches') @Roles(Role.HOSPITAL_ADMIN, Role.PHARMACIST)
  async batch(@Param('id', ParseIntPipe) id: number, @Body() dto: BatchDto, @CurrentUser() user: SessionUser) { return { success: true, data: await this.service.receiveBatch(id, dto, user), message: 'Batch received' }; }
  @Post('prescriptions/:id/dispense') @Roles(Role.PHARMACIST)
  async dispense(@Param('id', ParseIntPipe) id: number, @Body() dto: DispenseDto, @CurrentUser() user: SessionUser) { return { success: true, data: await this.service.dispense(id, dto, user), message: 'Prescription dispensed' }; }
}
