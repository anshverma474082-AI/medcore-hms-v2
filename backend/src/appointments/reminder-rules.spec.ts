import { appointmentReminders } from './reminder-rules';

describe('appointment reminder schedule', () => {
  const now = new Date('2026-11-26T12:00:00.000Z');

  it('schedules both reminders at the 24-hour boundary', () => {
    expect(appointmentReminders(new Date('2026-11-27T12:00:00.000Z'), now).map(({ name, delayMs }) => [name, delayMs]))
      .toEqual([['24-hour', 0], ['1-hour', 23 * 60 * 60 * 1000]]);
  });

  it('schedules only a future one-hour reminder for a near appointment', () => {
    expect(appointmentReminders(new Date('2026-11-26T14:00:00.000Z'), now).map(({ name, delayMs }) => [name, delayMs]))
      .toEqual([['1-hour', 60 * 60 * 1000]]);
  });

  it('does not schedule reminders after their delivery time or for invalid dates', () => {
    expect(appointmentReminders(new Date('2026-11-26T12:30:00.000Z'), now)).toEqual([]);
    expect(appointmentReminders(new Date('invalid'), now)).toEqual([]);
  });
});
