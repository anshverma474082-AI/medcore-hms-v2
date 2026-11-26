import 'reflect-metadata';

jest.mock('@nestjs/common', () => {
  const decorator = () => () => undefined;
  class BadRequestException extends Error {}
  class NotFoundException extends Error {}
  return {
    Body: decorator, Controller: decorator, Get: decorator, Header: decorator, Headers: decorator, Param: decorator,
    ParseIntPipe: class ParseIntPipe {}, Patch: decorator, Post: decorator, Query: decorator,
    Req: decorator, Res: decorator, UploadedFile: decorator, UseInterceptors: decorator,
    BadRequestException, NotFoundException,
    StreamableFile: class StreamableFile { constructor(readonly value: unknown) {} },
  };
});
jest.mock('@nestjs/swagger', () => ({ ApiTags: () => () => undefined, ApiExcludeEndpoint: () => () => undefined }));
jest.mock('@nestjs/platform-express', () => ({ FileInterceptor: () => class FileInterceptor {} }));
jest.mock('./security/current-user.decorator', () => ({ CurrentUser: () => () => undefined }));
jest.mock('./security/roles.decorator', () => ({ Roles: () => () => undefined }));
jest.mock('./security/public.decorator', () => ({ Public: () => () => undefined }));
jest.mock('./appointments/appointments.service', () => ({ AppointmentsService: class AppointmentsService {} }));
jest.mock('./auth/auth.service', () => ({ AuthService: class AuthService {} }));
jest.mock('./billing/billing.service', () => ({ BillingService: class BillingService {} }));
jest.mock('./clinical/clinical.service', () => ({ ClinicalService: class ClinicalService {} }));
jest.mock('./hospitals/hospitals.service', () => ({ HospitalsService: class HospitalsService {} }));
jest.mock('./operations/operations.service', () => ({ OperationsService: class OperationsService {} }));
jest.mock('./users/users.service', () => ({ UsersService: class UsersService {} }));
jest.mock('./infra/prisma.service', () => ({ PrismaService: class PrismaService {} }));
jest.mock('./infra/redis.service', () => ({ RedisService: class RedisService {} }));

import { AppointmentStatus, Role } from '@prisma/client';
import { AppointmentsController } from './appointments/appointments.controller';
import { AuthController } from './auth/auth.controller';
import { BillingController } from './billing/billing.controller';
import { ClinicalController } from './clinical/clinical.controller';
import { HealthController } from './health.controller';
import { HospitalsController } from './hospitals/hospitals.controller';
import { NotificationsController } from './notifications/notifications.controller';
import { OperationsController } from './operations/operations.controller';
import { UsersController } from './users/users.controller';

function serviceStub() {
  return new Proxy({}, { get: (target, method: string) => Reflect.has(target, method) ? Reflect.get(target, method) : jest.fn(async (...args: unknown[]) => ({ method, args })) });
}

describe('HTTP controller adapters', () => {
  const user = { id: 5, name: 'Demo', email: 'demo@example.test', role: Role.DOCTOR, hospitalId: 7, sid: 's1' };

  it('routes appointment operations to the service and returns API envelopes', async () => {
    const service = serviceStub();
    const controller = new AppointmentsController(service as never);
    const dto = { doctorId: 4, startsAt: '2027-01-01T10:00:00Z' };
    expect((await controller.addAvailability(4, {} as never, user)).success).toBe(true);
    await controller.availability(4, user);
    await controller.book(dto, user);
    await controller.list(user);
    await controller.listPage({ page: 1, pageSize: 10 } as never, user);
    await controller.get(9, user);
    await controller.cancel(9, user);
    expect((await controller.updateStatus(9, { status: AppointmentStatus.CONFIRMED } as never, user)).message).toBe('Status updated');
  });

  it('routes registration, verification, session, and account calls through AuthController', async () => {
    const auth = {
      register: jest.fn(async (dto) => dto), verifyEmail: jest.fn(async () => undefined), requestPasswordReset: jest.fn(async () => undefined), resetPassword: jest.fn(async () => undefined),
      devPasswordResetCode: jest.fn(async () => ({ code: '123456' })), requestPhoneVerification: jest.fn(async () => ({ sent: true })), verifyPhone: jest.fn(async () => ({ phoneVerified: true })),
      devPhoneVerificationCode: jest.fn(async () => ({ code: '123456' })), devOtp: jest.fn(async () => ({ code: '123456' })), login: jest.fn(async () => ({ user, cookies: { accessToken: 'a', refreshToken: 'r' } })),
      refresh: jest.fn(async () => ({ user, cookies: { accessToken: 'a2', refreshToken: 'r2' } })), logout: jest.fn(async () => undefined), me: jest.fn(async () => user),
    };
    const controller = new AuthController(auth as never);
    const response = { cookie: jest.fn(), clearCookie: jest.fn() };
    expect((await controller.register({ email: 'demo@example.test' } as never)).success).toBe(true);
    await controller.verify({ email: user.email, otp: '123456' } as never);
    await controller.requestPasswordReset({ email: user.email } as never);
    await controller.confirmPasswordReset({ email: user.email, otp: '123456', password: 'NewPassword123!' } as never);
    await controller.devPasswordResetCode({ query: { email: user.email } } as never);
    await controller.requestPhoneVerification({ phone: '123' } as never, user);
    await controller.verifyPhone({ phone: '123', otp: '123456' } as never, user);
    await controller.devPhoneOtp(user);
    await controller.devOtp({ query: { email: user.email } } as never);
    expect(controller.csrf(response as never).success).toBe(true);
    await controller.login({ email: user.email, password: 'pw' } as never, response as never);
    await controller.refresh({ cookies: { refresh_token: 'r' } } as never, response as never);
    await controller.logout({ cookies: { refresh_token: 'r' } } as never, response as never);
    expect((await controller.me(user)).data).toBe(user);
    expect(response.cookie).toHaveBeenCalledTimes(5);
    expect(response.clearCookie).toHaveBeenCalledTimes(2);
  });

  it('routes invoice, payment verification, and webhook traffic', async () => {
    const service = serviceStub();
    const controller = new BillingController(service as never);
    await controller.create(3, {} as never, user);
    await controller.list(user);
    await controller.listPage({ page: 2 } as never, user);
    await controller.order(8, user);
    await controller.verify({ orderId: 'o', paymentId: 'p', signature: 's' }, user);
    expect((await controller.webhook({ rawBody: Buffer.from('{}') } as never, 'signature')).message).toBe('Webhook processed');
  });

  it('routes clinical record, attachment, and prescription download operations', async () => {
    const service = serviceStub() as any;
    service.attachment = jest.fn(async () => ({ name: 'note.pdf', mimeType: 'application/pdf', bytes: Buffer.from('%PDF-demo') }));
    service.prescriptionPdf = jest.fn(async () => Buffer.from('%PDF-demo'));
    const controller = new ClinicalController(service);
    const response = { setHeader: jest.fn() };
    await controller.createRecord(3, {} as never, user);
    await controller.records(user);
    await controller.recordsPage({ page: 1 } as never, user);
    await controller.record(5, user);
    await controller.addAttachment(5, { originalname: 'note.pdf', mimetype: 'application/pdf', size: 9, buffer: Buffer.from('%PDF-demo') }, user);
    await controller.attachments(5, user);
    expect(await controller.attachment(1, user, response as never)).toBeDefined();
    await controller.createPrescription(3, {} as never, user);
    await controller.prescriptions(user);
    await controller.prescriptionsPage({ page: 1 } as never, user);
    expect(await controller.pdf(2, user, response as never)).toBeDefined();
    await controller.prescription(2, user);
    expect(response.setHeader).toHaveBeenCalledWith('X-Content-Type-Options', 'nosniff');
  });

  it('routes hospital and staff administration calls', async () => {
    const hospitalService = serviceStub();
    const hospitals = new HospitalsController(hospitalService as never);
    await hospitals.create({} as never);
    await hospitals.verify(7);
    await hospitals.list(user);
    await hospitals.department({ name: 'Care' } as never, user);
    await hospitals.departments(7, user);
    const users = new UsersController(serviceStub() as never);
    await users.create({} as never, user);
    await users.list(user);
    await users.doctors(user);
    await users.me(user);
    await users.patientProfile(user);
    await users.updatePatientProfile({ address: 'demo' } as never, user);
    await users.get(9, user);
  });

  it('routes laboratory, pharmacy, notifications, and health checks', async () => {
    const operations = new OperationsController(serviceStub() as never);
    await operations.createLab(3, {} as never, user);
    await operations.labs(user);
    await operations.labsPage({ page: 1 } as never, user);
    await operations.result(3, {} as never, user);
    await operations.approve(3, user);
    await operations.medicine({} as never, user);
    await operations.medicines(user);
    await operations.medicinesPage({ page: 1 } as never, user);
    await operations.batch(2, {} as never, user);
    await operations.dispense(3, {} as never, user);
    const notifications = new NotificationsController({ notification: { findMany: jest.fn(async () => []), count: jest.fn(async () => 0), updateMany: jest.fn(async () => ({ count: 1 })) } } as never);
    await notifications.list(user);
    await notifications.listPage({ page: 1 } as never, user);
    await notifications.read(1, user);
    await notifications.hospitalFeed({ ...user, role: Role.HOSPITAL_ADMIN });
    await notifications.hospitalFeedPage({ page: 1 } as never, { ...user, role: Role.HOSPITAL_ADMIN });
    const health = new HealthController({ $queryRaw: jest.fn(async () => 1) } as never, { client: { ping: jest.fn(async () => 'PONG') } } as never);
    expect((await health.health()).data.status).toBe('ok');
  });
});
