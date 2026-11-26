import { IsDateString, IsEmail, IsEnum, IsIn, IsOptional, IsString, Length } from 'class-validator';
import { Role } from '@prisma/client';
export class CreateStaffDto {
  @IsString() @Length(2, 120) name!: string;
  @IsEmail() email!: string;
  @IsString() @Length(12, 128) password!: string;
  @IsEnum(Role) role!: Role;
  @IsOptional() departmentId?: number;
  @IsOptional() @IsString() specialisation?: string;
}

export class UpdatePatientProfileDto {
  @IsOptional() @IsDateString() birthDate?: string;
  @IsOptional() @IsIn(['', 'female', 'male', 'non_binary', 'prefer_not_to_say']) sex?: string;
  @IsOptional() @IsIn(['', 'A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-']) bloodGroup?: string;
  @IsOptional() @IsString() @Length(0, 120) emergencyContactName?: string;
  @IsOptional() @IsString() @Length(0, 40) emergencyContactPhone?: string;
  @IsOptional() @IsString() @Length(0, 1000) address?: string;
}
