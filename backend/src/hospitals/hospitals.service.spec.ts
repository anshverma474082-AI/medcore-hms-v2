jest.mock('@nestjs/common', () => {
  class BadRequestException extends Error {}
  class ForbiddenException extends Error {}
  class NotFoundException extends Error {}
  return { BadRequestException, ForbiddenException, NotFoundException, Injectable: () => (target: unknown) => target };
});
jest.mock('../infra/prisma.service', () => ({ PrismaService: class PrismaService {} }));
import { Role } from '@prisma/client';
import { HospitalsService } from './hospitals.service';

describe('HospitalsService', () => {
  const admin = { id: 1, name: 'Admin', email: 'admin@example.test', role: Role.HOSPITAL_ADMIN, hospitalId: 7, sid: 's1' };
  const setup = () => {
    const tx = {
      hospital: { create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: 7, ...data, verified: false })) },
      user: { create: jest.fn(async () => undefined) },
    };
    const prisma = {
      user: { findUnique: jest.fn(async () => null) },
      hospital: {
        updateMany: jest.fn(async () => ({ count: 1 })),
        findUnique: jest.fn(async () => ({ id: 7, name: 'City', code: 'CITY', verified: true })),
        findMany: jest.fn(async () => [{ id: 7, name: 'City', code: 'CITY', verified: true }]),
      },
      department: { create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => data), findMany: jest.fn(async () => []) },
      $transaction: jest.fn(async (callback: (value: typeof tx) => unknown) => callback(tx)),
    };
    return { service: new HospitalsService(prisma as never), prisma, tx };
  };

  beforeAll(() => { process.env.BCRYPT_ROUNDS = '4'; });
  afterAll(() => { delete process.env.BCRYPT_ROUNDS; });

  it('creates a hospital with a normalized admin account', async () => {
    const { service, prisma, tx } = setup();
    const result = await service.create({ name: ' City Hospital ', code: 'city-1', adminName: ' Admin User ', adminEmail: 'ADMIN@CITY.TEST', adminPassword: 'long-demo-password' });
    expect(result).toMatchObject({ id: 7, name: 'City Hospital', code: 'CITY-1', verified: false });
    expect(prisma.user.findUnique).toHaveBeenCalledWith({ where: { email: 'admin@city.test' } });
    expect(tx.user.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ email: 'admin@city.test', name: 'Admin User', role: Role.HOSPITAL_ADMIN }) }));
  });

  it('rejects duplicate admin email and returns not-found for missing verification targets', async () => {
    const { service, prisma } = setup();
    prisma.user.findUnique.mockResolvedValueOnce({ id: 2 } as never);
    await expect(service.create({ name: 'Hospital', code: 'H1', adminName: 'Admin', adminEmail: 'taken@example.test', adminPassword: 'long-demo-password' })).rejects.toThrow('already registered');
    prisma.hospital.updateMany.mockResolvedValueOnce({ count: 0 } as never);
    await expect(service.verify(99)).rejects.toThrow('Hospital not found');
  });

  it('scopes hospital and department reads and requires tenant context to create departments', async () => {
    const { service, prisma } = setup();
    await service.list(admin);
    expect(prisma.hospital.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 7 } }));
    await service.list({ ...admin, role: Role.SUPER_ADMIN, hospitalId: null });
    expect(prisma.hospital.findMany).toHaveBeenLastCalledWith(expect.objectContaining({ where: {} }));
    await expect(service.createDepartment({ ...admin, hospitalId: null }, { name: 'Cardiology' })).rejects.toThrow();
    await expect(service.departments(admin, 999)).rejects.toThrow('Hospital not found');
    await service.departments({ ...admin, role: Role.SUPER_ADMIN, hospitalId: null }, 7);
  });
});
