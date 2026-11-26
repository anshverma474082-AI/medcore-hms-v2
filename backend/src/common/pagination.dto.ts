import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsInt, IsOptional, IsString, Length, Max, Min } from 'class-validator';

export class PageQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(1_000_000) page = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize = 10;
  @IsOptional() @IsString() @Length(1, 100) q?: string;
  @IsOptional() @IsString() @Length(1, 32) status?: string;
  @IsOptional() @Transform(({ value }) => {
    if (value === undefined) return undefined;
    const normalized = String(value).toLowerCase();
    return normalized === 'true' ? true : normalized === 'false' ? false : value;
  }) @IsBoolean() dispensed?: boolean;
}
