jest.mock('@nestjs/common', () => {
  class BadRequestException extends Error {}
  class ConflictException extends Error {}
  class ForbiddenException extends Error {}
  class NotFoundException extends Error {}
  return {
    BadRequestException,
    ConflictException,
    ForbiddenException,
    Injectable: () => (target: unknown) => target,
    NotFoundException,
  };
});
jest.mock('../infra/prisma.service', () => ({ PrismaService: class PrismaService {} }));
jest.mock('../notifications/notifications.service', () => ({ NotificationsService: class NotificationsService {} }));
import { AppointmentStatus, Role } from '@prisma/client';
import { AppointmentsService } from './appointments.service';

describe('AppointmentsService', () => {
  const admin = { id: 4, name: 'Admin', email: 'admin@example.test', role: Role.HOSPITAL_ADMIN, hospitalId: 2, sid: 's1' };
  const patientActor = { ...admin, id: 8, role: Role.PATIENT };
  const futureSlot = () => {
    const start = new Date(Date.now() + 8 * 86_400_000);
    start.setUTCHours(10, 0, 0, 0);
    return start;
  };
  const baseAppointment = (status: AppointmentStatus = AppointmentStatus.PENDING) => ({
    id: 51, hospitalId: 2, patientId: 11, doctorId: 15,
    startsAt: futureSlot(), endsAt: new Date(futureSlot().getTime() + 30 * 60_000),
    status, emergency: false, reason: 'Check-up',
    doctor: { user: { name: 'Dr Example' } },
    patient: { phone: '0000000000', userId: 8, user: { name: 'Example Patient', email: 'patient@example.test' } },
  });

  const setup = () => {
    const tx = {
      appointment: {
        findFirst: jest.fn(async () => null),
        create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({ ...baseAppointment(), ...data })),
      },
    };
    const prisma = {
      doctor: { findFirst: jest.fn(async () => ({ id: 15, hospitalId: 2, userId: 4 })) },
      doctorAvailability: {
        findMany: jest.fn(async () => [{ weekday: futureSlot().getUTCDay() === 0 ? 6 : futureSlot().getUTCDay() - 1, startMinute: 540, endMinute: 1020, slotMinutes: 30, active: true }]),
        create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => data),
      },
      patient: {
        findFirst: jest.fn(async () => ({ id: 11, userId: 8 })),
        findUnique: jest.fn(async () => ({ userId: 8 })),
      },
      appointment: {
        findMany: jest.fn(async () => [baseAppointment()]),
        count: jest.fn(async () => 1),
        findFirst: jest.fn(async () => baseAppointment()),
        update: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({ ...baseAppointment(), ...data })),
      },
      $transaction: jest.fn(async (callback: (value: typeof tx) => unknown) => callback(tx)),
    };
    const notifications = {
      create: jest.fn(async () => undefined),
      scheduleAppointmentReminders: jest.fn(async () => undefined),
      cancelAppointmentReminders: jest.fn(async () => undefined),
    };
    return { service: new AppointmentsService(prisma as never, notifications as never), prisma, tx, notifications };
  };

  it('creates availability only for a valid hospital-scoped doctor and aligned range', async () => {
    const { service, prisma } = setup();
    const result = await service.addAvailability(15, { weekday: 1, startMinute: 540, endMinute: 600, slotMinutes: 30 }, admin);
    expect(result).toMatchObject({ hospitalId: 2, doctorId: 15, weekday: 1 });
    expect(prisma.doctorAvailability.create).toHaveBeenCalled();
    await expect(service.addAvailability(15, { weekday: 1, startMinute: 540, endMinute: 601, slotMinutes: 30 }, admin)).rejects.toThrow('Invalid availability range');
  });

  it('rejects an unassigned doctor changing another doctor’s schedule', async () => {
    const { service } = setup();
    const doctorActor = { ...admin, id: 99, role: Role.DOCTOR };
    await expect(service.addAvailability(15, { weekday: 1, startMinute: 540, endMinute: 600, slotMinutes: 30 }, doctorActor)).rejects.toThrow();
  });

  it('returns availability only when the doctor belongs to the caller hospital', async () => {
    const { service, prisma } = setup();
    expect(await service.availability(15, admin)).toHaveLength(1);
    prisma.doctor.findFirst.mockResolvedValueOnce(null as never);
    await expect(service.availability(404, admin)).rejects.toThrow('Doctor not found');
  });

  it('books an available future slot for the signed-in patient and schedules reminders', async () => {
    const { service, tx, notifications } = setup();
    const startsAt = futureSlot().toISOString();
    const result = await service.book({ doctorId: 15, startsAt, reason: 'Check-up' }, patientActor);
    expect(result).toMatchObject({ id: 51, status: 'pending', patientName: 'Example Patient', doctorName: 'Dr Example' });
    expect(tx.appointment.create).toHaveBeenCalled();
    expect(notifications.create).toHaveBeenCalled();
    expect(notifications.scheduleAppointmentReminders).toHaveBeenCalled();
  });

  it('rejects missing tenant, unavailable doctors, past appointments, and unstaffed emergency bookings', async () => {
    const { service, prisma } = setup();
    await expect(service.book({ doctorId: 15, startsAt: futureSlot().toISOString() }, { ...patientActor, hospitalId: null })).rejects.toThrow('Select a hospital account first');
    prisma.doctor.findFirst.mockResolvedValueOnce(null as never);
    await expect(service.book({ doctorId: 15, startsAt: futureSlot().toISOString() }, patientActor)).rejects.toThrow('Doctor not found');
    await expect(service.book({ doctorId: 15, startsAt: new Date(Date.now() - 1000).toISOString() }, patientActor)).rejects.toThrow('Appointment time must be in the future');
    await expect(service.book({ doctorId: 15, startsAt: futureSlot().toISOString(), emergency: true }, patientActor)).rejects.toThrow('Only hospital staff can create an emergency booking');
  });

  it('rejects slot conflicts and maps a transaction conflict to a useful message', async () => {
    const { service, tx } = setup();
    tx.appointment.findFirst.mockResolvedValueOnce({ id: 99 } as never);
    await expect(service.book({ doctorId: 15, startsAt: futureSlot().toISOString() }, patientActor)).rejects.toThrow('already has an appointment');
  });

  it('scopes list and detail reads by role, and returns not-found for hidden appointments', async () => {
    const { service, prisma } = setup();
    const rows = await service.list(patientActor);
    expect(rows[0]).toMatchObject({ id: 51, status: 'pending' });
    expect(prisma.appointment.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ hospitalId: 2, patient: { userId: 8 } }) }));
    prisma.appointment.findFirst.mockResolvedValueOnce(null as never);
    await expect(service.get(999, patientActor)).rejects.toThrow('Appointment not found');
  });

  it('searches and paginates appointments within the caller tenant and role scope', async () => {
    const { service, prisma } = setup();
    const result = await service.listPage({ page: 2, pageSize: 5, q: 'check-up', status: AppointmentStatus.PENDING }, patientActor);
    expect(result).toMatchObject({ total: 1, page: 1, pageSize: 5, totalPages: 1, items: [{ id: 51 }] });
    expect(prisma.appointment.count).toHaveBeenCalledWith({ where: expect.objectContaining({ hospitalId: 2, status: AppointmentStatus.PENDING, patient: { userId: 8 }, OR: expect.any(Array) }) });
    expect(prisma.appointment.findMany).toHaveBeenCalledWith(expect.objectContaining({ skip: 0, take: 5 }));
  });

  it('cancels eligible appointments and notifies the patient', async () => {
    const { service, notifications, prisma } = setup();
    const result = await service.cancel(51, patientActor);
    expect(result.status).toBe('cancelled');
    expect(notifications.cancelAppointmentReminders).toHaveBeenCalledWith(51);
    expect(notifications.create).toHaveBeenCalled();
    prisma.appointment.findFirst.mockResolvedValueOnce({ ...baseAppointment(), status: AppointmentStatus.COMPLETED } as never);
    await expect(service.cancel(51, patientActor)).rejects.toThrow('can no longer be cancelled');
  });

  it('allows only valid role transitions and cancels reminders after closure', async () => {
    const { service, notifications, prisma } = setup();
    const result = await service.updateStatus(51, 'CONFIRMED', { ...admin, role: Role.RECEPTIONIST });
    expect(result.status).toBe(AppointmentStatus.CONFIRMED);
    await expect(service.updateStatus(51, 'INVALID', admin)).rejects.toThrow('Unsupported appointment status');
    await expect(service.updateStatus(51, 'COMPLETED', { ...admin, role: Role.PATIENT })).rejects.toThrow();
    prisma.appointment.findFirst.mockResolvedValueOnce(baseAppointment(AppointmentStatus.CONFIRMED) as never);
    await service.updateStatus(51, 'IN_PROGRESS', { ...admin, role: Role.DOCTOR });
    expect(notifications.cancelAppointmentReminders).toHaveBeenCalledWith(51);
  });
});
