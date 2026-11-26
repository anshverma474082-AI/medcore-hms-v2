import { AppointmentStatus, Role } from '@prisma/client';
import { canTransitionAppointment, findAvailableSlot } from './appointment-rules';

describe('appointment rules', () => {
  const monday = (hour: number, minute = 0) => new Date(Date.UTC(2026, 10, 23, hour, minute));
  const schedule = [{ weekday: 0, startMinute: 540, endMinute: 1020, slotMinutes: 30, active: true }];

  it('accepts a UTC slot aligned with the doctor schedule', () => {
    expect(findAvailableSlot(monday(9), schedule)?.slotMinutes).toBe(30);
  });
  it('rejects an off-boundary, inactive, wrong-weekday or out-of-range slot', () => {
    expect(findAvailableSlot(monday(9, 15), schedule)).toBeUndefined();
    expect(findAvailableSlot(monday(17), schedule)).toBeUndefined();
    expect(findAvailableSlot(new Date(Date.UTC(2026, 10, 24, 9)), schedule)).toBeUndefined();
    expect(findAvailableSlot(monday(9), [{ ...schedule[0], active: false }])).toBeUndefined();
    expect(findAvailableSlot(new Date('invalid'), schedule)).toBeUndefined();
  });
  it('accepts only role-appropriate appointment transitions', () => {
    expect(canTransitionAppointment(AppointmentStatus.PENDING, AppointmentStatus.CONFIRMED, Role.HOSPITAL_ADMIN)).toBe(true);
    expect(canTransitionAppointment(AppointmentStatus.CONFIRMED, AppointmentStatus.IN_PROGRESS, Role.DOCTOR)).toBe(true);
    expect(canTransitionAppointment(AppointmentStatus.IN_PROGRESS, AppointmentStatus.COMPLETED, Role.DOCTOR)).toBe(true);
    expect(canTransitionAppointment(AppointmentStatus.CONFIRMED, AppointmentStatus.NO_SHOW, Role.DOCTOR)).toBe(true);
    expect(canTransitionAppointment(AppointmentStatus.NO_SHOW, AppointmentStatus.IN_PROGRESS, Role.DOCTOR)).toBe(false);
    expect(canTransitionAppointment(AppointmentStatus.CONFIRMED, AppointmentStatus.NO_SHOW, Role.PATIENT)).toBe(false);
    expect(canTransitionAppointment(AppointmentStatus.PENDING, AppointmentStatus.COMPLETED, Role.DOCTOR)).toBe(false);
    expect(canTransitionAppointment(AppointmentStatus.COMPLETED, AppointmentStatus.CANCELLED, Role.HOSPITAL_ADMIN)).toBe(false);
    expect(canTransitionAppointment(AppointmentStatus.PENDING, AppointmentStatus.CONFIRMED, Role.PATIENT)).toBe(false);
  });
});
