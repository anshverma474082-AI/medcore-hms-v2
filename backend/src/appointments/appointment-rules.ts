import { AppointmentStatus, Role } from '@prisma/client';

export type AvailabilitySlot = { weekday: number; startMinute: number; endMinute: number; slotMinutes: number; active?: boolean };

export function findAvailableSlot(start: Date, schedules: AvailabilitySlot[]): AvailabilitySlot | undefined {
  if (Number.isNaN(start.getTime()) || start.getUTCSeconds() !== 0 || start.getUTCMilliseconds() !== 0) return undefined;
  const weekday = start.getUTCDay() === 0 ? 6 : start.getUTCDay() - 1;
  const minute = start.getUTCHours() * 60 + start.getUTCMinutes();
  return schedules.find((slot) => slot.active !== false && slot.weekday === weekday && minute >= slot.startMinute &&
    minute + slot.slotMinutes <= slot.endMinute && (minute - slot.startMinute) % slot.slotMinutes === 0);
}

export function canTransitionAppointment(from: AppointmentStatus, to: AppointmentStatus, role: Role): boolean {
  const transitions: Record<AppointmentStatus, readonly AppointmentStatus[]> = {
    PENDING: [AppointmentStatus.CONFIRMED, AppointmentStatus.CANCELLED],
    CONFIRMED: [AppointmentStatus.IN_PROGRESS, AppointmentStatus.CANCELLED, AppointmentStatus.NO_SHOW],
    IN_PROGRESS: [AppointmentStatus.COMPLETED],
    COMPLETED: [],
    CANCELLED: [],
    NO_SHOW: [],
  };
  const roleAllowed: AppointmentStatus[] = role === Role.DOCTOR
    ? [AppointmentStatus.IN_PROGRESS, AppointmentStatus.COMPLETED, AppointmentStatus.NO_SHOW]
    : role === Role.HOSPITAL_ADMIN || role === Role.RECEPTIONIST
      ? [AppointmentStatus.CONFIRMED, AppointmentStatus.CANCELLED]
      : [];
  return transitions[from].includes(to) && roleAllowed.includes(to);
}
