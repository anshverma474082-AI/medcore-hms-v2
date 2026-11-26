export type AppointmentReminder = { name: '24-hour' | '1-hour'; offsetMs: number; delayMs: number };

const reminderOffsets: Array<{ name: AppointmentReminder['name']; offsetMs: number }> = [
  { name: '24-hour', offsetMs: 24 * 60 * 60 * 1000 },
  { name: '1-hour', offsetMs: 60 * 60 * 1000 },
];

export function appointmentReminders(startsAt: Date, now = new Date()): AppointmentReminder[] {
  if (Number.isNaN(startsAt.getTime()) || Number.isNaN(now.getTime())) return [];
  return reminderOffsets.flatMap(({ name, offsetMs }) => {
    const delayMs = startsAt.getTime() - now.getTime() - offsetMs;
    return delayMs >= 0 ? [{ name, offsetMs, delayMs }] : [];
  });
}
