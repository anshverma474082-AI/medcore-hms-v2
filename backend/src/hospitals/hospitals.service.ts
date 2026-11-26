import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Role } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../infra/prisma.service';
import { SessionUser } from '../security/current-user.decorator';
import { CreateDepartmentDto, CreateHospitalDto } from './hospitals.dto';

@Injectable()
export class HospitalsService {
  constructor(private prisma: PrismaService) {}
  async create(dto: CreateHospitalDto) {
    const email = dto.adminEmail.toLowerCase();
    if (await this.prisma.user.findUnique({ where: { email } })) throw new BadRequestException('Admin email is already registered');
    const passwordHash = await bcrypt.hash(dto.adminPassword, Number(process.env.BCRYPT_ROUNDS || 12));
    return this.prisma.$transaction(async (tx) => {
      const hospital = await tx.hospital.create({ data: { name: dto.name.trim(), code: dto.code.toUpperCase() } });
      await tx.user.create({ data: { hospitalId: hospital.id, email, name: dto.adminName.trim(), passwordHash, role: Role.HOSPITAL_ADMIN, emailVerified: true } });
      return { id: hospital.id, name: hospital.name, code: hospital.code, verified: hospital.verified };
    });
  }
  async verify(id: number) {
    const result = await this.prisma.hospital.updateMany({ where: { id }, data: { verified: true } });
    if (!result.count) throw new NotFoundException('Hospital not found');
    return this.prisma.hospital.findUnique({ where: { id }, select: { id: true, name: true, code: true, verified: true } });
  }
  async list(user: SessionUser) {
    const where = user.role === Role.SUPER_ADMIN ? {} : { id: user.hospitalId! };
    return this.prisma.hospital.findMany({ where, select: { id: true, name: true, code: true, verified: true } });
  }
  async createDepartment(user: SessionUser, dto: CreateDepartmentDto) {
    if (!user.hospitalId) throw new ForbiddenException();
    return this.prisma.department.create({ data: { hospitalId: user.hospitalId, name: dto.name.trim() } });
  }
  async departments(user: SessionUser, hospitalId: number) {
    if (user.role !== Role.SUPER_ADMIN && user.hospitalId !== hospitalId) throw new NotFoundException('Hospital not found');
    return this.prisma.department.findMany({ where: { hospitalId }, orderBy: { name: 'asc' } });
  }
}
