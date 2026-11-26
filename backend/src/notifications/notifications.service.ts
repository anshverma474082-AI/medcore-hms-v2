import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaService } from '../infra/prisma.service';
import { NotificationGateway } from './notification.gateway';
import type { AppointmentReminder } from '../appointments/reminder-rules';

export type AppointmentReminderDetails = {
  appointmentId: number;
  patientName: string;
  doctorName: string;
  email: string;
  phone: string;
  startsAt: Date;
};

@Injectable()
export class NotificationsService {
  constructor(private prisma: PrismaService, private gateway: NotificationGateway, @InjectQueue('outbound') private queue: Queue) {}

  async queueOtp(email: string, phone: string, code: string) {
    await this.queue.add('otp', { email, phone, code }, { attempts: 3, backoff: { type: 'exponential', delay: 1000 }, removeOnComplete: true });
  }

  async queuePasswordReset(email: string, code: string) {
    await this.queue.add('password-reset-code', { email, code }, { attempts: 3, backoff: { type: 'exponential', delay: 1000 }, removeOnComplete: true });
  }

  async queuePhoneOtp(phone: string, code: string) {
    await this.queue.add('phone-otp', { phone, code }, { attempts: 3, backoff: { type: 'exponential', delay: 1000 }, removeOnComplete: true });
  }

  async scheduleAppointmentReminders(details: AppointmentReminderDetails, reminders: AppointmentReminder[]) {
    await Promise.all(reminders.map((reminder) => this.queue.add('appointment-reminder', {
      ...details,
      reminderName: reminder.name,
      startsAt: details.startsAt.toISOString(),
    }, {
      jobId: `appointment-${details.appointmentId}-${reminder.name}`,
      delay: reminder.delayMs,
      attempts: 3,
      backoff: { type: 'exponential', delay: 30_000 },
      removeOnComplete: true,
    })));
  }

  async cancelAppointmentReminders(appointmentId: number) {
    const jobs = await Promise.all([
      this.queue.getJob(`appointment-${appointmentId}-24-hour`),
      this.queue.getJob(`appointment-${appointmentId}-1-hour`),
    ]);
    await Promise.all(jobs.filter((job): job is NonNullable<typeof job> => Boolean(job)).map((job) => job.remove().catch(() => undefined)));
  }

  async create(hospitalId: number, userId: number, category: string, title: string, body: string) {
    const item = await this.prisma.notification.create({ data: { hospitalId, userId, category, title, body } });
    this.gateway.publish(userId, { id: item.id, category, title, body, createdAt: item.createdAt.toISOString() });
    return item;
  }
}
