import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { AppointmentStatus, Role, Prisma } from '@prisma/client';
import { PrismaService } from '../infra/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { SessionUser } from '../security/current-user.decorator';
import { AppointmentListQueryDto, AvailabilityDto, BookAppointmentDto } from './appointments.dto';
import { canTransitionAppointment, findAvailableSlot } from './appointment-rules';
import { appointmentReminders } from './reminder-rules';

const activeStatuses: AppointmentStatus[] = [AppointmentStatus.PENDING, AppointmentStatus.CONFIRMED, AppointmentStatus.IN_PROGRESS];

@Injectable()
export class AppointmentsService {
  constructor(private prisma: PrismaService, private notifications: NotificationsService) {}
  async addAvailability(doctorId: number, dto: AvailabilityDto, actor: SessionUser) {
    const hospitalId = actor.hospitalId;
    if (!hospitalId || dto.startMinute >= dto.endMinute || (dto.endMinute - dto.startMinute) % dto.slotMinutes !== 0) throw new BadRequestException('Invalid availability range');
    const doctor = await this.prisma.doctor.findFirst({ where: { id: doctorId, hospitalId, deletedAt: null } });
    if (!doctor) throw new NotFoundException('Doctor not found');
    if (actor.role === Role.DOCTOR && doctor.userId !== actor.id) throw new ForbiddenException();
    return this.prisma.doctorAvailability.create({ data: { hospitalId, doctorId, weekday: dto.weekday, startMinute: dto.startMinute, endMinute: dto.endMinute, slotMinutes: dto.slotMinutes } });
  }
  async availability(doctorId: number, actor: SessionUser) {
    const doctor = await this.prisma.doctor.findFirst({ where: { id: doctorId, hospitalId: actor.hospitalId ?? undefined, deletedAt: null } });
    if (!doctor) throw new NotFoundException('Doctor not found');
    return this.prisma.doctorAvailability.findMany({ where: { doctorId, hospitalId: doctor.hospitalId, active: true }, orderBy: [{ weekday: 'asc' }, { startMinute: 'asc' }] });
  }
  async book(dto: BookAppointmentDto, actor: SessionUser) {
    const hospitalId = actor.hospitalId;
    if (!hospitalId) throw new ForbiddenException('Select a hospital account first');
    const doctor = await this.prisma.doctor.findFirst({ where: { id: dto.doctorId, hospitalId, deletedAt: null, user: { isActive: true, deletedAt: null } } });
    if (!doctor) throw new NotFoundException('Doctor not found');
    let patientId = dto.patientId;
    if (actor.role === Role.PATIENT) {
      const patient = await this.prisma.patient.findFirst({ where: { userId: actor.id, hospitalId, deletedAt: null } });
      if (!patient) throw new ForbiddenException('Patient profile unavailable');
      patientId = patient.id;
    } else if (!(new Set<Role>([Role.HOSPITAL_ADMIN, Role.RECEPTIONIST, Role.SUPER_ADMIN])).has(actor.role as Role) || !patientId) throw new ForbiddenException('A patient can book their own appointment');
    const patient = await this.prisma.patient.findFirst({ where: { id: patientId, hospitalId, deletedAt: null } });
    if (!patient) throw new NotFoundException('Patient not found');
    const start = new Date(dto.startsAt);
    if (Number.isNaN(start.getTime()) || start <= new Date()) throw new BadRequestException('Appointment time must be in the future');
    const isEmergency = dto.emergency === true;
    if (isEmergency && !new Set<Role>([Role.HOSPITAL_ADMIN, Role.RECEPTIONIST]).has(actor.role as Role)) {
      throw new ForbiddenException('Only hospital staff can create an emergency booking');
    }
    const schedule = isEmergency ? [] : await this.prisma.doctorAvailability.findMany({ where: { doctorId: doctor.id, hospitalId, active: true } });
    const availability = isEmergency ? undefined : findAvailableSlot(start, schedule);
    if (!isEmergency && !availability) throw new BadRequestException('Requested time is outside the doctor availability');
    const durationMinutes = availability?.slotMinutes ?? Number(process.env.EMERGENCY_APPOINTMENT_MINUTES || 30);
    const end = new Date(start.getTime() + durationMinutes * 60_000);
    try {
      const appointment = await this.prisma.$transaction(async (tx) => {
        const conflict = await tx.appointment.findFirst({ where: { hospitalId, status: { in: activeStatuses }, startsAt: { lt: end }, endsAt: { gt: start }, OR: [{ doctorId: doctor.id }, { patientId: patient.id }] }, select: { id: true } });
        if (conflict) throw new ConflictException('Doctor or patient already has an appointment at that time');
        return tx.appointment.create({
          data: { hospitalId, patientId: patient.id, doctorId: doctor.id, startsAt: start, endsAt: end, emergency: isEmergency, reason: dto.reason || '' },
          include: {
            doctor: { include: { user: { select: { name: true } } } },
            patient: { include: { user: { select: { name: true, email: true } } } },
          },
        });
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      await this.notifications.create(hospitalId, patient.userId, 'appointment', 'Appointment requested', 'Your appointment request is pending confirmation.');
      if (!isEmergency) {
        const reminders = appointmentReminders(appointment.startsAt);
        await this.notifications.scheduleAppointmentReminders({
          appointmentId: appointment.id,
          patientName: appointment.patient.user.name,
          doctorName: appointment.doctor.user.name,
          email: appointment.patient.user.email,
          phone: appointment.patient.phone,
          startsAt: appointment.startsAt,
        }, reminders);
      }
      return this.out(appointment);
    } catch (error) {
      if (error instanceof ConflictException) throw error;
      if (error instanceof Prisma.PrismaClientKnownRequestError && ['P2034', 'P2002'].includes(error.code)) throw new ConflictException('The selected slot was just booked. Choose another time.');
      throw error;
    }
  }
  async list(actor: SessionUser) {
    const where = this.listWhere(actor);
    const rows = await this.prisma.appointment.findMany({ where, include: { patient: { include: { user: { select: { name: true } } } }, doctor: { include: { user: { select: { name: true } } } } }, orderBy: { startsAt: 'desc' }, take: 100 });
    return rows.map((row) => this.out(row));
  }
  async listPage(query: AppointmentListQueryDto, actor: SessionUser) {
    const where = this.listWhere(actor);
    if (query.status) where.status = query.status;
    const search = query.q?.trim();
    if (search) {
      const numericId = /^\d+$/.test(search) ? Number(search) : undefined;
      where.OR = [
        { reason: { contains: search, mode: 'insensitive' } },
        { patient: { user: { name: { contains: search, mode: 'insensitive' } } } },
        { doctor: { user: { name: { contains: search, mode: 'insensitive' } } } },
        ...(numericId && Number.isSafeInteger(numericId) ? [{ id: numericId }] : []),
      ];
    }
    const pageSize = Math.min(100, Math.max(1, query.pageSize || 10));
    const total = await this.prisma.appointment.count({ where });
    const pageCount = Math.max(1, Math.ceil(total / pageSize));
    const page = Math.min(Math.max(1, query.page || 1), pageCount);
    const rows = await this.prisma.appointment.findMany({
      where,
      include: { patient: { include: { user: { select: { name: true } } } }, doctor: { include: { user: { select: { name: true } } } } },
      orderBy: { startsAt: 'desc' }, skip: (page - 1) * pageSize, take: pageSize,
    });
    return { items: rows.map((row) => this.out(row)), total, page, pageSize, totalPages: pageCount };
  }
  private listWhere(actor: SessionUser): Prisma.AppointmentWhereInput {
    const where: Prisma.AppointmentWhereInput = { deletedAt: null };
    if (actor.role !== Role.SUPER_ADMIN) where.hospitalId = actor.hospitalId ?? -1;
    if (actor.role === Role.PATIENT) where.patient = { userId: actor.id };
    if (actor.role === Role.DOCTOR) where.doctor = { userId: actor.id };
    return where;
  }
  async get(id: number, actor: SessionUser) {
    const row = await this.prisma.appointment.findFirst({ where: { id, deletedAt: null, ...(actor.role === Role.SUPER_ADMIN ? {} : { hospitalId: actor.hospitalId ?? -1 }), ...(actor.role === Role.PATIENT ? { patient: { userId: actor.id } } : {}), ...(actor.role === Role.DOCTOR ? { doctor: { userId: actor.id } } : {}) }, include: { patient: { include: { user: { select: { name: true } } } }, doctor: { include: { user: { select: { name: true } } } } } });
    if (!row) throw new NotFoundException('Appointment not found');
    return this.out(row);
  }
  async cancel(id: number, actor: SessionUser) {
    const appointment = await this.prisma.appointment.findFirst({ where: { id, hospitalId: actor.hospitalId ?? undefined, deletedAt: null, ...(actor.role === Role.PATIENT ? { patient: { userId: actor.id } } : {}) } });
    if (!appointment) throw new NotFoundException('Appointment not found');
    if (!(new Set<Role>([Role.PATIENT, Role.HOSPITAL_ADMIN, Role.RECEPTIONIST])).has(actor.role as Role)) throw new ForbiddenException();
    if (!(new Set<AppointmentStatus>([AppointmentStatus.PENDING, AppointmentStatus.CONFIRMED])).has(appointment.status)) throw new ConflictException('This appointment can no longer be cancelled');
    const result = await this.prisma.appointment.update({ where: { id }, data: { status: AppointmentStatus.CANCELLED } });
    await this.notifications.cancelAppointmentReminders(id);
    const patient = await this.prisma.patient.findUnique({ where: { id: appointment.patientId }, select: { userId: true } });
    if (patient) await this.notifications.create(appointment.hospitalId, patient.userId, 'appointment', 'Appointment cancelled', 'An appointment was cancelled.');
    return this.out(result);
  }
  async updateStatus(id: number, statusValue: string, actor: SessionUser) {
    const status = statusValue.toUpperCase() as AppointmentStatus;
    if (!Object.values(AppointmentStatus).includes(status)) throw new BadRequestException('Unsupported appointment status');
    const row = await this.prisma.appointment.findFirst({ where: { id, hospitalId: actor.hospitalId ?? undefined, deletedAt: null, ...(actor.role === Role.DOCTOR ? { doctor: { userId: actor.id } } : {}) } });
    if (!row) throw new NotFoundException('Appointment not found');
    if (!canTransitionAppointment(row.status, status, actor.role as Role)) {
      if (!(new Set<Role>([Role.DOCTOR, Role.HOSPITAL_ADMIN, Role.RECEPTIONIST])).has(actor.role as Role)) throw new ForbiddenException();
      throw new ConflictException('Invalid appointment status transition');
    }
    const updated = await this.prisma.appointment.update({ where: { id }, data: { status } });
    if (status !== AppointmentStatus.PENDING && status !== AppointmentStatus.CONFIRMED) {
      await this.notifications.cancelAppointmentReminders(id);
    }
    return updated;
  }
  private out(row: any) { return { id: row.id, hospitalId: row.hospitalId, patientId: row.patientId, patientName: row.patient?.user?.name, doctorId: row.doctorId, doctorName: row.doctor?.user?.name, startsAt: row.startsAt.toISOString(), endsAt: row.endsAt.toISOString(), status: row.status.toLowerCase(), emergency: row.emergency ?? false, reason: row.reason }; }
}
