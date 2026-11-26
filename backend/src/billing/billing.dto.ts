import { Type } from 'class-transformer';
import { IsArray, IsInt, IsOptional, IsString, Length, Min, ValidateNested } from 'class-validator';
export class InvoiceLineDto {
  @IsString() @Length(1, 200) description!: string;
  @Type(() => Number) @IsInt() @Min(1) quantity!: number;
  @Type(() => Number) @IsInt() @Min(0) unitAmountMinor!: number;
}
export class CreateInvoiceDto {
  @IsArray() @ValidateNested({ each: true }) @Type(() => InvoiceLineDto) items!: InvoiceLineDto[];
  @IsOptional() @IsString() @Length(3, 3) currency?: string;
}
export class VerifyPaymentDto { @IsString() orderId!: string; @IsString() paymentId!: string; @IsString() signature!: string; }
