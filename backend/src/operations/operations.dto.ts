import { Type } from 'class-transformer';
import { IsArray, IsDateString, IsInt, IsNumber, IsOptional, IsString, Length, Min, ValidateNested } from 'class-validator';
export class LabOrderDto { @IsString() @Length(1, 200) testName!: string; @IsOptional() @IsString() @Length(0, 2000) notes?: string; }
export class LabResultDto { @IsString() @Length(1, 5000) result!: string; }
export class MedicineDto {
  @IsString() @Length(2, 200) name!: string;
  @IsString() @Length(1, 80) sku!: string;
  @IsOptional() @IsString() category?: string;
  @IsOptional() @IsString() unit?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) reorderLevel?: number;
}
export class BatchDto {
  @IsString() @Length(1, 100) batchNumber!: string;
  @IsDateString() expiryDate!: string;
  @Type(() => Number) @IsInt() @Min(1) quantity!: number;
  @Type(() => Number) @IsNumber() @Min(0) unitCost!: number;
}
export class DispenseLineDto { @Type(() => Number) @IsInt() @Min(1) prescriptionItemId!: number; @Type(() => Number) @IsInt() @Min(1) quantity!: number; }
export class DispenseDto { @IsArray() @ValidateNested({ each: true }) @Type(() => DispenseLineDto) items!: DispenseLineDto[]; }
