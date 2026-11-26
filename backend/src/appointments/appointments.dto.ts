import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsDateString, IsEnum, IsInt, IsOptional, IsString, Max, Min, Length } from 'class-validator';
import { AppointmentStatus } from '@prisma/client';
export class AvailabilityDto {
  @Type(() => Number) @IsInt() @Min(0) @Max(6) weekday!: number;
  @Type(() => Number) @IsInt() @Min(0) @Max(1439) startMinute!: number;
  @Type(() => Number) @IsInt() @Min(1) @Max(1440) endMinute!: number;
  @Type(() => Number) @IsInt() @Min(10) @Max(120) slotMinutes = 30;
}
export class BookAppointmentDto {
  @Type(() => Number) @IsInt() @Min(1) doctorId!: number;
  @IsDateString() startsAt!: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) patientId?: number;
  @IsOptional() @IsString() @Length(0, 500) reason?: string;
  @IsOptional() @IsBoolean() emergency?: boolean;
}
export class AppointmentStatusDto {
  @Transform(({ value }) => String(value).toUpperCase()) @IsEnum(AppointmentStatus) status!: AppointmentStatus;
}
export class AppointmentListQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(1_000_000) page = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize = 10;
  @IsOptional() @IsString() @Length(1, 100) q?: string;
  @IsOptional() @Transform(({ value }) => String(value).toUpperCase()) @IsEnum(AppointmentStatus) status?: AppointmentStatus;
}
