import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { LabStatus, Role, Prisma } from '@prisma/client';
import { PrismaService } from '../infra/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { SessionUser } from '../security/current-user.decorator';
import { PageQueryDto } from '../common/pagination.dto';
import { pageResult, pageWindow } from '../common/pagination';
import { decryptClinicalText, encryptClinicalText } from '../security/data-protection';
import { BatchDto, DispenseDto, LabOrderDto, LabResultDto, MedicineDto } from './operations.dto';
import { stockLevels } from './stock-levels';

@Injectable()
export class OperationsService {
  constructor(private prisma: PrismaService, private notifications: NotificationsService) {}
  async createLab(appointmentId: number, dto: LabOrderDto, user: SessionUser) {
    const appointment = await this.prisma.appointment.findFirst({ where: { id: appointmentId, hospitalId: user.hospitalId ?? -1, doctor: { userId: user.id } } });
    if (!appointment) throw new NotFoundException('Appointment not found');
    const row = await this.prisma.labOrder.create({ data: { hospitalId: appointment.hospitalId, appointmentId, patientId: appointment.patientId, doctorId: appointment.doctorId, testName: dto.testName, notesEncrypted: encryptClinicalText(dto.notes || ''), orderedById: user.id } });
    const patient = await this.prisma.patient.findUnique({ where: { id: appointment.patientId }, select: { userId: true } });
    if (patient) await this.notifications.create(appointment.hospitalId, patient.userId, 'lab', 'Test ordered', 'A laboratory test was ordered for your appointment.');
    return this.labOut(row);
  }
  async labs(user: SessionUser) {
    const where = this.labsWhere(user);
    const rows = await this.prisma.labOrder.findMany({ where, orderBy: { createdAt: 'desc' }, take: 100 });
    return rows.map((row) => this.labOut(row, user.role === Role.LAB_TECHNICIAN || user.role === Role.DOCTOR || user.role === Role.HOSPITAL_ADMIN || row.status === LabStatus.APPROVED));
  }
  async labsPage(query: PageQueryDto, user: SessionUser) {
    const where = this.labsWhere(user);
    const status = query.status?.toUpperCase();
    if (status) {
      if (!Object.values(LabStatus).includes(status as LabStatus)) throw new BadRequestException('Invalid laboratory status');
      where.status = status as LabStatus;
    }
    const search = query.q?.trim();
    if (search) {
      const numericId = /^\\d+$/.test(search) ? Number(search) : undefined;
      where.OR = [
        { testName: { contains: search, mode: 'insensitive' } },
        { patient: { user: { name: { contains: search, mode: 'insensitive' } } } },
        { doctor: { user: { name: { contains: search, mode: 'insensitive' } } } },
        ...(numericId && Number.isSafeInteger(numericId) ? [{ id: numericId }] : []),
      ];
    }
    const total = await this.prisma.labOrder.count({ where });
    const window = pageWindow(query, total);
    const rows = await this.prisma.labOrder.findMany({ where, orderBy: { createdAt: 'desc' }, skip: window.skip, take: window.pageSize });
    return pageResult(rows.map((row) => this.labOut(row, user.role === Role.LAB_TECHNICIAN || user.role === Role.DOCTOR || user.role === Role.HOSPITAL_ADMIN || row.status === LabStatus.APPROVED)), total, window);
  }
  private labsWhere(user: SessionUser): Prisma.LabOrderWhereInput {
    const where: Prisma.LabOrderWhereInput = { hospitalId: user.hospitalId ?? -1 };
    if (user.role === Role.PATIENT) where.patient = { userId: user.id };
    else if (user.role === Role.DOCTOR) where.doctor = { userId: user.id };
    else if (!(new Set<Role>([Role.HOSPITAL_ADMIN, Role.LAB_TECHNICIAN])).has(user.role as Role)) throw new ForbiddenException();
    return where;
  }
  async result(id: number, dto: LabResultDto, actor: SessionUser) {
    const row = await this.prisma.labOrder.findFirst({ where: { id, hospitalId: actor.hospitalId ?? -1 } });
    if (!row) throw new NotFoundException('Lab order not found');
    if (actor.role !== Role.LAB_TECHNICIAN || row.status !== LabStatus.ORDERED) throw new ForbiddenException('Only a lab technician can upload an ordered result');
    const updated = await this.prisma.labOrder.update({ where: { id }, data: { resultEncrypted: encryptClinicalText(dto.result), status: LabStatus.RESULT_UPLOADED, resultUploadedById: actor.id, uploadedAt: new Date() } });
    const doctor = await this.prisma.doctor.findUnique({ where: { id: row.doctorId }, select: { userId: true } });
    if (doctor) await this.notifications.create(row.hospitalId, doctor.userId, 'lab', 'Result ready for review', 'A test result requires clinician approval.');
    return this.labOut(updated, true);
  }
  async approveLab(id: number, actor: SessionUser) {
    const row = await this.prisma.labOrder.findFirst({ where: { id, hospitalId: actor.hospitalId ?? -1, ...(actor.role === Role.DOCTOR ? { doctor: { userId: actor.id } } : {}) } });
    if (!row) throw new NotFoundException('Lab order not found');
    if (!(new Set<Role>([Role.DOCTOR, Role.HOSPITAL_ADMIN])).has(actor.role as Role) || row.status !== LabStatus.RESULT_UPLOADED) throw new ConflictException('Only the assigned doctor or hospital admin can approve an uploaded result');
    const updated = await this.prisma.labOrder.update({ where: { id }, data: { status: LabStatus.APPROVED, approvedById: actor.id, approvedAt: new Date() } });
    const patient = await this.prisma.patient.findUnique({ where: { id: row.patientId }, select: { userId: true } });
    if (patient) await this.notifications.create(row.hospitalId, patient.userId, 'lab', 'Test result approved', 'Your approved test result is available in the patient portal.');
    return this.labOut(updated, true);
  }
  async createMedicine(dto: MedicineDto, actor: SessionUser) {
    if (!(new Set<Role>([Role.HOSPITAL_ADMIN, Role.PHARMACIST])).has(actor.role as Role) || !actor.hospitalId) throw new ForbiddenException();
    return this.prisma.medicine.create({ data: { hospitalId: actor.hospitalId, name: dto.name.trim(), sku: dto.sku.trim(), category: dto.category || 'General', unit: dto.unit || 'unit', reorderLevel: dto.reorderLevel || 0 } });
  }
  async medicines(actor: SessionUser) {
    if (!actor.hospitalId) throw new ForbiddenException();
    const rows = await this.prisma.medicine.findMany({ where: { hospitalId: actor.hospitalId, active: true }, include: { batches: { where: { quantityRemaining: { gt: 0 } }, select: { expiryDate: true, quantityRemaining: true } } }, orderBy: { name: 'asc' }, take: 100 });
    const now = new Date();
    return rows.map((row) => ({ id: row.id, name: row.name, sku: row.sku, category: row.category, unit: row.unit, reorderLevel: row.reorderLevel, ...stockLevels(row.batches, row.reorderLevel, now) }));
  }
  async medicinesPage(query: PageQueryDto, actor: SessionUser) {
    if (!actor.hospitalId) throw new ForbiddenException();
    const where: Prisma.MedicineWhereInput = { hospitalId: actor.hospitalId, active: true };
    const search = query.q?.trim();
    if (search) where.OR = [
      { name: { contains: search, mode: 'insensitive' } },
      { sku: { contains: search, mode: 'insensitive' } },
      { category: { contains: search, mode: 'insensitive' } },
    ];
    const total = await this.prisma.medicine.count({ where });
    const window = pageWindow(query, total);
    const rows = await this.prisma.medicine.findMany({ where, include: { batches: { where: { quantityRemaining: { gt: 0 } }, select: { expiryDate: true, quantityRemaining: true } } }, orderBy: { name: 'asc' }, skip: window.skip, take: window.pageSize });
    const now = new Date();
    const items = rows.map((row) => ({ id: row.id, name: row.name, sku: row.sku, category: row.category, unit: row.unit, reorderLevel: row.reorderLevel, ...stockLevels(row.batches, row.reorderLevel, now) }));
    return pageResult(items, total, window);
  }
  async receiveBatch(medicineId: number, dto: BatchDto, actor: SessionUser) {
    if (!(new Set<Role>([Role.HOSPITAL_ADMIN, Role.PHARMACIST])).has(actor.role as Role) || !actor.hospitalId) throw new ForbiddenException();
    const medicine = await this.prisma.medicine.findFirst({ where: { id: medicineId, hospitalId: actor.hospitalId } });
    if (!medicine) throw new NotFoundException('Medicine not found');
    const expiry = new Date(dto.expiryDate);
    if (expiry <= new Date()) throw new BadRequestException('Batch expiry must be in the future');
    return this.prisma.inventoryBatch.create({ data: { hospitalId: actor.hospitalId, medicineId, batchNumber: dto.batchNumber, expiryDate: expiry, quantityReceived: dto.quantity, quantityRemaining: dto.quantity, unitCostMinor: Math.round(dto.unitCost * 100) } });
  }
  async dispense(prescriptionId: number, dto: DispenseDto, actor: SessionUser) {
    if (actor.role !== Role.PHARMACIST || !actor.hospitalId) throw new ForbiddenException();
    const prescription = await this.prisma.prescription.findFirst({ where: { id: prescriptionId, hospitalId: actor.hospitalId }, include: { items: true, dispense: true, patient: { select: { userId: true } } } });
    if (!prescription) throw new NotFoundException('Prescription not found');
    if (prescription.dispense) throw new ConflictException('Prescription already dispensed');
    const requested = new Map(dto.items.map((item) => [item.prescriptionItemId, item.quantity]));
    if (requested.size !== prescription.items.length || prescription.items.some((line) => !requested.has(line.id))) throw new BadRequestException('Provide one quantity for every prescription item');
    return this.prisma.$transaction(async (tx) => {
      const dispense = await tx.dispense.create({ data: { hospitalId: actor.hospitalId!, prescriptionId, patientId: prescription.patientId, dispensedById: actor.id } });
      const allocations: Array<{ prescriptionItemId: number; medicineName: string; quantity: number; batches: string[] }> = [];
      for (const line of prescription.items) {
        const medicine = await tx.medicine.findFirst({ where: { hospitalId: actor.hospitalId!, name: line.medicineName, active: true } });
        if (!medicine) throw new BadRequestException('Medicine is not in the hospital catalogue: ' + line.medicineName);
        let remaining = requested.get(line.id)!;
        const batches = await tx.inventoryBatch.findMany({ where: { medicineId: medicine.id, hospitalId: actor.hospitalId!, expiryDate: { gt: new Date() }, quantityRemaining: { gt: 0 } }, orderBy: [{ expiryDate: 'asc' }, { receivedAt: 'asc' }] });
        const lineBatches: string[] = [];
        for (const batch of batches) {
          if (remaining <= 0) break;
          const quantity = Math.min(remaining, batch.quantityRemaining);
          const updated = await tx.inventoryBatch.updateMany({ where: { id: batch.id, quantityRemaining: { gte: quantity } }, data: { quantityRemaining: { decrement: quantity } } });
          if (!updated.count) throw new ConflictException('Stock changed while dispensing; retry the operation');
          remaining -= quantity;
          lineBatches.push(batch.batchNumber);
          await tx.dispensedItem.create({ data: { dispenseId: dispense.id, prescriptionItemId: line.id, medicineName: medicine.name, quantity, batchNumber: batch.batchNumber } });
        }
        if (remaining > 0) throw new BadRequestException('Insufficient unexpired stock for ' + medicine.name);
        allocations.push({ prescriptionItemId: line.id, medicineName: medicine.name, quantity: requested.get(line.id)!, batches: lineBatches });
      }
      await tx.auditLog.create({ data: { hospitalId: actor.hospitalId!, userId: actor.id, action: 'DISPENSE', entity: 'Prescription', entityId: prescriptionId } });
      return { id: dispense.id, prescriptionId, items: allocations, createdAt: dispense.createdAt.toISOString() };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }).then(async (result) => {
      await this.notifications.create(actor.hospitalId!, prescription.patient.userId, 'pharmacy', 'Prescription dispensed', 'Your prescription has been prepared by the pharmacy.');
      return result;
    });
  }
  private labOut(row: any, reveal = true) { return { id: row.id, appointmentId: row.appointmentId, patientId: row.patientId, doctorId: row.doctorId, testName: row.testName, notes: decryptClinicalText(row.notesEncrypted), result: reveal ? decryptClinicalText(row.resultEncrypted) : undefined, status: row.status.toLowerCase(), createdAt: row.createdAt.toISOString() }; }
}
