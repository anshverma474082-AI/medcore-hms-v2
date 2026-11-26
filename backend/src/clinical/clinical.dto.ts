import { Type } from 'class-transformer';
import { IsArray, IsInt, IsNumber, IsOptional, IsString, Length, Max, Min, ValidateNested } from 'class-validator';
export class MedicalRecordDto {
  @IsOptional() @IsString() @Length(0, 500) chiefComplaint?: string;
  @IsOptional() @IsString() @Length(0, 5000) symptoms?: string;
  @IsString() @Length(1, 5000) diagnosis!: string;
  @IsOptional() @IsString() @Length(0, 5000) treatmentPlan?: string;
  @IsOptional() @IsString() @Length(0, 3000) allergies?: string;
  @IsOptional() @IsString() @Length(0, 32) bloodPressure?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(300) pulseBpm?: number;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(25) @Max(45) temperatureC?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(100) spo2Percent?: number;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(1) @Max(500) weightKg?: number;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(40) @Max(250) heightCm?: number;
  @IsOptional() @IsString() @Length(0, 5000) medicalHistory?: string;
  @IsOptional() @IsString() @Length(0, 5000) familyHistory?: string;
  @IsOptional() @IsString() @Length(0, 5000) surgicalHistory?: string;
  @IsOptional() @IsString() @Length(0, 5000) vaccinationHistory?: string;
}
export class PrescriptionLineDto {
  @IsString() @Length(1, 200) medicineName!: string;
  @IsString() @Length(1, 120) dosage!: string;
  @IsString() @Length(1, 120) frequency!: string;
  @IsString() @Length(1, 120) duration!: string;
  @IsOptional() @IsString() @Length(0, 500) instructions?: string;
}
export class PrescriptionDto {
  @IsOptional() @IsString() @Length(0, 2000) instructions?: string;
  @IsArray() @ValidateNested({ each: true }) @Type(() => PrescriptionLineDto) items!: PrescriptionLineDto[];
}
