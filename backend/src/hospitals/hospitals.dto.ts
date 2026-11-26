import { IsEmail, IsString, Length, Matches } from 'class-validator';
export class CreateHospitalDto {
  @IsString() @Length(2, 160) name!: string;
  @IsString() @Matches(/^[A-Z0-9-]{3,24}$/) code!: string;
  @IsString() @Length(2, 120) adminName!: string;
  @IsEmail() adminEmail!: string;
  @IsString() @Length(12, 128) adminPassword!: string;
}
export class CreateDepartmentDto { @IsString() @Length(2, 100) name!: string; }
