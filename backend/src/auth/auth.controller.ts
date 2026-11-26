import { Body, Controller, Get, Post, Req, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Request, Response } from 'express';
import { randomBytes } from 'node:crypto';
import { Role } from '@prisma/client';
import { Public } from '../security/public.decorator';
import { Roles } from '../security/roles.decorator';
import { CurrentUser, SessionUser } from '../security/current-user.decorator';
import { AuthService } from './auth.service';
import { LoginDto, RegisterDto, RequestPasswordResetDto, RequestPhoneVerificationDto, ResetPasswordDto, VerifyEmailDto, VerifyPhoneDto } from './auth.dto';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private auth: AuthService) {}
  @Public() @Post('register')
  async register(@Body() dto: RegisterDto) { return { success: true, data: await this.auth.register(dto), message: 'Verification code sent' }; }
  @Public() @Post('verify-email')
  async verify(@Body() dto: VerifyEmailDto) { await this.auth.verifyEmail(dto); return { success: true, data: null, message: 'Email verified' }; }
  @Public() @Post('password-reset/request')
  async requestPasswordReset(@Body() dto: RequestPasswordResetDto) {
    await this.auth.requestPasswordReset(dto.email);
    return { success: true, data: null, message: 'If the account exists, a password reset code has been sent.' };
  }
  @Public() @Post('password-reset/confirm')
  async confirmPasswordReset(@Body() dto: ResetPasswordDto) {
    await this.auth.resetPassword(dto.email, dto.otp, dto.password);
    return { success: true, data: null, message: 'Password updated. Please sign in again.' };
  }
  @Public() @Get('dev-password-reset-code')
  async devPasswordResetCode(@Req() req: Request) {
    return { success: true, data: await this.auth.devPasswordResetCode(String(req.query.email || '')), message: 'Local development only' };
  }
  @Post('phone-verification/request') @Roles(Role.PATIENT)
  async requestPhoneVerification(@Body() dto: RequestPhoneVerificationDto, @CurrentUser() user: SessionUser) {
    return { success: true, data: await this.auth.requestPhoneVerification(user.id, dto.phone), message: 'If available, a phone verification code has been sent.' };
  }
  @Post('phone-verification/confirm') @Roles(Role.PATIENT)
  async verifyPhone(@Body() dto: VerifyPhoneDto, @CurrentUser() user: SessionUser) {
    return { success: true, data: await this.auth.verifyPhone(user.id, dto.phone, dto.otp), message: 'Phone number verified.' };
  }
  @Get('dev-phone-otp') @Roles(Role.PATIENT)
  async devPhoneOtp(@CurrentUser() user: SessionUser) {
    return { success: true, data: await this.auth.devPhoneVerificationCode(user.id), message: 'Local development only' };
  }
  @Public() @Get('dev-otp')
  async devOtp(@Req() req: Request) { return { success: true, data: await this.auth.devOtp(String(req.query.email || '')), message: 'Local development only' }; }
  @Public() @Get('csrf')
  csrf(@Res({ passthrough: true }) response: Response) {
    const token = randomBytes(32).toString('base64url');
    response.cookie('csrf_token', token, { secure: process.env.COOKIE_SECURE === 'true', sameSite: 'strict', path: '/', maxAge: 8 * 60 * 60 * 1000 });
    return { success: true, data: { csrfToken: token }, message: 'CSRF token issued' };
  }
  @Public() @Post('login')
  async login(@Body() dto: LoginDto, @Res({ passthrough: true }) response: Response) {
    const result = await this.auth.login(dto); this.setCookies(response, result.cookies.accessToken, result.cookies.refreshToken);
    return { success: true, data: { user: result.user }, message: 'OK' };
  }
  @Public() @Post('refresh')
  async refresh(@Req() req: Request, @Res({ passthrough: true }) response: Response) {
    const result = await this.auth.refresh(req.cookies?.refresh_token); this.setCookies(response, result.cookies.accessToken, result.cookies.refreshToken);
    return { success: true, data: { user: result.user }, message: 'Session refreshed' };
  }
  @Public() @Post('logout')
  async logout(@Req() req: Request, @Res({ passthrough: true }) response: Response) {
    await this.auth.logout(req.cookies?.refresh_token); response.clearCookie('access_token', this.cookieOptions()); response.clearCookie('refresh_token', this.cookieOptions());
    return { success: true, data: null, message: 'Logged out' };
  }
  @Get('me')
  async me(@CurrentUser() user: SessionUser) { return { success: true, data: await this.auth.me(user.id), message: 'OK' }; }
  private cookieOptions() { return { httpOnly: true, secure: process.env.COOKIE_SECURE === 'true', sameSite: 'strict' as const, path: '/' }; }
  private setCookies(res: Response, access: string, refresh: string) {
    res.cookie('access_token', access, { ...this.cookieOptions(), maxAge: 15 * 60 * 1000 });
    res.cookie('refresh_token', refresh, { ...this.cookieOptions(), maxAge: 7 * 24 * 60 * 60 * 1000 });
  }
}
