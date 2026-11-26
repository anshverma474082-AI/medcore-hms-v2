import * as bcrypt from 'bcrypt';
jest.mock('@nestjs/common', () => {
  class TestHttpException extends Error {}
  return {
    BadRequestException: TestHttpException,
    ForbiddenException: TestHttpException,
    Injectable: () => (target: unknown) => target,
    UnauthorizedException: TestHttpException,
  };
});
jest.mock('@nestjs/jwt', () => ({ JwtService: class JwtService {} }));
jest.mock('../infra/prisma.service', () => ({ PrismaService: class PrismaService {} }));
jest.mock('../infra/redis.service', () => ({ RedisService: class RedisService {} }));
jest.mock('../notifications/notifications.service', () => ({ NotificationsService: class NotificationsService {} }));
import { AuthService } from './auth.service';
import { passwordResetCooldownKey, passwordResetDevKey, passwordResetKey } from './password-reset.rules';

describe('AuthService password recovery', () => {
  const values = new Map<string, string>();
  const sets = new Map<string, Set<string>>();
  let accountExists = true;
  let savedPasswordHash = '';
  const redisClient = {
    set: jest.fn(async (key: string, value: string, ...options: string[]) => {
      if (options.includes('NX') && values.has(key)) return null;
      values.set(key, value);
      return 'OK';
    }),
    get: jest.fn(async (key: string) => values.get(key) ?? null),
    del: jest.fn(async (...keys: string[]) => keys.reduce((count, key) => count + Number(values.delete(key) || sets.delete(key)), 0)),
    incr: jest.fn(async (key: string) => {
      const count = Number(values.get(key) || 0) + 1;
      values.set(key, String(count));
      return count;
    }),
    expire: jest.fn(async () => 1),
    smembers: jest.fn(async (key: string) => Array.from(sets.get(key) || [])),
    srem: jest.fn(async () => 1),
    sadd: jest.fn(async (key: string, value: string) => { if (!sets.has(key)) sets.set(key, new Set()); sets.get(key)!.add(value); return 1; }),
    eval: jest.fn(async () => 41),
  };
  const user = { id: 41, email: 'patient@example.com' };
  const activeUser = { id: 41, name: 'Demo Patient', email: 'patient@example.com', role: 'PATIENT', hospitalId: 7, isActive: true, emailVerified: true, deletedAt: null, patient: { id: 8, phone: '0000000000', phoneVerified: false }, doctor: null };
  const patient = { phone: '', phoneVerified: false };
  const prisma = {
    user: {
      findFirst: jest.fn(async () => accountExists ? user : null),
      findUnique: jest.fn(async () => null),
      updateMany: jest.fn(async (args: { data: { passwordHash: string } }) => { savedPasswordHash = args.data.passwordHash; return { count: 1 }; }),
    },
    hospital: { findFirst: jest.fn(async () => ({ id: 7, verified: true })) },
    patient: {
      findFirst: jest.fn(async () => patient),
      updateMany: jest.fn(async () => ({ count: 1 })),
    },
    $transaction: jest.fn(async (callback: (tx: { user: { create: jest.Mock }; patient: { create: jest.Mock }; auditLog: { create: jest.Mock } }) => unknown) => callback({
      user: { create: jest.fn(async () => ({ id: 42, name: 'New Patient', email: 'new@example.com' })) },
      patient: { create: jest.fn(async () => undefined) },
      auditLog: { create: jest.fn(async () => undefined) },
    })),
  };
  const notifications = { queuePasswordReset: jest.fn(async () => undefined), queuePhoneOtp: jest.fn(async () => undefined), queueOtp: jest.fn(async () => undefined) };
  const jwt = { signAsync: jest.fn(async () => 'signed-access-token') };
  let service: AuthService;

  beforeEach(() => {
    values.clear();
    sets.clear();
    accountExists = true;
    savedPasswordHash = '';
    jest.clearAllMocks();
    process.env.NODE_ENV = 'test';
    process.env.BCRYPT_ROUNDS = '4';
    sets.set('user-sessions:41', new Set(['active-session']));
    service = new AuthService(prisma as never, { client: redisClient } as never, jwt as never, notifications as never);
  });

  it('returns no account details and stores only a hash while queueing a code', async () => {
    await service.requestPasswordReset(' PATIENT@example.com ');
    const code = values.get(passwordResetDevKey(user.email));
    expect(code).toMatch(/^\d{6}$/);
    expect(values.get(passwordResetKey(user.email))).not.toBe(code);
    expect(notifications.queuePasswordReset).toHaveBeenCalledWith(user.email, code);
    expect(values.has(passwordResetCooldownKey(user.email))).toBe(true);
  });

  it('does not send another code during the per-email cooldown', async () => {
    values.set(passwordResetCooldownKey(user.email), '1');
    await service.requestPasswordReset(user.email);
    expect(notifications.queuePasswordReset).not.toHaveBeenCalled();
  });

  it('returns the same response path without queuing mail for an unknown account', async () => {
    accountExists = false;
    await expect(service.requestPasswordReset('missing@example.com')).resolves.toBeNull();
    expect(notifications.queuePasswordReset).not.toHaveBeenCalled();
  });

  it('rejects a wrong code and changes the password once a valid code is used', async () => {
    await service.requestPasswordReset(user.email);
    const code = values.get(passwordResetDevKey(user.email))!;
    await expect(service.resetPassword(user.email, '000000', 'NewSecretPass123!')).rejects.toThrow('Invalid password reset code');
    await service.resetPassword(user.email, code, 'NewSecretPass123!');

    expect(await bcrypt.compare('NewSecretPass123!', savedPasswordHash)).toBe(true);
    expect(values.has(passwordResetKey(user.email))).toBe(false);
    expect(values.has(passwordResetDevKey(user.email))).toBe(false);
    expect(values.has(passwordResetCooldownKey(user.email))).toBe(false);
    expect(values.has('session:active-session')).toBe(false);
    expect(sets.has('user-sessions:41')).toBe(false);
  });

  it('stops accepting codes after eight failed attempts', async () => {
    await service.requestPasswordReset(user.email);
    for (let attempt = 0; attempt < 8; attempt += 1) {
      await expect(service.resetPassword(user.email, '000000', 'NewSecretPass123!')).rejects.toThrow('Invalid password reset code');
    }
    await expect(service.resetPassword(user.email, '000000', 'NewSecretPass123!')).rejects.toThrow('Too many password reset attempts');
    expect(values.has(passwordResetKey(user.email))).toBe(false);
  });

  it('verifies the requested phone number and clears the one-time code', async () => {
    const phone = '+1 (555) 222-3333';
    await service.requestPhoneVerification(user.id, phone);
    const code = await service.devPhoneVerificationCode(user.id);
    await expect(service.verifyPhone(user.id, '+1 (555) 333-4444', code.code)).rejects.toThrow('Invalid phone verification code');
    await expect(service.verifyPhone(user.id, '+1 555 222 3333', code.code)).resolves.toEqual({ phoneVerified: true, phone: '+1 555 222 3333' });
    expect(prisma.patient.updateMany).toHaveBeenCalledWith({ where: { userId: user.id, deletedAt: null }, data: { phone: '+1 555 222 3333', phoneVerified: true } });
    expect(values.has('phone-otp:' + user.id)).toBe(false);
    expect(values.has('phone-otp-phone:' + user.id)).toBe(false);
    expect(values.has('phone-otp-dev:' + user.id)).toBe(false);
    expect(notifications.queuePhoneOtp).toHaveBeenCalledWith(phone, code.code);
  });

  it('registers only at a verified hospital and queues a hashed email code', async () => {
    const result = await service.register({ name: 'New Patient', email: 'NEW@example.com', password: 'LongPassword123!', hospitalCode: 'CITY', phone: '0000000000' });
    expect(result).toEqual({ id: 42, email: 'new@example.com' });
    expect(notifications.queueOtp).toHaveBeenCalledWith('new@example.com', '', expect.stringMatching(/^\d{6}$/));
    expect(values.get('otp:new@example.com')).not.toBe(values.get('otp-dev:new@example.com'));
    prisma.hospital.findFirst.mockResolvedValueOnce(null as never);
    await expect(service.register({ name: 'New Patient', email: 'x@example.com', password: 'LongPassword123!', hospitalCode: 'BAD' })).rejects.toThrow('Unknown or unverified hospital');
  });

  it('verifies email codes, rejects expired or invalid attempts, and enforces the attempt limit', async () => {
    const email = 'patient@example.com';
    const expectedCode = '135790';
    await redisClient.set('otp:' + email, require('crypto').createHash('sha256').update(expectedCode).digest('hex'));
    await expect(service.verifyEmail({ email, otp: '000000' })).rejects.toThrow('Invalid verification code');
    await expect(service.verifyEmail({ email, otp: expectedCode })).resolves.toBeNull();
    expect(prisma.user.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { emailVerified: true } }));
    await expect(service.verifyEmail({ email: 'expired@example.com', otp: expectedCode })).rejects.toThrow('expired');
    for (let count = 0; count < 8; count += 1) redisClient.incr.mockResolvedValueOnce(9);
    await expect(service.verifyEmail({ email: 'blocked@example.com', otp: expectedCode })).rejects.toThrow('Too many verification attempts');
  });

  it('logs in with verified active accounts, creates a rotating session, and rejects invalid credentials', async () => {
    const passwordHash = await bcrypt.hash('DemoPass123!', 4);
    prisma.user.findUnique.mockResolvedValueOnce({ ...activeUser, passwordHash } as never);
    const result = await service.login({ email: activeUser.email, password: 'DemoPass123!' });
    expect(result.user).toMatchObject({ id: 41, role: 'patient', patientId: 8 });
    expect(result.cookies.accessToken).toBe('signed-access-token');
    expect(result.cookies.refreshToken).toContain('.');
    expect(jwt.signAsync).toHaveBeenCalled();
    prisma.user.findUnique.mockResolvedValueOnce(null as never);
    await expect(service.login({ email: activeUser.email, password: 'wrong' })).rejects.toThrow('Wrong email or password');
    prisma.user.findUnique.mockResolvedValueOnce({ ...activeUser, passwordHash, emailVerified: false } as never);
    await expect(service.login({ email: activeUser.email, password: 'DemoPass123!' })).rejects.toThrow('Verify your email');
  });

  it('requires a well-formed refresh token, rejects replay, and clears sessions on logout', async () => {
    await expect(service.refresh(undefined)).rejects.toThrow('Login required');
    redisClient.eval.mockResolvedValueOnce(0);
    await expect(service.refresh('sessionid.secret')).rejects.toThrow('already used');
    const token = 'sessionid.secret';
    values.set('session:sessionid', JSON.stringify({ userId: 41, tokenHash: 'hash' }));
    sets.set('user-sessions:41', new Set(['sessionid']));
    await service.logout(token);
    expect(values.has('session:sessionid')).toBe(false);
    expect(redisClient.srem).toHaveBeenCalledWith('user-sessions:41', 'sessionid');
  });

  it('returns the current active account and hides development OTPs in production', async () => {
    prisma.user.findFirst.mockResolvedValueOnce(activeUser as never);
    expect(await service.me(41)).toMatchObject({ name: 'Demo Patient', role: 'patient' });
    await expect(service.me(404)).rejects.toThrow('Account unavailable');
    process.env.NODE_ENV = 'production';
    await expect(service.devOtp(activeUser.email)).rejects.toThrow('Not found');
    await expect(service.devPasswordResetCode(activeUser.email)).rejects.toThrow('Not found');
    await expect(service.devPhoneVerificationCode(41)).rejects.toThrow('Not found');
    process.env.NODE_ENV = 'test';
  });
});
