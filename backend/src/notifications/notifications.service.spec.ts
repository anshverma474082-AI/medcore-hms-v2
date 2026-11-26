jest.mock('@nestjs/common', () => ({ Injectable: () => (target: unknown) => target }));
jest.mock('@nestjs/bullmq', () => ({ InjectQueue: () => () => undefined }));
jest.mock('../infra/prisma.service', () => ({ PrismaService: class PrismaService {} }));
jest.mock('./notification.gateway', () => ({ NotificationGateway: class NotificationGateway {} }));
import { NotificationsService } from './notifications.service';

describe('NotificationsService', () => {
  const setup = () => {
    const prisma = { notification: { create: jest.fn(async () => ({ id: 5, createdAt: new Date('2026-11-26T10:00:00Z') })) } };
    const gateway = { publish: jest.fn() };
    const queue = {
      add: jest.fn(async () => undefined),
      getJob: jest.fn(async () => null),
    };
    return { service: new NotificationsService(prisma as never, gateway as never, queue as never), prisma, gateway, queue };
  };

  it('queues email, phone, password reset, and delayed appointment jobs', async () => {
    const { service, queue } = setup();
    await service.queueOtp('demo@example.test', '0000000000', '123456');
    await service.queuePasswordReset('demo@example.test', '654321');
    await service.queuePhoneOtp('0000000000', '345678');
    await service.scheduleAppointmentReminders({ appointmentId: 2, patientName: 'Patient', doctorName: 'Doctor', email: 'demo@example.test', phone: '0000000000', startsAt: new Date('2027-01-01T10:00:00Z') }, [{ name: '24-hour', delayMs: 60_000, offsetMs: 86_400_000 }, { name: '1-hour', delayMs: 3_600_000, offsetMs: 3_600_000 }]);
    expect(queue.add).toHaveBeenCalledTimes(5);
    expect(queue.add).toHaveBeenCalledWith('appointment-reminder', expect.objectContaining({ reminderName: '24-hour', startsAt: '2027-01-01T10:00:00.000Z' }), expect.objectContaining({ jobId: 'appointment-2-24-hour', delay: 60_000 }));
  });

  it('cancels existing reminders and tolerates missing or already removed jobs', async () => {
    const { service, queue } = setup();
    const job = { remove: jest.fn(async () => undefined) };
    queue.getJob.mockResolvedValueOnce(job as never).mockResolvedValueOnce(null as never);
    await service.cancelAppointmentReminders(9);
    expect(job.remove).toHaveBeenCalledTimes(1);
    expect(queue.getJob).toHaveBeenCalledWith('appointment-9-1-hour');
    const rejectedJob = { remove: jest.fn(async () => { throw new Error('already gone'); }) };
    queue.getJob.mockResolvedValueOnce(rejectedJob as never).mockResolvedValueOnce(null as never);
    await expect(service.cancelAppointmentReminders(10)).resolves.toBeUndefined();
  });

  it('stores and publishes notifications after persistence', async () => {
    const { service, prisma, gateway } = setup();
    const result = await service.create(7, 3, 'billing', 'Invoice ready', 'A demo invoice is ready.');
    expect(prisma.notification.create).toHaveBeenCalledWith({ data: { hospitalId: 7, userId: 3, category: 'billing', title: 'Invoice ready', body: 'A demo invoice is ready.' } });
    expect(gateway.publish).toHaveBeenCalledWith(3, { id: 5, category: 'billing', title: 'Invoice ready', body: 'A demo invoice is ready.', createdAt: '2026-11-26T10:00:00.000Z' });
    expect(result.id).toBe(5);
  });
});
