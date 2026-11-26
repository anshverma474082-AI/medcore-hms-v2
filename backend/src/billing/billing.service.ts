import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { InvoiceStatus, Prisma, Role } from '@prisma/client';
import Razorpay from 'razorpay';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { PrismaService } from '../infra/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { SessionUser } from '../security/current-user.decorator';
import { PageQueryDto } from '../common/pagination.dto';
import { pageResult, pageWindow } from '../common/pagination';
import { CreateInvoiceDto, VerifyPaymentDto } from './billing.dto';

@Injectable()
export class BillingService {
  constructor(private prisma: PrismaService, private notifications: NotificationsService) {}
  async createInvoice(appointmentId: number, dto: CreateInvoiceDto, actor: SessionUser) {
    if (!(new Set<Role>([Role.HOSPITAL_ADMIN, Role.RECEPTIONIST, Role.ACCOUNTANT])).has(actor.role as Role) || !actor.hospitalId) throw new ForbiddenException();
    if (!dto.items.length || dto.items.length > 30) throw new BadRequestException('Invoice must contain 1 to 30 lines');
    const appointment = await this.prisma.appointment.findFirst({ where: { id: appointmentId, hospitalId: actor.hospitalId } });
    if (!appointment) throw new NotFoundException('Appointment not found');
    const items = dto.items.map((line) => ({ description: line.description.trim(), quantity: line.quantity, unitMinor: line.unitAmountMinor, totalMinor: line.quantity * line.unitAmountMinor }));
    const amountMinor = items.reduce((sum, item) => sum + item.totalMinor, 0);
    if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0) throw new BadRequestException('Invoice total must be positive and within limits');
    const invoice = await this.prisma.invoice.create({ data: { hospitalId: actor.hospitalId, appointmentId, patientId: appointment.patientId, amountMinor, currency: (dto.currency || 'INR').toUpperCase(), items: { create: items } }, include: { items: true } });
    return this.out(invoice);
  }
  async list(actor: SessionUser) {
    const where = this.listWhere(actor);
    const invoices = await this.prisma.invoice.findMany({ where, include: { items: true }, orderBy: { createdAt: 'desc' }, take: 100 });
    return invoices.map((invoice) => this.out(invoice));
  }
  async listPage(query: PageQueryDto, actor: SessionUser) {
    const where = this.listWhere(actor);
    const status = query.status?.toUpperCase();
    if (status) {
      if (!Object.values(InvoiceStatus).includes(status as InvoiceStatus)) throw new BadRequestException('Invalid invoice status');
      where.status = status as InvoiceStatus;
    }
    const search = query.q?.trim();
    if (search) {
      const numericId = /^\\d+$/.test(search) ? Number(search) : undefined;
      where.OR = [
        { items: { some: { description: { contains: search, mode: 'insensitive' } } } },
        ...(numericId && Number.isSafeInteger(numericId) ? [{ id: numericId }] : []),
      ];
    }
    const total = await this.prisma.invoice.count({ where });
    const window = pageWindow(query, total);
    const rows = await this.prisma.invoice.findMany({ where, include: { items: true }, orderBy: { createdAt: 'desc' }, skip: window.skip, take: window.pageSize });
    return pageResult(rows.map((invoice) => this.out(invoice)), total, window);
  }
  private listWhere(actor: SessionUser): Prisma.InvoiceWhereInput {
    const where: Prisma.InvoiceWhereInput = { hospitalId: actor.hospitalId ?? -1 };
    if (actor.role === Role.PATIENT) where.patient = { userId: actor.id };
    else if (!(new Set<Role>([Role.HOSPITAL_ADMIN, Role.ACCOUNTANT, Role.RECEPTIONIST, Role.SUPER_ADMIN])).has(actor.role as Role)) throw new ForbiddenException();
    if (actor.role === Role.SUPER_ADMIN) delete where.hospitalId;
    return where;
  }
  async createOrder(invoiceId: number, actor: SessionUser) {
    const invoice = await this.prisma.invoice.findFirst({ where: { id: invoiceId, ...(actor.role === Role.SUPER_ADMIN ? {} : { hospitalId: actor.hospitalId ?? -1 }), ...(actor.role === Role.PATIENT ? { patient: { userId: actor.id } } : {}) }, include: { items: true } });
    if (!invoice) throw new NotFoundException('Invoice not found');
    if (actor.role !== Role.PATIENT) throw new ForbiddenException('Only the billed patient can pay this invoice');
    if ((new Set<InvoiceStatus>([InvoiceStatus.PAID, InvoiceStatus.REFUNDED])).has(invoice.status)) throw new ConflictException('Invoice has already been paid');
    const client = this.razorpay();
    const order = await client.orders.create({ amount: invoice.amountMinor, currency: invoice.currency, receipt: 'medcore-' + invoice.id + '-' + Date.now(), notes: { invoiceId: String(invoice.id), hospitalId: String(invoice.hospitalId) } });
    await this.prisma.invoice.update({ where: { id: invoice.id }, data: { gatewayOrderId: order.id, status: InvoiceStatus.PENDING } });
    return { keyId: process.env.RAZORPAY_KEY_ID, orderId: order.id, amount: order.amount, currency: order.currency, invoiceId: invoice.id, name: 'MedCore HMS' };
  }
  async verify(dto: VerifyPaymentDto, actor: SessionUser) {
    const invoice = await this.prisma.invoice.findFirst({ where: { gatewayOrderId: dto.orderId, hospitalId: actor.hospitalId ?? -1, patient: { userId: actor.id } } });
    if (!invoice) throw new NotFoundException('Payment order not found');
    const expected = createHmac('sha256', process.env.RAZORPAY_KEY_SECRET || '').update(dto.orderId + '|' + dto.paymentId).digest('hex');
    if (!process.env.RAZORPAY_KEY_SECRET || !safeEqual(expected, dto.signature)) throw new UnauthorizedException('Payment signature invalid');
    const payment = await this.razorpay().payments.fetch(dto.paymentId);
    if (payment.order_id !== dto.orderId || Number(payment.amount) !== invoice.amountMinor || String(payment.currency).toUpperCase() !== invoice.currency || payment.status !== 'captured') throw new BadRequestException('Payment provider has not confirmed this invoice payment');
    return this.recordPaid(invoice.id, dto.paymentId, invoice.amountMinor, invoice.currency);
  }
  async webhook(raw: Buffer | undefined, signature: string | undefined) {
    if (!raw || !process.env.RAZORPAY_WEBHOOK_SECRET) throw new ServiceUnavailableException('Razorpay webhook is not configured');
    const expected = createHmac('sha256', process.env.RAZORPAY_WEBHOOK_SECRET).update(raw).digest('hex');
    if (!signature || !safeEqual(expected, signature)) throw new UnauthorizedException('Invalid payment webhook signature');
    const event = JSON.parse(raw.toString('utf8'));
    if (event.event !== 'payment.captured' && event.event !== 'payment.failed') return { received: true, ignored: true };
    const payment = event.payload?.payment?.entity;
    if (!payment?.id || !payment?.order_id) throw new BadRequestException('Invalid payment event');
    const invoice = await this.prisma.invoice.findFirst({ where: { gatewayOrderId: payment.order_id } });
    if (!invoice || invoice.amountMinor !== Number(payment.amount) || invoice.currency !== String(payment.currency).toUpperCase()) throw new BadRequestException('Payment does not match an invoice');
    if (event.event === 'payment.failed') {
      await this.prisma.paymentEvent.upsert({ where: { providerEventId: 'razorpay:' + payment.id }, create: { invoiceId: invoice.id, provider: 'razorpay', providerEventId: 'razorpay:' + payment.id, outcome: 'failed', amountMinor: Number(payment.amount), currency: String(payment.currency).toUpperCase() }, update: {} });
      return { received: true, status: 'failed' };
    }
    const result = await this.recordPaid(invoice.id, payment.id, Number(payment.amount), String(payment.currency).toUpperCase());
    return { received: true, status: result.status };
  }
  private async recordPaid(invoiceId: number, paymentId: string, amountMinor: number, currency: string) {
    const result = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.paymentEvent.findUnique({ where: { providerEventId: 'razorpay:' + paymentId } });
      if (existing) return { invoiceId, status: existing.outcome, duplicate: true };
      const invoice = await tx.invoice.findUnique({ where: { id: invoiceId } });
      if (!invoice || invoice.amountMinor !== amountMinor || invoice.currency !== currency) throw new BadRequestException('Payment amount mismatch');
      await tx.paymentEvent.create({ data: { invoiceId, provider: 'razorpay', providerEventId: 'razorpay:' + paymentId, outcome: 'paid', amountMinor, currency } });
      await tx.invoice.update({ where: { id: invoiceId }, data: { status: InvoiceStatus.PAID, paidAt: new Date() } });
      return { invoiceId, status: 'paid', duplicate: false };
    });
    const invoice = await this.prisma.invoice.findUnique({ where: { id: invoiceId }, select: { hospitalId: true, patient: { select: { userId: true } } } });
    if (invoice && result.status === 'paid' && !result.duplicate) await this.notifications.create(invoice.hospitalId, invoice.patient.userId, 'payment', 'Payment received', 'Your invoice payment was confirmed.');
    return { invoiceId: result.invoiceId, status: result.status };
  }
  private razorpay() {
    const key_id = process.env.RAZORPAY_KEY_ID;
    const key_secret = process.env.RAZORPAY_KEY_SECRET;
    if (!key_id || !key_secret) throw new ServiceUnavailableException('Configure Razorpay test credentials to accept payments');
    return new Razorpay({ key_id, key_secret });
  }
  private out(invoice: any) { return { id: invoice.id, appointmentId: invoice.appointmentId, patientId: invoice.patientId, amountMinor: invoice.amountMinor, amount: invoice.amountMinor / 100, currency: invoice.currency, status: invoice.status.toLowerCase(), items: invoice.items, createdAt: invoice.createdAt.toISOString() }; }
}

function safeEqual(left: string, right: string) {
  const a = Buffer.from(left); const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}
