import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class DeliveryService {
  private readonly logger = new Logger(DeliveryService.name);

  async emailOtp(to: string, code: string) {
    await this.sendEmail(to, 'Your MedCore verification code', 'Your MedCore verification code is ' + code + '. It expires in 10 minutes.');
  }

  async emailPasswordResetCode(to: string, code: string) {
    await this.sendEmail(to, 'Reset your MedCore password', 'Your MedCore password reset code is ' + code + '. It expires in 10 minutes. If you did not request this, you can ignore this email.');
  }

  async appointmentReminder(email: string, phone: string, body: string, reminderName: string) {
    const tasks: Promise<void>[] = [];
    if (email) tasks.push(this.sendEmail(email, 'MedCore appointment reminder', body));
    if (phone) tasks.push(this.sms(phone, body));
    if (!tasks.length) this.logger.warn('Appointment reminder has no delivery address (' + reminderName + ')');
    await Promise.all(tasks);
  }

  private async sendEmail(to: string, subject: string, text: string) {
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) {
      if (process.env.NODE_ENV === 'production') throw new Error('RESEND_API_KEY is required in production');
      this.logger.debug('Email delivery is not configured in local development');
      return;
    }
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: process.env.EMAIL_FROM || 'MedCore <onboarding@resend.dev>',
        to: [to],
        subject,
        text,
      }),
    });
    if (!response.ok) throw new Error('Email provider returned status ' + response.status);
  }

  async sms(to: string, body: string) {
    const { TWILIO_ACCOUNT_SID: sid, TWILIO_AUTH_TOKEN: token, TWILIO_FROM: from } = process.env;
    if (!sid || !token || !from) {
      if (process.env.NODE_ENV === 'production') throw new Error('Twilio credentials are required for SMS');
      this.logger.debug('SMS is not configured in local development');
      return;
    }
    const auth = Buffer.from(sid + ':' + token).toString('base64');
    const form = new URLSearchParams({ To: to, From: from, Body: body });
    const response = await fetch('https://api.twilio.com/2010-04-01/Accounts/' + sid + '/Messages.json', {
      method: 'POST', headers: { Authorization: 'Basic ' + auth, 'Content-Type': 'application/x-www-form-urlencoded' }, body: form,
    });
    if (!response.ok) throw new Error('SMS provider returned status ' + response.status);
  }
}
