import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Role } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../infra/prisma.service';
import { SessionUser } from '../security/current-user.decorator';
import { decryptClinicalText, encryptClinicalText } from '../security/data-protection';
import { CreateStaffDto, UpdatePatientProfileDto } from './users.dto';

const staffRoles: Role[] = [Role.DOCTOR, Role.NURSE, Role.RECEPTIONIST, Role.LAB_TECHNICIAN, Role.PHARMACIST, Role.ACCOUNTANT];
@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) {}
  async create(dto: CreateStaffDto, actor: SessionUser) {
    if (!actor.hospitalId || !staffRoles.includes(dto.role)) throw new ForbiddenException('Hospital admins can create staff roles only');
    const email = dto.email.toLowerCase();
    if (await this.prisma.user.findUnique({ where: { email } })) throw new BadRequestException('Email already registered');
    if (dto.departmentId && !await this.prisma.department.findFirst({ where: { id: dto.departmentId, hospitalId: actor.hospitalId } })) throw new NotFoundException('Department not found');
    const passwordHash = await bcrypt.hash(dto.password, Number(process.env.BCRYPT_ROUNDS || 12));
    return this.prisma.$transaction(async (tx) => {
      const user = await tx.user.create({ data: { hospitalId: actor.hospitalId!, email, name: dto.name.trim(), passwordHash, role: dto.role, emailVerified: true } });
      if (dto.role === Role.DOCTOR) await tx.doctor.create({ data: { userId: user.id, hospitalId: actor.hospitalId!, departmentId: dto.departmentId, specialisation: dto.specialisation || 'General' } });
      await tx.auditLog.create({ data: { hospitalId: actor.hospitalId!, userId: actor.id, action: 'CREATE', entity: 'User', entityId: user.id } });
      return { id: user.id, name: user.name, email: user.email, role: user.role.toLowerCase(), hospitalId: user.hospitalId };
    });
  }
  list(actor: SessionUser) {
    const where = actor.role === Role.SUPER_ADMIN ? {} : { hospitalId: actor.hospitalId! };
    return this.prisma.user.findMany({ where: { ...where, deletedAt: null }, select: { id: true, hospitalId: true, name: true, email: true, role: true, isActive: true }, orderBy: { name: 'asc' } });
  }
  async get(id: number, actor: SessionUser) {
    const where = actor.role === Role.SUPER_ADMIN ? { id } : { id, hospitalId: actor.hospitalId! };
    const user = await this.prisma.user.findFirst({ where: { ...where, deletedAt: null }, select: { id: true, hospitalId: true, name: true, email: true, role: true, isActive: true } });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }
  async doctors(actor: SessionUser, specialization?: string) {
    if (!actor.hospitalId) throw new ForbiddenException();
    return this.prisma.doctor.findMany({ where: { hospitalId: actor.hospitalId, deletedAt: null, user: { isActive: true, deletedAt: null }, ...(specialization ? { specialisation: { contains: specialization, mode: 'insensitive' } } : {}) }, include: { user: { select: { id: true, name: true, email: true } }, department: { select: { id: true, name: true } } }, orderBy: { user: { name: 'asc' } } });
  }
  async myDoctor(actor: SessionUser) {
    const doctor = await this.prisma.doctor.findUnique({ where: { userId: actor.id }, include: { user: true } });
    if (!doctor) throw new NotFoundException('Doctor profile not found');
    return { id: doctor.id, userId: doctor.userId, hospitalId: doctor.hospitalId, specialisation: doctor.specialisation, name: doctor.user.name };
  }
  async patientProfile(actor: SessionUser) {
    const patient = await this.prisma.patient.findFirst({ where: { userId: actor.id, hospitalId: actor.hospitalId ?? -1, deletedAt: null } });
    if (!patient) throw new NotFoundException('Patient profile not found');
    return this.patientProfileOut(patient);
  }
  async updatePatientProfile(dto: UpdatePatientProfileDto, actor: SessionUser) {
    const patient = await this.prisma.patient.findFirst({ where: { userId: actor.id, hospitalId: actor.hospitalId ?? -1, deletedAt: null }, select: { id: true, hospitalId: true } });
    if (!patient) throw new NotFoundException('Patient profile not found');
    const data: any = {};
    if (dto.birthDate !== undefined) data.birthDateEncrypted = encryptClinicalText(dto.birthDate || '');
    if (dto.sex !== undefined) data.sexEncrypted = encryptClinicalText(dto.sex);
    if (dto.bloodGroup !== undefined) data.bloodGroupEncrypted = encryptClinicalText(dto.bloodGroup);
    if (dto.emergencyContactName !== undefined) data.emergencyContactNameEncrypted = encryptClinicalText(dto.emergencyContactName.trim());
    if (dto.emergencyContactPhone !== undefined) data.emergencyContactPhoneEncrypted = encryptClinicalText(dto.emergencyContactPhone.trim());
    if (dto.address !== undefined) data.addressEncrypted = encryptClinicalText(dto.address.trim());
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.patient.update({ where: { id: patient.id }, data });
      await tx.auditLog.create({ data: { hospitalId: patient.hospitalId, userId: actor.id, action: 'UPDATE', entity: 'PatientProfile', entityId: patient.id } });
      return this.patientProfileOut(updated);
    });
  }
  private patientProfileOut(patient: any) {
    return { birthDate: decryptClinicalText(patient.birthDateEncrypted || ''), sex: decryptClinicalText(patient.sexEncrypted || ''), bloodGroup: decryptClinicalText(patient.bloodGroupEncrypted || ''), emergencyContactName: decryptClinicalText(patient.emergencyContactNameEncrypted || ''), emergencyContactPhone: decryptClinicalText(patient.emergencyContactPhoneEncrypted || ''), address: decryptClinicalText(patient.addressEncrypted || '') };
  }
}
