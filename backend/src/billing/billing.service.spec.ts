jest.mock('@nestjs/common', () => {
  class BadRequestException extends Error {}
  class ConflictException extends Error {}
  class ForbiddenException extends Error {}
  class NotFoundException extends Error {}
  class ServiceUnavailableException extends Error {}
  class UnauthorizedException extends Error {}
  return {
    BadRequestException,
    ConflictException,
    ForbiddenException,
    Injectable: () => (target: unknown) => target,
    NotFoundException,
    ServiceUnavailableException,
    UnauthorizedException,
  };
});
jest.mock('../infra/prisma.service', () => ({ PrismaService: class PrismaService {} }));
jest.mock('../notifications/notifications.service', () => ({ NotificationsService: class NotificationsService {} }));
import { BadRequestException, ForbiddenException, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { InvoiceStatus, Role } from '@prisma/client';
import { createHmac } from 'node:crypto';
import { BillingService } from './billing.service';

describe('BillingService', () => {
  const admin = { id: 3, name: 'Accountant', email: 'accounts@example.test', role: Role.ACCOUNTANT, hospitalId: 7, sid: 's1' };
  const patient = { id: 9, name: 'Patient', email: 'patient@example.test', role: Role.PATIENT, hospitalId: 7, sid: 's2' };
  const invoice = { id: 22, hospitalId: 7, appointmentId: 31, patientId: 9, amountMinor: 25000, currency: 'INR', status: InvoiceStatus.PENDING, items: [], createdAt: new Date('2026-11-26T10:00:00Z') };

  const setup = () => {
    const tx = {
      paymentEvent: { findUnique: jest.fn(async () => null), create: jest.fn(async () => undefined), upsert: jest.fn(async () => undefined) },
      invoice: { findUnique: jest.fn(async () => ({ amountMinor: 25000, currency: 'INR' })), update: jest.fn(async () => undefined) },
    };
    const prisma = {
      appointment: { findFirst: jest.fn(async () => ({ id: 31, hospitalId: 7, patientId: 9 })) },
      invoice: {
        create: jest.fn(async ({ data }: { data: Record<string, any> }) => ({ ...invoice, ...data, items: data.items.create })),
        findMany: jest.fn(async () => [invoice]),
        count: jest.fn(async () => 21),
        findFirst: jest.fn(async () => invoice),
        findUnique: jest.fn(async () => ({ hospitalId: 7, patient: { userId: 9 } })),
        update: jest.fn(async () => undefined),
      },
      paymentEvent: { upsert: jest.fn(async () => undefined) },
      $transaction: jest.fn(async (callback: (value: typeof tx) => unknown) => callback(tx)),
    };
    const notifications = { create: jest.fn(async () => undefined) };
    return { service: new BillingService(prisma as never, notifications as never), prisma, tx, notifications };
  };

  afterEach(() => {
    delete process.env.RAZORPAY_KEY_ID;
    delete process.env.RAZORPAY_KEY_SECRET;
    delete process.env.RAZORPAY_WEBHOOK_SECRET;
  });

  it('creates an invoice with normalized currency and computed line totals', async () => {
    const { service, prisma } = setup();
    const result = await service.createInvoice(31, { currency: 'inr', items: [{ description: ' Consultation ', quantity: 2, unitAmountMinor: 12500 }] }, admin);
    expect(result).toMatchObject({ amountMinor: 25000, amount: 250, currency: 'INR' });
    expect(prisma.invoice.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ amountMinor: 25000, currency: 'INR' }) }));
  });

  it('rejects invoice access, empty lines, unknown appointments, and unsafe totals', async () => {
    const { service, prisma } = setup();
    await expect(service.createInvoice(31, { items: [{ description: 'Visit', quantity: 1, unitAmountMinor: 100 } ] }, patient)).rejects.toThrow(ForbiddenException);
    await expect(service.createInvoice(31, { items: [] }, admin)).rejects.toThrow(BadRequestException);
    prisma.appointment.findFirst.mockResolvedValueOnce(null as never);
    await expect(service.createInvoice(404, { items: [{ description: 'Visit', quantity: 1, unitAmountMinor: 100 }] }, admin)).rejects.toThrow('Appointment not found');
    await expect(service.createInvoice(31, { items: [{ description: 'Visit', quantity: 1, unitAmountMinor: 0 }] }, admin)).rejects.toThrow('Invoice total must be positive');
  });

  it('lists only caller-authorized invoices and rejects unsupported roles', async () => {
    const { service, prisma } = setup();
    expect(await service.list(patient)).toHaveLength(1);
    expect(prisma.invoice.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { hospitalId: 7, patient: { userId: 9 } } }));
    await expect(service.list({ ...admin, role: Role.DOCTOR })).rejects.toThrow(ForbiddenException);
  });

  it('searches, filters, and pages invoices while keeping hospital scope', async () => {
    const { service, prisma } = setup();
    const result = await service.listPage({ page: 2, pageSize: 10, q: 'consult', status: 'pending' }, admin);
    expect(result).toMatchObject({ total: 21, page: 2, pageSize: 10, totalPages: 3, items: [{ id: 22 }] });
    expect(prisma.invoice.count).toHaveBeenCalledWith({ where: {
      hospitalId: 7,
      status: InvoiceStatus.PENDING,
      OR: [{ items: { some: { description: { contains: 'consult', mode: 'insensitive' } } } }],
    } });
    expect(prisma.invoice.findMany).toHaveBeenLastCalledWith(expect.objectContaining({ skip: 10, take: 10 }));
    await expect(service.listPage({ page: 1, pageSize: 10, status: 'not-a-status' }, admin)).rejects.toThrow('Invalid invoice status');
  });

  it('does not create payment orders without configured test credentials', async () => {
    const { service } = setup();
    await expect(service.createOrder(22, patient)).rejects.toThrow(ServiceUnavailableException);
    await expect(service.createOrder(22, admin)).rejects.toThrow('Only the billed patient can pay');
  });

  it('rejects invalid payment verification and unconfigured or invalid webhooks', async () => {
    const { service } = setup();
    await expect(service.verify({ orderId: 'order_1', paymentId: 'pay_1', signature: 'bad' }, patient)).rejects.toThrow(UnauthorizedException);
    await expect(service.webhook(Buffer.from('{}'), 'bad')).rejects.toThrow(ServiceUnavailableException);
    process.env.RAZORPAY_WEBHOOK_SECRET = 'a-secret-for-webhook-tests';
    await expect(service.webhook(Buffer.from('{}'), 'bad')).rejects.toThrow(UnauthorizedException);
  });

  it('ignores unrelated valid webhook events and records failed payment events', async () => {
    const { service, prisma } = setup();
    process.env.RAZORPAY_WEBHOOK_SECRET = 'a-secret-for-webhook-tests';
    const sign = (body: string) => createHmac('sha256', process.env.RAZORPAY_WEBHOOK_SECRET!).update(body).digest('hex');
    const ignored = Buffer.from(JSON.stringify({ event: 'payment.authorized' }));
    expect(await service.webhook(ignored, sign(ignored.toString()))).toMatchObject({ received: true, ignored: true });
    const failed = Buffer.from(JSON.stringify({ event: 'payment.failed', payload: { payment: { entity: { id: 'pay_failed', order_id: 'order_1', amount: 25000, currency: 'INR' } } } }));
    expect(await service.webhook(failed, sign(failed.toString()))).toMatchObject({ received: true, status: 'failed' });
    expect(prisma.paymentEvent.upsert).toHaveBeenCalled();
  });

  it('records captured payments exactly once and avoids duplicate notifications on webhook retry', async () => {
    const { service, prisma, tx, notifications } = setup();
    process.env.RAZORPAY_WEBHOOK_SECRET = 'a-secret-for-webhook-tests';
    const body = Buffer.from(JSON.stringify({ event: 'payment.captured', payload: { payment: { entity: { id: 'pay_ok', order_id: 'order_1', amount: 25000, currency: 'INR' } } } }));
    const signature = createHmac('sha256', process.env.RAZORPAY_WEBHOOK_SECRET).update(body).digest('hex');
    expect(await service.webhook(body, signature)).toEqual({ received: true, status: 'paid' });
    expect(tx.paymentEvent.create).toHaveBeenCalled();
    expect(tx.invoice.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: InvoiceStatus.PAID }) }));
    expect(notifications.create).toHaveBeenCalledTimes(1);

    tx.paymentEvent.findUnique.mockResolvedValueOnce({ outcome: 'paid' } as never);
    expect(await service.webhook(body, signature)).toEqual({ received: true, status: 'paid' });
    expect(prisma.invoice.findUnique).toHaveBeenCalledTimes(2);
    expect(notifications.create).toHaveBeenCalledTimes(1);
  });
});
