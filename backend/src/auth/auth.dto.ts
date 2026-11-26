import { IsEmail, IsOptional, IsString, Length, Matches, MinLength } from 'class-validator';

export class RegisterDto {
  @IsString() @Length(2, 120) name!: string;
  @IsEmail() email!: string;
  @IsString() @MinLength(12) password!: string;
  @IsString() hospitalCode!: string;
  @IsOptional() @IsString() @Matches(/^\+?[0-9 -]{7,20}$/) phone?: string;
}
export class LoginDto { @IsEmail() email!: string; @IsString() @MinLength(1) password!: string; }
export class VerifyEmailDto { @IsEmail() email!: string; @Matches(/^\d{6}$/) otp!: string; }
export class RequestPasswordResetDto { @IsEmail() email!: string; }
export class ResetPasswordDto {
  @IsEmail() email!: string;
  @Matches(/^\d{6}$/) otp!: string;
  @IsString() @MinLength(12) password!: string;
}
export class RequestPhoneVerificationDto {
  @IsString() @Matches(/^\+?[0-9 ()-]{7,24}$/) phone!: string;
}
export class VerifyPhoneDto {
  @IsString() @Matches(/^\+?[0-9 ()-]{7,24}$/) phone!: string;
  @Matches(/^\d{6}$/) otp!: string;
}
