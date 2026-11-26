jest.mock('@nestjs/common', () => {
  class TestHttpException extends Error {}
  return { BadRequestException: TestHttpException, ForbiddenException: TestHttpException, Injectable: () => (target: unknown) => target, NotFoundException: TestHttpException };
});
jest.mock('../infra/prisma.service', () => ({ PrismaService: class PrismaService {} }));
import { Role } from '@prisma/client';
import { decryptClinicalText } from '../security/data-protection';
import { UsersService } from './users.service';

describe('UsersService patient profile', () => {
  const actor = { id: 8, name: 'Patient Demo', email: 'patient@example.test', role: Role.PATIENT, hospitalId: 3, sid: 'session' };
  const patient = { id: 21, userId: actor.id, hospitalId: actor.hospitalId, birthDateEncrypted: '', sexEncrypted: '', bloodGroupEncrypted: '', emergencyContactNameEncrypted: '', emergencyContactPhoneEncrypted: '', addressEncrypted: '' };
  const tx: { patient: { update: jest.Mock }; auditLog: { create: jest.Mock } } = {
    patient: { update: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({ ...patient, ...data })) },
    auditLog: { create: jest.fn(async () => ({ id: 1 })) },
  };
  const prisma = {
    patient: { findFirst: jest.fn(async () => patient) },
    $transaction: jest.fn(async (work: (txArg: any) => unknown) => work(tx)),
  };
  let service: UsersService;

  beforeAll(() => { process.env.CLINICAL_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64'); });
  beforeEach(() => { jest.clearAllMocks(); service = new UsersService(prisma as never); });

  it('stores emergency contact and address encrypted and returns readable values only to the patient', async () => {
    const result = await service.updatePatientProfile({ birthDate: '2000-01-02', sex: 'prefer_not_to_say', bloodGroup: 'O+', emergencyContactName: 'Trusted Contact', emergencyContactPhone: '+1 555 0100', address: '10 Example Road' }, actor);
    const saved = tx.patient.update.mock.calls[0][0].data;
    expect(saved.birthDateEncrypted).not.toContain('2000-01-02');
    expect(saved.sexEncrypted).not.toContain('prefer_not_to_say');
    expect(saved.bloodGroupEncrypted).not.toContain('O+');
    expect(saved.emergencyContactNameEncrypted).not.toContain('Trusted Contact');
    expect(saved.emergencyContactPhoneEncrypted).not.toContain('+1 555 0100');
    expect(saved.addressEncrypted).not.toContain('Example Road');
    expect(result).toEqual({ birthDate: '2000-01-02', sex: 'prefer_not_to_say', bloodGroup: 'O+', emergencyContactName: 'Trusted Contact', emergencyContactPhone: '+1 555 0100', address: '10 Example Road' });
    expect(decryptClinicalText(String(saved.addressEncrypted))).toBe('10 Example Road');
    expect(decryptClinicalText(String(saved.birthDateEncrypted))).toBe('2000-01-02');
    expect(tx.auditLog.create).toHaveBeenCalledWith({ data: { hospitalId: 3, userId: 8, action: 'UPDATE', entity: 'PatientProfile', entityId: 21 } });
  });

  it('limits profile lookup to the signed-in patient and refuses accounts without a patient profile', async () => {
    await service.patientProfile(actor);
    expect(prisma.patient.findFirst).toHaveBeenCalledWith({ where: { userId: 8, hospitalId: 3, deletedAt: null } });
    prisma.patient.findFirst.mockResolvedValueOnce(null as never);
    await expect(service.patientProfile(actor)).rejects.toThrow('Patient profile not found');
  });
});
