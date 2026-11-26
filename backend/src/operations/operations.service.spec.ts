jest.mock('@nestjs/common', () => {
  class BadRequestException extends Error {}
  class ConflictException extends Error {}
  class ForbiddenException extends Error {}
  class NotFoundException extends Error {}
  class Injectable {};
  return { BadRequestException, ConflictException, ForbiddenException, NotFoundException, Injectable: () => (target: unknown) => target };
});
jest.mock('../infra/prisma.service', () => ({ PrismaService: class PrismaService {} }));
jest.mock('../notifications/notifications.service', () => ({ NotificationsService: class NotificationsService {} }));
import { LabStatus, Role } from '@prisma/client';
import { OperationsService } from './operations.service';

describe('OperationsService', () => {
  const doctor = { id: 4, name: 'Doctor', email: 'doctor@example.test', role: Role.DOCTOR, hospitalId: 7, sid: 's1' };
  const pharmacist = { ...doctor, id: 6, role: Role.PHARMACIST };
  const order = { id: 13, hospitalId: 7, appointmentId: 31, patientId: 9, doctorId: 4, testName: 'CBC', notesEncrypted: '', resultEncrypted: '', status: LabStatus.ORDERED, createdAt: new Date('2026-11-26T10:00:00Z') };

  const setup = () => {
    const tx = {
      dispense: { create: jest.fn(async () => ({ id: 88, createdAt: new Date('2026-11-26T10:00:00Z') })) },
      medicine: { findFirst: jest.fn(async () => ({ id: 3, name: 'Demo medicine' })) },
      inventoryBatch: {
        findMany: jest.fn(async () => [{ id: 10, batchNumber: 'B-1', quantityRemaining: 5 }]),
        updateMany: jest.fn(async () => ({ count: 1 })),
      },
      dispensedItem: { create: jest.fn(async () => undefined) },
      auditLog: { create: jest.fn(async () => undefined) },
    };
    const prisma = {
      appointment: { findFirst: jest.fn(async () => ({ id: 31, hospitalId: 7, patientId: 9, doctorId: 4 })) },
      labOrder: {
        create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({ ...order, ...data })),
        findMany: jest.fn(async () => [order]), count: jest.fn(async () => 16), findFirst: jest.fn(async () => order),
        update: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({ ...order, ...data })),
      },
      patient: { findUnique: jest.fn(async () => ({ userId: 9 })) },
      doctor: { findUnique: jest.fn(async () => ({ userId: 4 })) },
      medicine: {
        create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => data),
        findMany: jest.fn(async () => [{ id: 3, name: 'Demo medicine', sku: 'DM-1', category: 'Demo', unit: 'tablet', reorderLevel: 2, batches: [{ expiryDate: new Date(Date.now() + 86_400_000), quantityRemaining: 5 }] }]),
        count: jest.fn(async () => 11),
        findFirst: jest.fn(async () => ({ id: 3 })),
      },
      inventoryBatch: { create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => data) },
      prescription: { findFirst: jest.fn(async () => ({ id: 21, hospitalId: 7, patientId: 9, items: [{ id: 22, medicineName: 'Demo medicine' }], dispense: null, patient: { userId: 9 } })) },
      $transaction: jest.fn(async (callback: (value: typeof tx) => unknown) => callback(tx)),
    };
    const notifications = { create: jest.fn(async () => undefined) };
    return { service: new OperationsService(prisma as never, notifications as never), prisma, tx, notifications };
  };

  beforeAll(() => { process.env.CLINICAL_ENCRYPTION_KEY = Buffer.alloc(32, 12).toString('base64'); });

  it('creates scoped lab orders and limits result visibility by status and role', async () => {
    const { service, prisma, notifications } = setup();
    const result = await service.createLab(31, { testName: 'CBC', notes: 'Demo note' }, doctor);
    expect(result.testName).toBe('CBC');
    expect(prisma.labOrder.create.mock.calls[0][0].data.notesEncrypted).not.toContain('Demo note');
    expect(notifications.create).toHaveBeenCalled();
    const patient = { ...doctor, role: Role.PATIENT, id: 9 };
    const visible = await service.labs(patient);
    expect(visible[0].result).toBeUndefined();
    expect(prisma.labOrder.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { hospitalId: 7, patient: { userId: 9 } } }));
  });

  it('searches and pages lab orders while preserving patient and status scoping', async () => {
    const { service, prisma } = setup();
    const patient = { ...doctor, id: 9, role: Role.PATIENT };
    const result = await service.labsPage({ page: 2, pageSize: 5, q: 'CBC', status: 'ordered' }, patient);
    expect(result).toMatchObject({ total: 16, page: 2, pageSize: 5, totalPages: 4, items: [{ id: 13, testName: 'CBC' }] });
    expect(prisma.labOrder.count).toHaveBeenCalledWith({ where: expect.objectContaining({ hospitalId: 7, patient: { userId: 9 }, status: LabStatus.ORDERED, OR: [
      { testName: { contains: 'CBC', mode: 'insensitive' } },
      { patient: { user: { name: { contains: 'CBC', mode: 'insensitive' } } } },
      { doctor: { user: { name: { contains: 'CBC', mode: 'insensitive' } } } },
    ] }) });
    expect(prisma.labOrder.findMany).toHaveBeenLastCalledWith(expect.objectContaining({ skip: 5, take: 5 }));
    await expect(service.labsPage({ page: 1, pageSize: 10, status: 'unknown' }, patient)).rejects.toThrow('Invalid laboratory status');
  });

  it('searches and pages medicine inventory scoped to the hospital', async () => {
    const { service, prisma } = setup();
    const result = await service.medicinesPage({ page: 1, pageSize: 5, q: 'DM-1' }, pharmacist);
    expect(result).toMatchObject({ total: 11, page: 1, pageSize: 5, items: [{ id: 3, sku: 'DM-1', available: 5 }] });
    expect(prisma.medicine.count).toHaveBeenCalledWith({ where: { hospitalId: 7, active: true, OR: [
      { name: { contains: 'DM-1', mode: 'insensitive' } },
      { sku: { contains: 'DM-1', mode: 'insensitive' } },
      { category: { contains: 'DM-1', mode: 'insensitive' } },
    ] } });
    expect(prisma.medicine.findMany).toHaveBeenLastCalledWith(expect.objectContaining({ skip: 0, take: 5 }));
  });

  it('allows lab staff to upload results and clinicians to approve them', async () => {
    const { service, prisma, notifications } = setup();
    const labTech = { ...doctor, role: Role.LAB_TECHNICIAN };
    const uploaded = await service.result(13, { result: 'Normal, fictional result' }, labTech);
    expect(uploaded.status).toBe('result_uploaded');
    expect(prisma.labOrder.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: LabStatus.RESULT_UPLOADED }) }));
    expect(notifications.create).toHaveBeenCalledWith(7, 4, 'lab', expect.any(String), expect.any(String));
    prisma.labOrder.findFirst.mockResolvedValueOnce({ ...order, status: LabStatus.RESULT_UPLOADED } as never);
    const approved = await service.approveLab(13, doctor);
    expect(approved.status).toBe('approved');
    expect(notifications.create).toHaveBeenCalledWith(7, 9, 'lab', expect.any(String), expect.any(String));
  });

  it('rejects invalid lab ownership, unauthorized results, and premature approvals', async () => {
    const { service, prisma } = setup();
    prisma.appointment.findFirst.mockResolvedValueOnce(null as never);
    await expect(service.createLab(99, { testName: 'CBC' }, doctor)).rejects.toThrow('Appointment not found');
    await expect(service.result(13, { result: 'Result' }, doctor)).rejects.toThrow('Only a lab technician');
    await expect(service.approveLab(13, doctor)).rejects.toThrow('Only the assigned doctor');
  });

  it('creates and lists medicines with calculated inventory levels', async () => {
    const { service, prisma } = setup();
    const medicine = await service.createMedicine({ name: ' Demo medicine ', sku: ' DM-1 ' }, pharmacist);
    expect(medicine).toMatchObject({ hospitalId: 7, name: 'Demo medicine', sku: 'DM-1', category: 'General' });
    expect((await service.medicines(pharmacist))[0]).toMatchObject({ available: 5, lowStock: false, expiredQuantity: 0 });
    expect(prisma.medicine.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { hospitalId: 7, active: true } }));
  });

  it('receives only unexpired batches for a hospital-owned medicine', async () => {
    const { service, prisma } = setup();
    const batch = await service.receiveBatch(3, { batchNumber: 'B-2', expiryDate: new Date(Date.now() + 5 * 86_400_000).toISOString(), quantity: 10, unitCost: 1.25 }, pharmacist);
    expect(batch).toMatchObject({ hospitalId: 7, medicineId: 3, quantityRemaining: 10, unitCostMinor: 125 });
    await expect(service.receiveBatch(3, { batchNumber: 'OLD', expiryDate: '2020-01-01', quantity: 1, unitCost: 1 }, pharmacist)).rejects.toThrow('expiry must be in the future');
    prisma.medicine.findFirst.mockResolvedValueOnce(null as never);
    await expect(service.receiveBatch(99, { batchNumber: 'B', expiryDate: new Date(Date.now() + 5 * 86_400_000).toISOString(), quantity: 1, unitCost: 1 }, pharmacist)).rejects.toThrow('Medicine not found');
  });

  it('dispenses by earliest-expiry batch and writes an audit event', async () => {
    const { service, tx, notifications } = setup();
    const result = await service.dispense(21, { items: [{ prescriptionItemId: 22, quantity: 3 }] }, pharmacist);
    expect(result).toMatchObject({ prescriptionId: 21, items: [{ medicineName: 'Demo medicine', quantity: 3, batches: ['B-1'] }] });
    expect(tx.inventoryBatch.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { quantityRemaining: { decrement: 3 } } }));
    expect(tx.auditLog.create).toHaveBeenCalled();
    expect(notifications.create).toHaveBeenCalled();
  });

  it('rejects dispense requests with missing lines or no eligible stock', async () => {
    const { service, prisma, tx } = setup();
    await expect(service.dispense(21, { items: [] }, pharmacist)).rejects.toThrow('Provide one quantity for every');
    prisma.prescription.findFirst.mockResolvedValueOnce({ id: 21, hospitalId: 7, patientId: 9, items: [{ id: 22, medicineName: 'Demo medicine' }], dispense: null, patient: { userId: 9 } } as never);
    tx.inventoryBatch.findMany.mockResolvedValueOnce([] as never);
    await expect(service.dispense(21, { items: [{ prescriptionItemId: 22, quantity: 1 }] }, pharmacist)).rejects.toThrow('Insufficient unexpired stock');
  });
});
