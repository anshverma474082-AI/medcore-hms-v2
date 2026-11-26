import { BadRequestException, ForbiddenException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Role } from '@prisma/client';
import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../infra/prisma.service';
import { RedisService } from '../infra/redis.service';
import { NotificationsService } from '../notifications/notifications.service';
import { LoginDto, RegisterDto, VerifyEmailDto } from './auth.dto';
import { hashPasswordResetCode, matchesPasswordResetCode, passwordResetAttemptsKey, passwordResetCooldownKey, passwordResetDevKey, passwordResetKey } from './password-reset.rules';
import { hashPendingPhone, hashPhoneOtp, phoneOtpAttemptsKey, phoneOtpCooldownKey, phoneOtpDevKey, phoneOtpKey, phoneOtpPhoneKey, verifyPendingPhone, verifyPhoneOtp } from './phone-verification.rules';

const otpKey = (email: string) => 'otp:' + email.toLowerCase();
const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');
const rotateSessionScript = `
local current = redis.call('GET', KEYS[1])
if not current then return 0 end
local ok, session = pcall(cjson.decode, current)
if not ok or not session.userId or not session.tokenHash then
  redis.call('DEL', KEYS[1])
  return 0
end
local expected = ARGV[1]
local actual = session.tokenHash
local mismatch = 0
if string.len(actual) ~= string.len(expected) then mismatch = 1 end
for i = 1, string.len(actual) do
  if string.byte(actual, i) ~= string.byte(expected, i) then mismatch = 1 end
end
local owner = tonumber(session.userId)
if mismatch ~= 0 then
  redis.call('DEL', KEYS[1])
  redis.call('SET', KEYS[2], tostring(owner), 'EX', tonumber(ARGV[4]))
  redis.call('SREM', 'user-sessions:' .. tostring(owner), ARGV[3])
  return 0 - owner
end
session.tokenHash = ARGV[2]
redis.call('SET', KEYS[1], cjson.encode(session), 'EX', tonumber(ARGV[4]))
redis.call('EXPIRE', 'user-sessions:' .. tostring(owner), tonumber(ARGV[4]))
return owner
`;

@Injectable()
export class AuthService {
  constructor(private prisma: PrismaService, private redis: RedisService, private jwt: JwtService, private notifications: NotificationsService) {}

  async register(dto: RegisterDto) {
    const email = dto.email.toLowerCase();
    const hospital = await this.prisma.hospital.findFirst({ where: { code: dto.hospitalCode, verified: true } });
    if (!hospital) throw new BadRequestException('Unknown or unverified hospital code');
    if (await this.prisma.user.findUnique({ where: { email } })) throw new BadRequestException('Email already registered');
    const passwordHash = await bcrypt.hash(dto.password, Number(process.env.BCRYPT_ROUNDS || 12));
    const user = await this.prisma.$transaction(async (tx) => {
      const created = await tx.user.create({ data: { name: dto.name.trim(), email, passwordHash, role: Role.PATIENT, hospitalId: hospital.id } });
      await tx.patient.create({ data: { userId: created.id, hospitalId: hospital.id, phone: dto.phone || '' } });
      await tx.auditLog.create({ data: { hospitalId: hospital.id, userId: created.id, action: 'REGISTER', entity: 'User' } });
      return created;
    });
    const code = String(randomInt(100000, 1000000));
    await this.redis.client.set(otpKey(email), sha256(code), 'EX', 600);
    if (process.env.NODE_ENV !== 'production') await this.redis.client.set('otp-dev:' + email, code, 'EX', 600);
    await this.notifications.queueOtp(email, '', code);
    return { id: user.id, email: user.email };
  }

  async verifyEmail(dto: VerifyEmailDto) {
    const email = dto.email.toLowerCase();
    const attemptsKey = 'otp-attempts:' + email;
    const attempts = await this.redis.client.incr(attemptsKey);
    if (attempts === 1) await this.redis.client.expire(attemptsKey, 600);
    if (attempts > 8) { await this.redis.client.del(otpKey(email)); throw new ForbiddenException('Too many verification attempts'); }
    const stored = await this.redis.client.get(otpKey(email));
    if (!stored) throw new BadRequestException('Verification code has expired');
    const expected = Buffer.from(stored);
    const supplied = Buffer.from(sha256(dto.otp));
    if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) throw new BadRequestException('Invalid verification code');
    const updated = await this.prisma.user.updateMany({ where: { email, role: Role.PATIENT, deletedAt: null }, data: { emailVerified: true } });
    if (!updated.count) throw new BadRequestException('Account not found');
    await this.redis.client.del(otpKey(email), attemptsKey, 'otp-dev:' + email);
    return null;
  }

  async requestPasswordReset(emailInput: string) {
    const email = emailInput.trim().toLowerCase();
    const cooldown = await this.redis.client.set(passwordResetCooldownKey(email), '1', 'EX', 60, 'NX');
    const user = await this.prisma.user.findFirst({ where: { email, deletedAt: null, isActive: true }, select: { email: true } });
    if (cooldown !== 'OK' || !user) return null;

    const code = String(randomInt(100000, 1000000));
    const key = passwordResetKey(email);
    await this.redis.client.set(key, hashPasswordResetCode(code), 'EX', 600);
    await this.redis.client.del(passwordResetAttemptsKey(email));
    if (process.env.NODE_ENV !== 'production') await this.redis.client.set(passwordResetDevKey(email), code, 'EX', 600);
    await this.notifications.queuePasswordReset(email, code);
    return null;
  }

  async devPasswordResetCode(emailInput: string) {
    if (process.env.NODE_ENV === 'production') throw new ForbiddenException('Not found');
    const email = emailInput.trim().toLowerCase();
    const code = await this.redis.client.get(passwordResetDevKey(email));
    if (!code) throw new BadRequestException('Password reset code not found or expired');
    return { email, code };
  }

  async requestPhoneVerification(userId: number, phoneInput: string) {
    const phone = phoneInput.trim();
    const patient = await this.prisma.patient.findFirst({ where: { userId, deletedAt: null }, select: { phone: true, phoneVerified: true } });
    if (!patient) throw new NotFoundException('Patient profile not found');
    if (patient.phone === phone && patient.phoneVerified) return { phoneVerified: true };

    const cooldown = await this.redis.client.set(phoneOtpCooldownKey(userId), '1', 'EX', 60, 'NX');
    if (cooldown !== 'OK') return { phoneVerified: false, cooldown: true };
    const code = String(randomInt(100000, 1000000));
    await this.redis.client.set(phoneOtpKey(userId), hashPhoneOtp(code), 'EX', 600);
    await this.redis.client.set(phoneOtpPhoneKey(userId), hashPendingPhone(phone), 'EX', 600);
    await this.redis.client.del(phoneOtpAttemptsKey(userId));
    if (process.env.NODE_ENV !== 'production') await this.redis.client.set(phoneOtpDevKey(userId), code, 'EX', 600);
    await this.notifications.queuePhoneOtp(phone, code);
    return { phoneVerified: false, sent: true };
  }

  async verifyPhone(userId: number, phoneInput: string, code: string) {
    const phone = phoneInput.trim();
    const attemptsKey = phoneOtpAttemptsKey(userId);
    const attempts = await this.redis.client.incr(attemptsKey);
    if (attempts === 1) await this.redis.client.expire(attemptsKey, 600);
    if (attempts > 8) {
      await this.redis.client.del(phoneOtpKey(userId), phoneOtpPhoneKey(userId), phoneOtpDevKey(userId));
      throw new ForbiddenException('Too many phone verification attempts');
    }
    const [storedCodeHash, storedPhoneHash] = await Promise.all([
      this.redis.client.get(phoneOtpKey(userId)),
      this.redis.client.get(phoneOtpPhoneKey(userId)),
    ]);
    if (!storedCodeHash || !storedPhoneHash) throw new BadRequestException('Phone verification code has expired');
    if (!verifyPhoneOtp(storedCodeHash, code) || !verifyPendingPhone(storedPhoneHash, phone)) throw new BadRequestException('Invalid phone verification code');
    const updated = await this.prisma.patient.updateMany({ where: { userId, deletedAt: null }, data: { phone, phoneVerified: true } });
    if (!updated.count) throw new NotFoundException('Patient profile not found');
    await this.redis.client.del(phoneOtpKey(userId), phoneOtpPhoneKey(userId), phoneOtpAttemptsKey(userId), phoneOtpDevKey(userId), phoneOtpCooldownKey(userId));
    return { phoneVerified: true, phone };
  }

  async devPhoneVerificationCode(userId: number) {
    if (process.env.NODE_ENV === 'production') throw new ForbiddenException('Not found');
    const code = await this.redis.client.get(phoneOtpDevKey(userId));
    if (!code) throw new BadRequestException('Phone verification code not found or expired');
    return { code };
  }

  async resetPassword(emailInput: string, code: string, password: string) {
    const email = emailInput.trim().toLowerCase();
    const key = passwordResetKey(email);
    const attemptsKey = passwordResetAttemptsKey(email);
    const attempts = await this.redis.client.incr(attemptsKey);
    if (attempts === 1) await this.redis.client.expire(attemptsKey, 600);
    if (attempts > 8) {
      await this.redis.client.del(key, passwordResetDevKey(email));
      throw new ForbiddenException('Too many password reset attempts');
    }

    const stored = await this.redis.client.get(key);
    if (!stored) throw new BadRequestException('Password reset code has expired');
    if (!matchesPasswordResetCode(stored, code)) throw new BadRequestException('Invalid password reset code');

    const updated = await this.prisma.user.updateMany({ where: { email, isActive: true, deletedAt: null }, data: { passwordHash: await bcrypt.hash(password, Number(process.env.BCRYPT_ROUNDS || 12)) } });
    if (!updated.count) throw new BadRequestException('Password reset code has expired');
    const user = await this.prisma.user.findFirst({ where: { email }, select: { id: true } });
    await this.redis.client.del(key, attemptsKey, passwordResetDevKey(email), passwordResetCooldownKey(email));
    if (user) await this.revokeSessions(user.id);
    return null;
  }

  async login(dto: LoginDto) {
    const user = await this.prisma.user.findUnique({ where: { email: dto.email.toLowerCase() }, include: { patient: true, doctor: true } });
    const ok = user && !user.deletedAt && user.isActive && await bcrypt.compare(dto.password, user.passwordHash);
    if (!ok) throw new UnauthorizedException('Wrong email or password');
    if (!user.emailVerified) throw new ForbiddenException('Verify your email first');
    return { user: this.userOut(user), cookies: await this.issueSession(user) };
  }

  async refresh(raw: string | undefined) {
    if (!raw || !raw.includes('.')) throw new UnauthorizedException('Login required');
    const [sid, secret] = raw.split('.', 2);
    const key = 'session:' + sid;
    const nextSecret = randomBytes(48).toString('base64url');
    const owner = Number(await this.redis.client.eval(
      rotateSessionScript,
      2,
      key,
      'revoked-session:' + sid,
      sha256(secret),
      sha256(nextSecret),
      sid,
      7 * 86400,
    ));
    if (!owner) {
      const revokedOwner = await this.redis.client.get('revoked-session:' + sid);
      if (revokedOwner) await this.revokeSessions(Number(revokedOwner));
      throw new UnauthorizedException('Refresh token expired or already used');
    }
    if (owner < 0) {
      await this.revokeSessions(Math.abs(owner));
      throw new UnauthorizedException('Refresh token expired or already used');
    }
    const user = await this.prisma.user.findFirst({ where: { id: owner, isActive: true, deletedAt: null }, include: { patient: true } });
    if (!user) {
      await this.revokeSessions(owner);
      throw new UnauthorizedException('Account unavailable');
    }
    return { user: this.userOut(user), cookies: { accessToken: await this.signAccessToken(user, sid), refreshToken: sid + '.' + nextSecret } };
  }

  async logout(raw: string | undefined) {
    if (raw?.includes('.')) {
      const sid = raw.split('.', 1)[0];
      const session = await this.redis.client.get('session:' + sid);
      const userId = session ? Number(JSON.parse(session).userId) : 0;
      await this.redis.client.del('session:' + sid);
      if (userId) await this.redis.client.srem('user-sessions:' + userId, sid);
    }
    return null;
  }

  async devOtp(email: string) {
    if (process.env.NODE_ENV === 'production') throw new ForbiddenException('Not found');
    const code = await this.redis.client.get('otp-dev:' + email.toLowerCase());
    if (!code) throw new BadRequestException('Verification code not found or expired');
    return { email: email.toLowerCase(), code };
  }

  async me(id: number) {
    const user = await this.prisma.user.findFirst({ where: { id, deletedAt: null }, include: { patient: true, doctor: true } });
    if (!user || !user.isActive) throw new UnauthorizedException('Account unavailable');
    return this.userOut(user);
  }

  private userOut(user: any) {
    return { id: user.id, name: user.name, email: user.email, role: user.role.toLowerCase(), hospitalId: user.hospitalId, patientId: user.patient?.id, patientPhone: user.patient?.phone, phoneVerified: user.patient?.phoneVerified, doctorId: user.doctor?.id };
  }

  private async issueSession(user: any) {
    const sid = randomBytes(24).toString('hex');
    const secret = randomBytes(48).toString('base64url');
    await this.redis.client.set('session:' + sid, JSON.stringify({ tokenHash: sha256(secret), userId: user.id }), 'EX', 7 * 86400);
    await this.redis.client.sadd('user-sessions:' + user.id, sid);
    await this.redis.client.expire('user-sessions:' + user.id, 7 * 86400);
    const accessToken = await this.signAccessToken(user, sid);
    // Only the token hash and owner are kept in Redis; the raw refresh token is sent in an HttpOnly cookie.
    return { accessToken, refreshToken: sid + '.' + secret };
  }

  private signAccessToken(user: any, sid: string) {
    return this.jwt.signAsync({ sub: user.id, id: user.id, name: user.name, email: user.email, role: user.role, hospitalId: user.hospitalId, sid }, { secret: process.env.JWT_ACCESS_SECRET, expiresIn: '15m' });
  }

  private async revokeSessions(userId: number) {
    const index = 'user-sessions:' + userId;
    const sids = await this.redis.client.smembers(index);
    if (sids.length) await this.redis.client.del(...sids.map((sid) => 'session:' + sid));
    await this.redis.client.del(index);
  }
}
