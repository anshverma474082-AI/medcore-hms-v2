import { BadRequestException, Body, Controller, Get, Header, Param, ParseIntPipe, Post, Query, Res, StreamableFile, UploadedFile, UseInterceptors } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { Response } from 'express';
import { CurrentUser, SessionUser } from '../security/current-user.decorator';
import { Roles } from '../security/roles.decorator';
import { ClinicalService } from './clinical.service';
import { MedicalRecordDto, PrescriptionDto } from './clinical.dto';
import { FileInterceptor } from '@nestjs/platform-express';
import { MAX_CLINICAL_ATTACHMENT_BYTES } from './attachment-rules';
import { PageQueryDto } from '../common/pagination.dto';

@ApiTags('clinical')
@Controller()
export class ClinicalController {
  constructor(private service: ClinicalService) {}
  @Post('appointments/:id/records') @Roles(Role.DOCTOR)
  async createRecord(@Param('id', ParseIntPipe) id: number, @Body() dto: MedicalRecordDto, @CurrentUser() user: SessionUser) { return { success: true, data: await this.service.createRecord(id, dto, user), message: 'Medical record saved' }; }
  @Get('records') @Roles(Role.DOCTOR, Role.PATIENT, Role.HOSPITAL_ADMIN, Role.NURSE)
  async records(@CurrentUser() user: SessionUser) { return { success: true, data: await this.service.records(user), message: 'OK' }; }
  @Get('records/page') @Roles(Role.DOCTOR, Role.PATIENT, Role.HOSPITAL_ADMIN, Role.NURSE)
  async recordsPage(@Query() query: PageQueryDto, @CurrentUser() user: SessionUser) { return { success: true, data: await this.service.recordsPage(query, user), message: 'OK' }; }
  @Get('records/:id') @Roles(Role.DOCTOR, Role.PATIENT, Role.HOSPITAL_ADMIN, Role.NURSE)
  async record(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: SessionUser) { return { success: true, data: await this.service.record(id, user), message: 'OK' }; }
  @Post('records/:id/attachments') @Roles(Role.DOCTOR)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_CLINICAL_ATTACHMENT_BYTES } }))
  async addAttachment(@Param('id', ParseIntPipe) id: number, @UploadedFile() file: { originalname: string; mimetype: string; size: number; buffer: Buffer } | undefined, @CurrentUser() user: SessionUser) { return { success: true, data: await this.service.addAttachment(id, file, user), message: 'Encrypted attachment saved' }; }
  @Get('records/:id/attachments') @Roles(Role.DOCTOR, Role.PATIENT, Role.HOSPITAL_ADMIN, Role.NURSE)
  async attachments(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: SessionUser) { return { success: true, data: await this.service.attachments(id, user), message: 'OK' }; }
  @Get('attachments/:id') @Roles(Role.DOCTOR, Role.PATIENT, Role.HOSPITAL_ADMIN, Role.NURSE)
  async attachment(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: SessionUser, @Res({ passthrough: true }) res: Response) {
    const file = await this.service.attachment(id, user);
    if (!/^(application\/pdf|image\/(png|jpeg))$/.test(file.mimeType)) throw new BadRequestException('Unsupported attachment type');
    res.setHeader('Content-Type', file.mimeType); res.setHeader('Content-Disposition', 'attachment; filename="' + file.name.replace(/["\\\r\n]/g, '_') + '"'); res.setHeader('X-Content-Type-Options', 'nosniff');
    return new StreamableFile(file.bytes);
  }
  @Post('appointments/:id/prescriptions') @Roles(Role.DOCTOR)
  async createPrescription(@Param('id', ParseIntPipe) id: number, @Body() dto: PrescriptionDto, @CurrentUser() user: SessionUser) { return { success: true, data: await this.service.createPrescription(id, dto, user), message: 'Prescription saved' }; }
  @Get('prescriptions') @Roles(Role.DOCTOR, Role.PATIENT, Role.HOSPITAL_ADMIN, Role.PHARMACIST)
  async prescriptions(@CurrentUser() user: SessionUser) { return { success: true, data: await this.service.prescriptions(user), message: 'OK' }; }
  @Get('prescriptions/page') @Roles(Role.DOCTOR, Role.PATIENT, Role.HOSPITAL_ADMIN, Role.PHARMACIST)
  async prescriptionsPage(@Query() query: PageQueryDto, @CurrentUser() user: SessionUser) { return { success: true, data: await this.service.prescriptionsPage(query, user), message: 'OK' }; }
  @Get('prescriptions/:id/pdf') @Header('Content-Type', 'application/pdf') @Roles(Role.DOCTOR, Role.PATIENT, Role.HOSPITAL_ADMIN, Role.PHARMACIST)
  async pdf(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: SessionUser, @Res({ passthrough: true }) res: Response) {
    const data = await this.service.prescriptionPdf(id, user); res.setHeader('Content-Disposition', 'attachment; filename="medcore-prescription-' + id + '.pdf"');
    return new StreamableFile(data);
  }
  @Get('prescriptions/:id') @Roles(Role.DOCTOR, Role.PATIENT, Role.HOSPITAL_ADMIN, Role.PHARMACIST)
  async prescription(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: SessionUser) { return { success: true, data: await this.service.prescription(id, user), message: 'OK' }; }
}
