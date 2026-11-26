import { BadRequestException, ForbiddenException, Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { AppointmentStatus, Role, Prisma } from '@prisma/client';
import PDFDocument from 'pdfkit';
import { PrismaService } from '../infra/prisma.service';
import { decryptClinicalBytes, decryptClinicalText, encryptClinicalBytes, encryptClinicalText, signClinicalArtifact } from '../security/data-protection';
import { SessionUser } from '../security/current-user.decorator';
import { PageQueryDto } from '../common/pagination.dto';
import { pageResult, pageWindow } from '../common/pagination';
import { MedicalRecordDto, PrescriptionDto } from './clinical.dto';
import { calculateBmi } from './vitals';
import { ClinicalUpload, validateClinicalUpload } from './attachment-rules';

@Injectable()
export class ClinicalService {
  constructor(private prisma: PrismaService) {}
  async createRecord(appointmentId: number, dto: MedicalRecordDto, actor: SessionUser) {
    const appointment = await this.prisma.appointment.findFirst({ where: { id: appointmentId, hospitalId: actor.hospitalId ?? -1, doctor: { userId: actor.id }, deletedAt: null } });
    if (!appointment) throw new NotFoundException('Appointment not found');
    if (!(new Set<AppointmentStatus>([AppointmentStatus.IN_PROGRESS, AppointmentStatus.COMPLETED])).has(appointment.status)) throw new ConflictException('Start the appointment before adding a medical record');
    try {
      const signedAt = new Date();
      const clinicalFields = {
        chiefComplaintEncrypted: encryptClinicalText(dto.chiefComplaint || ''), symptomsEncrypted: encryptClinicalText(dto.symptoms || ''),
        diagnosisEncrypted: encryptClinicalText(dto.diagnosis), treatmentPlanEncrypted: encryptClinicalText(dto.treatmentPlan || ''),
        allergiesEncrypted: encryptClinicalText(dto.allergies || ''), medicalHistoryEncrypted: encryptClinicalText(dto.medicalHistory || ''),
        familyHistoryEncrypted: encryptClinicalText(dto.familyHistory || ''), surgicalHistoryEncrypted: encryptClinicalText(dto.surgicalHistory || ''),
        vaccinationHistoryEncrypted: encryptClinicalText(dto.vaccinationHistory || ''),
      };
      const vitals = { bloodPressure: dto.bloodPressure || '', pulseBpm: dto.pulseBpm, temperatureC: dto.temperatureC, spo2Percent: dto.spo2Percent, weightKg: dto.weightKg, heightCm: dto.heightCm, bmi: calculateBmi(dto.weightKg, dto.heightCm) };
      const signatureDigest = signClinicalArtifact({ kind: 'medical-record', appointmentId, doctorUserId: actor.id, signedAt: signedAt.toISOString(), clinicalFields, vitals });
      const row = await this.prisma.medicalRecord.create({ data: {
        hospitalId: appointment.hospitalId, appointmentId, patientId: appointment.patientId, doctorId: appointment.doctorId,
        ...clinicalFields, ...vitals, signedAt, signatureDigest,
      } });
      return this.recordOut(row);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw new ConflictException('A record already exists for this appointment');
      throw error;
    }
  }
  async records(actor: SessionUser) {
    const where = this.recordListWhere(actor);
    const rows = await this.prisma.medicalRecord.findMany({ where, orderBy: { createdAt: 'desc' }, take: 100, include: { attachments: { select: { id: true, originalName: true, mimeType: true, sizeBytes: true, createdAt: true } } } });
    return rows.map((row) => this.recordOut(row));
  }
  async recordsPage(query: PageQueryDto, actor: SessionUser) {
    const where = this.recordListWhere(actor);
    const search = query.q?.trim();
    if (search) {
      const numericId = /^\d+$/.test(search) ? Number(search) : undefined;
      where.OR = [
        { patient: { user: { name: { contains: search, mode: 'insensitive' } } } },
        { doctor: { user: { name: { contains: search, mode: 'insensitive' } } } },
        ...(numericId && Number.isSafeInteger(numericId) ? [{ id: numericId }] : []),
      ];
    }
    const total = await this.prisma.medicalRecord.count({ where });
    const window = pageWindow(query, total);
    const rows = await this.prisma.medicalRecord.findMany({ where, orderBy: { createdAt: 'desc' }, skip: window.skip, take: window.pageSize, include: { attachments: { select: { id: true, originalName: true, mimeType: true, sizeBytes: true, createdAt: true } }, patient: { include: { user: { select: { name: true } } } }, doctor: { include: { user: { select: { name: true } } } } } });
    return pageResult(rows.map((row) => this.recordOut(row)), total, window);
  }
  private recordListWhere(actor: SessionUser): Prisma.MedicalRecordWhereInput {
    const where: Prisma.MedicalRecordWhereInput = { hospitalId: actor.hospitalId ?? -1 };
    if (actor.role === Role.PATIENT) where.patient = { userId: actor.id };
    else if (actor.role === Role.DOCTOR) where.doctor = { userId: actor.id };
    else if (!(new Set<Role>([Role.HOSPITAL_ADMIN, Role.NURSE])).has(actor.role as Role)) throw new ForbiddenException();
    return where;
  }
  async record(id: number, actor: SessionUser) {
    const where: Prisma.MedicalRecordWhereInput = { id, hospitalId: actor.hospitalId ?? -1 };
    if (actor.role === Role.PATIENT) where.patient = { userId: actor.id };
    else if (actor.role === Role.DOCTOR) where.doctor = { userId: actor.id };
    else if (!(new Set<Role>([Role.HOSPITAL_ADMIN, Role.NURSE])).has(actor.role as Role)) throw new ForbiddenException();
    const row = await this.prisma.medicalRecord.findFirst({ where, include: { attachments: { select: { id: true, originalName: true, mimeType: true, sizeBytes: true, createdAt: true } } } });
    if (!row) throw new NotFoundException('Medical record not found');
    return this.recordOut(row);
  }
  async createPrescription(appointmentId: number, dto: PrescriptionDto, actor: SessionUser) {
    if (dto.items.length < 1 || dto.items.length > 20) throw new ConflictException('Prescriptions require 1 to 20 items');
    const appointment = await this.prisma.appointment.findFirst({ where: { id: appointmentId, hospitalId: actor.hospitalId ?? -1, doctor: { userId: actor.id }, deletedAt: null }, include: { record: true } });
    if (!appointment) throw new NotFoundException('Appointment not found');
    if (!appointment.record) throw new ConflictException('Save the medical record before writing a prescription');
    const signedAt = new Date();
    const prescriptionItems = dto.items.map((item) => ({ ...item, instructions: item.instructions || '' }));
    const instructionsEncrypted = encryptClinicalText(dto.instructions || '');
    const signatureDigest = signClinicalArtifact({ kind: 'prescription', appointmentId, doctorUserId: actor.id, signedAt: signedAt.toISOString(), instructionsEncrypted, items: prescriptionItems });
    const data = { hospitalId: appointment.hospitalId, appointmentId, patientId: appointment.patientId, doctorId: appointment.doctorId, instructionsEncrypted, signedAt, signatureDigest, items: { create: prescriptionItems } };
    try { return this.prescriptionOut(await this.prisma.prescription.create({ data, include: { items: true } })); }
    catch (error) { if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw new ConflictException('A prescription already exists'); throw error; }
  }
  async prescriptions(actor: SessionUser) {
    const where = this.prescriptionListWhere(actor);
    const rows = await this.prisma.prescription.findMany({ where, include: { items: true, dispense: { select: { id: true } } }, orderBy: { createdAt: 'desc' }, take: 100 });
    return rows.map((row) => this.prescriptionOut(row));
  }
  async prescriptionsPage(query: PageQueryDto, actor: SessionUser) {
    const where = this.prescriptionListWhere(actor);
    if (query.dispensed !== undefined) where.dispense = query.dispensed ? { isNot: null } : { is: null };
    const search = query.q?.trim();
    if (search) {
      const numericId = /^\d+$/.test(search) ? Number(search) : undefined;
      where.OR = [
        { items: { some: { medicineName: { contains: search, mode: 'insensitive' } } } },
        { patient: { user: { name: { contains: search, mode: 'insensitive' } } } },
        { doctor: { user: { name: { contains: search, mode: 'insensitive' } } } },
        ...(numericId && Number.isSafeInteger(numericId) ? [{ id: numericId }] : []),
      ];
    }
    const total = await this.prisma.prescription.count({ where });
    const window = pageWindow(query, total);
    const rows = await this.prisma.prescription.findMany({ where, include: { items: true, dispense: { select: { id: true } } }, orderBy: { createdAt: 'desc' }, skip: window.skip, take: window.pageSize });
    return pageResult(rows.map((row) => this.prescriptionOut(row)), total, window);
  }
  private prescriptionListWhere(actor: SessionUser): Prisma.PrescriptionWhereInput {
    const where: Prisma.PrescriptionWhereInput = { hospitalId: actor.hospitalId ?? -1 };
    if (actor.role === Role.PATIENT) where.patient = { userId: actor.id };
    else if (actor.role === Role.DOCTOR) where.doctor = { userId: actor.id };
    else if (!(new Set<Role>([Role.HOSPITAL_ADMIN, Role.PHARMACIST])).has(actor.role as Role)) throw new ForbiddenException();
    return where;
  }
  async prescription(id: number, actor: SessionUser) {
    const where: Prisma.PrescriptionWhereInput = { id, hospitalId: actor.hospitalId ?? -1 };
    if (actor.role === Role.PATIENT) where.patient = { userId: actor.id };
    else if (actor.role === Role.DOCTOR) where.doctor = { userId: actor.id };
    else if (!(new Set<Role>([Role.HOSPITAL_ADMIN, Role.PHARMACIST])).has(actor.role as Role)) throw new ForbiddenException();
    const row = await this.prisma.prescription.findFirst({ where, include: { items: true, patient: { include: { user: { select: { name: true } } } }, doctor: { include: { user: { select: { name: true } } } }, hospital: { select: { name: true } } } });
    if (!row) throw new NotFoundException('Prescription not found');
    return this.prescriptionOut(row);
  }
  async prescriptionPdf(id: number, actor: SessionUser): Promise<Buffer> {
    const where: Prisma.PrescriptionWhereInput = { id, hospitalId: actor.hospitalId ?? -1 };
    if (actor.role === Role.PATIENT) where.patient = { userId: actor.id };
    else if (actor.role === Role.DOCTOR) where.doctor = { userId: actor.id };
    else if (!(new Set<Role>([Role.HOSPITAL_ADMIN, Role.PHARMACIST])).has(actor.role as Role)) throw new ForbiddenException();
    const row = await this.prisma.prescription.findFirst({ where, include: { items: true, patient: { include: { user: { select: { name: true } } } }, doctor: { include: { user: { select: { name: true } } } }, hospital: { select: { name: true } } } });
    if (!row) throw new NotFoundException('Prescription not found');
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ size: 'A4', margin: 54, info: { Title: 'MedCore prescription', Author: 'MedCore HMS' } });
      const chunks: Buffer[] = [];
      doc.on('data', (chunk: Buffer) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);
      doc.fontSize(20).fillColor('#147d73').text(row.hospital.name);
      doc.moveDown().fontSize(15).fillColor('#172033').text('Prescription');
      doc.moveDown().fontSize(10).text('Patient: ' + row.patient.user.name).text('Doctor: ' + row.doctor.user.name).text('Issued: ' + row.createdAt.toISOString().slice(0, 10));
      doc.moveDown().fontSize(12).text('Medicines', { underline: true });
      row.items.forEach((item, index) => {
        doc.moveDown(0.5).fontSize(11).text((index + 1) + '. ' + item.medicineName + ' — ' + item.dosage);
        doc.fontSize(9).fillColor('#566174').text(item.frequency + ' for ' + item.duration + (item.instructions ? '. ' + item.instructions : ''));
      });
      const instructions = decryptClinicalText(row.instructionsEncrypted);
      if (instructions) doc.moveDown().fontSize(10).fillColor('#172033').text('Instructions: ' + instructions);
      if (row.signedAt && row.signatureDigest) doc.moveDown(2).fontSize(9).fillColor('#147d73').text('Electronically signed by ' + row.doctor.user.name + ' on ' + row.signedAt.toISOString() + '. Integrity reference: ' + row.signatureDigest.slice(0, 16));
      doc.moveDown(3).fontSize(8).fillColor('#566174').text('This record was generated by MedCore HMS. Follow the prescribing clinician’s instructions.');
      doc.end();
    });
  }
  private recordOut(row: any) {
    return { id: row.id, hospitalId: row.hospitalId, appointmentId: row.appointmentId, patientId: row.patientId, patientName: row.patient?.user?.name, doctorId: row.doctorId, doctorName: row.doctor?.user?.name, chiefComplaint: decryptClinicalText(row.chiefComplaintEncrypted), symptoms: decryptClinicalText(row.symptomsEncrypted), diagnosis: decryptClinicalText(row.diagnosisEncrypted), treatmentPlan: decryptClinicalText(row.treatmentPlanEncrypted), allergies: decryptClinicalText(row.allergiesEncrypted), medicalHistory: decryptClinicalText(row.medicalHistoryEncrypted || ''), familyHistory: decryptClinicalText(row.familyHistoryEncrypted || ''), surgicalHistory: decryptClinicalText(row.surgicalHistoryEncrypted || ''), vaccinationHistory: decryptClinicalText(row.vaccinationHistoryEncrypted || ''), bloodPressure: row.bloodPressure, pulseBpm: row.pulseBpm, temperatureC: row.temperatureC?.toString(), spo2Percent: row.spo2Percent, weightKg: row.weightKg?.toString(), heightCm: row.heightCm?.toString(), bmi: row.bmi?.toString(), signedAt: row.signedAt?.toISOString() || null, signed: Boolean(row.signedAt && row.signatureDigest), attachments: (row.attachments || []).map((file: any) => ({ id: file.id, name: file.originalName, mimeType: file.mimeType, sizeBytes: file.sizeBytes, createdAt: file.createdAt.toISOString() })), createdAt: row.createdAt.toISOString() };
  }
  private prescriptionOut(row: any) {
    return { id: row.id, hospitalId: row.hospitalId, appointmentId: row.appointmentId, patientId: row.patientId, doctorId: row.doctorId, patientName: row.patient?.user?.name, doctorName: row.doctor?.user?.name, hospitalName: row.hospital?.name, dispensed: Boolean(row.dispense), instructions: decryptClinicalText(row.instructionsEncrypted), items: row.items.map((item: any) => ({ id: item.id, medicineName: item.medicineName, dosage: item.dosage, frequency: item.frequency, duration: item.duration, instructions: item.instructions })), signedAt: row.signedAt?.toISOString() || null, signed: Boolean(row.signedAt && row.signatureDigest), createdAt: row.createdAt.toISOString() };
  }

  async addAttachment(recordId: number, file: ClinicalUpload | undefined, actor: SessionUser) {
    if (!file) throw new BadRequestException('Select a file to upload');
    let metadata: ReturnType<typeof validateClinicalUpload>;
    try { metadata = validateClinicalUpload(file); } catch (error) { throw new BadRequestException(error instanceof Error ? error.message : 'Invalid attachment'); }
    if (actor.role !== Role.DOCTOR) throw new ForbiddenException('Only the assigned doctor can add clinical attachments');
    const record = await this.prisma.medicalRecord.findFirst({ where: { id: recordId, hospitalId: actor.hospitalId ?? -1, doctor: { userId: actor.id } }, select: { id: true, hospitalId: true } });
    if (!record) throw new NotFoundException('Medical record not found');
    const encryptedContents = Uint8Array.from(encryptClinicalBytes(file.buffer));
    const stored = await this.prisma.clinicalAttachment.create({ data: { hospitalId: record.hospitalId, recordId, uploadedById: actor.id, ...metadata, encryptedContents }, select: { id: true, originalName: true, mimeType: true, sizeBytes: true, createdAt: true } });
    return { id: stored.id, name: stored.originalName, mimeType: stored.mimeType, sizeBytes: stored.sizeBytes, createdAt: stored.createdAt.toISOString() };
  }

  async attachments(recordId: number, actor: SessionUser) {
    const where = this.attachmentAccess(actor);
    const record = await this.prisma.medicalRecord.findFirst({ where: { id: recordId, hospitalId: actor.hospitalId ?? -1, ...where }, select: { id: true } });
    if (!record) throw new NotFoundException('Medical record not found');
    const files = await this.prisma.clinicalAttachment.findMany({ where: { recordId, hospitalId: actor.hospitalId ?? -1 }, select: { id: true, originalName: true, mimeType: true, sizeBytes: true, createdAt: true }, orderBy: { createdAt: 'asc' } });
    return files.map((file) => ({ id: file.id, name: file.originalName, mimeType: file.mimeType, sizeBytes: file.sizeBytes, createdAt: file.createdAt.toISOString() }));
  }

  async attachment(id: number, actor: SessionUser) {
    const file = await this.prisma.clinicalAttachment.findFirst({ where: { id, hospitalId: actor.hospitalId ?? -1, record: this.attachmentAccess(actor) } });
    if (!file) throw new NotFoundException('Attachment not found');
    return { name: file.originalName, mimeType: file.mimeType, bytes: decryptClinicalBytes(Buffer.from(file.encryptedContents)) };
  }

  private attachmentAccess(actor: SessionUser): Prisma.MedicalRecordWhereInput {
    if (actor.role === Role.PATIENT) return { patient: { userId: actor.id } };
    if (actor.role === Role.DOCTOR) return { doctor: { userId: actor.id } };
    if (actor.role === Role.HOSPITAL_ADMIN || actor.role === Role.NURSE) return {};
    throw new ForbiddenException();
  }
}
