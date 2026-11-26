jest.mock('@nestjs/common', () => {
  class TestHttpException extends Error {}
  return { BadRequestException: TestHttpException, ConflictException: TestHttpException, ForbiddenException: TestHttpException, Injectable: () => (target: unknown) => target, NotFoundException: TestHttpException };
});
jest.mock('../infra/prisma.service', () => ({ PrismaService: class PrismaService {} }));
import { AppointmentStatus, Role } from '@prisma/client';
import { decryptClinicalBytes, decryptClinicalText, encryptClinicalBytes } from '../security/data-protection';
import { ClinicalService } from './clinical.service';

describe('ClinicalService signatures and attachments', () => {
  const actor = { id: 7, name: 'Dr Demo', email: 'doctor@example.test', role: Role.DOCTOR, hospitalId: 3, sid: 'session' };
  const appointment = { id: 42, hospitalId: 3, patientId: 11, doctorId: 15, status: AppointmentStatus.IN_PROGRESS, record: null };
  const prisma = {
    appointment: { findFirst: jest.fn(async () => appointment) },
    medicalRecord: {
      create: jest.fn(async ({ data }: { data: Record<string, any> }) => ({ id: 90, ...data, createdAt: new Date('2026-11-26T10:00:00Z'), attachments: [] })),
      count: jest.fn(async () => 1),
      findFirst: jest.fn(async () => ({ id: 90, hospitalId: 3, appointmentId: 42, patientId: 11, doctorId: 15, diagnosisEncrypted: '', treatmentPlanEncrypted: '', chiefComplaintEncrypted: '', symptomsEncrypted: '', allergiesEncrypted: '', createdAt: new Date('2026-11-26T10:00:00Z'), attachments: [] })),
      findMany: jest.fn(async () => [{ id: 90, hospitalId: 3, appointmentId: 42, patientId: 11, doctorId: 15, diagnosisEncrypted: '', treatmentPlanEncrypted: '', chiefComplaintEncrypted: '', symptomsEncrypted: '', allergiesEncrypted: '', createdAt: new Date('2026-11-26T10:00:00Z'), attachments: [] }]),
    },
    clinicalAttachment: {
      create: jest.fn(async ({ data, select }: { data: Record<string, any>; select: unknown }) => ({ id: 5, ...data, createdAt: new Date('2026-11-26T10:00:00Z') })),
      findFirst: jest.fn(async () => null),
      findMany: jest.fn(async () => []),
    },
    prescription: {
      create: jest.fn(async ({ data }: { data: Record<string, any> }) => ({ id: 23, ...data, items: data.items.create, createdAt: new Date('2026-11-26T10:00:00Z') })),
      count: jest.fn(async () => 1),
      findMany: jest.fn(async () => [{ id: 23, hospitalId: 3, appointmentId: 42, patientId: 11, doctorId: 15, instructionsEncrypted: '', items: [], createdAt: new Date('2026-11-26T10:00:00Z'), dispense: null }]),
      findFirst: jest.fn(async () => ({ id: 23, hospitalId: 3, appointmentId: 42, patientId: 11, doctorId: 15, instructionsEncrypted: '', items: [{ id: 24, medicineName: 'Demo medicine', dosage: 'Once daily', frequency: 'Daily', duration: '7 days', instructions: '' }], createdAt: new Date('2026-11-26T10:00:00Z'), signedAt: new Date('2026-11-26T10:00:00Z'), signatureDigest: 'abcdef', patient: { user: { name: 'Demo Patient' } }, doctor: { user: { name: 'Dr Demo' } }, hospital: { name: 'City Hospital' } })),
    },
  };
  let service: ClinicalService;

  beforeAll(() => { process.env.CLINICAL_ENCRYPTION_KEY = Buffer.alloc(32, 9).toString('base64'); });
  beforeEach(() => { jest.clearAllMocks(); service = new ClinicalService(prisma as never); });

  it('saves medical notes encrypted with a doctor sign-off and calculated BMI', async () => {
    const result = await service.createRecord(42, { diagnosis: 'Fictional diagnosis', medicalHistory: 'Fictional history', weightKg: 70, heightCm: 175 }, actor);
    const data = prisma.medicalRecord.create.mock.calls[0][0].data;
    expect(data.diagnosisEncrypted).not.toContain('Fictional diagnosis');
    expect(decryptClinicalText(data.diagnosisEncrypted)).toBe('Fictional diagnosis');
    expect(data.signedAt).toBeInstanceOf(Date);
    expect(data.signatureDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(result).toMatchObject({ diagnosis: 'Fictional diagnosis', medicalHistory: 'Fictional history', bmi: '22.86', signed: true });
  });

  it('encrypts an allowed PDF attachment and rejects a doctor without access to the record', async () => {
    const bytes = Buffer.from('%PDF-1.7 fictional attachment');
    const result = await service.addAttachment(90, { originalname: 'visit.pdf', mimetype: 'application/pdf', size: bytes.length, buffer: bytes }, actor);
    const saved = prisma.clinicalAttachment.create.mock.calls[0][0].data;
    expect(saved.encryptedContents).not.toEqual(bytes);
    expect(decryptClinicalBytes(Buffer.from(saved.encryptedContents))).toEqual(bytes);
    expect(result).toMatchObject({ id: 5, name: 'visit.pdf', mimeType: 'application/pdf' });
    prisma.medicalRecord.findFirst.mockResolvedValueOnce(null as never);
    await expect(service.addAttachment(404, { originalname: 'visit.pdf', mimetype: 'application/pdf', size: bytes.length, buffer: bytes }, actor)).rejects.toThrow('Medical record not found');
  });

  it('checks role and hospital ownership before exposing attachment bytes', async () => {
    await expect(service.attachment(5, actor)).rejects.toThrow('Attachment not found');
    expect(prisma.clinicalAttachment.findFirst).toHaveBeenCalledWith({ where: { id: 5, hospitalId: 3, record: { doctor: { userId: 7 } } } });
  });

  it('enforces appointment status before creating a medical record', async () => {
    prisma.appointment.findFirst.mockResolvedValueOnce(null as never);
    await expect(service.createRecord(404, { diagnosis: 'Demo' }, actor)).rejects.toThrow('Appointment not found');
    prisma.appointment.findFirst.mockResolvedValueOnce({ ...appointment, status: AppointmentStatus.CANCELLED } as never);
    await expect(service.createRecord(42, { diagnosis: 'Demo' }, actor)).rejects.toThrow('Start the appointment');
  });

  it('scopes medical record lists and details to the patient or assigned doctor', async () => {
    const patient = { ...actor, id: 11, role: Role.PATIENT };
    const records = await service.records(patient);
    expect(records[0]).toMatchObject({ id: 90, signed: false });
    expect(prisma.medicalRecord.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { hospitalId: 3, patient: { userId: 11 } } }));
    const detail = await service.record(90, actor);
    expect(detail.id).toBe(90);
    prisma.medicalRecord.findFirst.mockResolvedValueOnce(null as never);
    await expect(service.record(404, patient)).rejects.toThrow('Medical record not found');
    await expect(service.records({ ...actor, role: Role.PHARMACIST })).rejects.toThrow();
  });

  it('pages medical records by patient or doctor name and identifier without querying encrypted notes', async () => {
    const result = await service.recordsPage({ page: 3, pageSize: 5, q: 'Demo Patient' }, { ...actor, role: Role.HOSPITAL_ADMIN });
    expect(result).toMatchObject({ total: 1, page: 1, pageSize: 5, totalPages: 1, items: [{ id: 90 }] });
    expect(prisma.medicalRecord.count).toHaveBeenCalledWith({ where: expect.objectContaining({ hospitalId: 3, OR: [
      { patient: { user: { name: { contains: 'Demo Patient', mode: 'insensitive' } } } },
      { doctor: { user: { name: { contains: 'Demo Patient', mode: 'insensitive' } } } },
    ] }) });
    expect(prisma.medicalRecord.findMany).toHaveBeenLastCalledWith(expect.objectContaining({ skip: 0, take: 5 }));
  });

  it('creates signed prescriptions only after a record exists and scopes retrieval', async () => {
    const dto = { instructions: 'Demo instructions', items: [{ medicineName: 'Demo medicine', dosage: '1 tablet', frequency: 'Daily', duration: '7 days' }] };
    await expect(service.createPrescription(42, dto, actor)).rejects.toThrow('Save the medical record');
    prisma.appointment.findFirst.mockResolvedValueOnce({ ...appointment, record: { id: 90 } } as never);
    const result = await service.createPrescription(42, dto, actor);
    expect(result).toMatchObject({ id: 23, signed: true, instructions: 'Demo instructions' });
    const saved = prisma.prescription.create.mock.calls[0][0].data;
    expect(saved.signatureDigest).toMatch(/^[a-f0-9]{64}$/);
    await expect(service.createPrescription(42, { ...dto, items: [] }, actor)).rejects.toThrow('require 1 to 20 items');
    const patient = { ...actor, id: 11, role: Role.PATIENT };
    expect((await service.prescriptions(patient))[0].id).toBe(23);
    expect(prisma.prescription.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { hospitalId: 3, patient: { userId: 11 } } }));
    expect((await service.prescription(23, patient)).doctorName).toBe('Dr Demo');
    await expect(service.prescriptions({ ...actor, role: Role.NURSE })).rejects.toThrow();
  });

  it('filters the paged prescription queue by dispense state and medicine name', async () => {
    const patient = { ...actor, id: 11, role: Role.PATIENT };
    const result = await service.prescriptionsPage({ page: 1, pageSize: 10, q: 'Demo medicine', dispensed: false }, patient);
    expect(result.items).toHaveLength(1);
    expect(prisma.prescription.count).toHaveBeenCalledWith({ where: expect.objectContaining({ hospitalId: 3, patient: { userId: 11 }, dispense: { is: null }, OR: [
      { items: { some: { medicineName: { contains: 'Demo medicine', mode: 'insensitive' } } } },
      { patient: { user: { name: { contains: 'Demo medicine', mode: 'insensitive' } } } },
      { doctor: { user: { name: { contains: 'Demo medicine', mode: 'insensitive' } } } },
    ] }) });
    expect(prisma.prescription.findMany).toHaveBeenLastCalledWith(expect.objectContaining({ skip: 0, take: 10 }));
  });

  it('returns a signed prescription PDF and verifies attachment decryption on download', async () => {
    const pdf = await service.prescriptionPdf(23, actor);
    expect(pdf.subarray(0, 4).toString()).toBe('%PDF');
    const bytes = Buffer.from('%PDF-1.7 test attachment');
    prisma.clinicalAttachment.findFirst.mockResolvedValueOnce({ originalName: 'note.pdf', mimeType: 'application/pdf', encryptedContents: encryptClinicalBytes(bytes) } as never);
    const attachment = await service.attachment(5, actor);
    expect(attachment).toMatchObject({ name: 'note.pdf', mimeType: 'application/pdf', bytes });
    await expect(service.prescriptionPdf(404, { ...actor, role: Role.NURSE })).rejects.toThrow();
  });
});
