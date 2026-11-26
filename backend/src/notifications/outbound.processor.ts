import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { DeliveryService } from './delivery.service';
import { PrismaService } from '../infra/prisma.service';

@Processor('outbound')
export class OutboundProcessor extends WorkerHost {
  constructor(private delivery: DeliveryService, private prisma: PrismaService) { super(); }
  async process(job: Job<Record<string, unknown>>) {
    if (job.name === 'otp') {
      const email = String(job.data.email || '');
      const phone = String(job.data.phone || '');
      const code = String(job.data.code || '');
      const tasks: Promise<void>[] = [this.delivery.emailOtp(email, code)];
      if (phone) tasks.push(this.delivery.sms(phone, 'MedCore verification code: ' + code));
      await Promise.all(tasks);
      return;
    }

    if (job.name === 'password-reset-code') {
      await this.delivery.emailPasswordResetCode(String(job.data.email || ''), String(job.data.code || ''));
      return;
    }

    if (job.name === 'phone-otp') {
      await this.delivery.sms(String(job.data.phone || ''), 'MedCore phone verification code: ' + String(job.data.code || '') + '. It expires in 10 minutes.');
      return;
    }

    if (job.name === 'appointment-reminder') {
      const appointmentId = Number(job.data.appointmentId);
      const appointment = await this.prisma.appointment.findFirst({
        where: { id: appointmentId, deletedAt: null },
        select: { status: true },
      });
      if (!appointment || !['PENDING', 'CONFIRMED'].includes(appointment.status)) return;

      const patientName = String(job.data.patientName || 'Patient');
      const doctorName = String(job.data.doctorName || 'your doctor');
      const startsAt = new Date(String(job.data.startsAt));
      if (Number.isNaN(startsAt.getTime())) return;
      const reminderName = String(job.data.reminderName || 'appointment');
      const when = startsAt.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }) + ' UTC';
      const body = `Reminder: ${patientName}, your appointment with ${doctorName} is scheduled for ${when}.`;
      await this.delivery.appointmentReminder(String(job.data.email || ''), String(job.data.phone || ''), body, reminderName);
    }
  }
}
