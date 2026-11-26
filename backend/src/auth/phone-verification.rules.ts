import { createHash, timingSafeEqual } from 'node:crypto';

const hash = (value: string) => createHash('sha256').update(value).digest('hex');

export const phoneOtpKey = (userId: number) => `phone-otp:${userId}`;
export const phoneOtpPhoneKey = (userId: number) => `phone-otp-phone:${userId}`;
export const phoneOtpDevKey = (userId: number) => `phone-otp-dev:${userId}`;
export const phoneOtpAttemptsKey = (userId: number) => `phone-otp-attempts:${userId}`;
export const phoneOtpCooldownKey = (userId: number) => `phone-otp-cooldown:${userId}`;
export const hashPhoneOtp = (otp: string) => hash(otp);
export const hashPendingPhone = (phone: string) => hash(phone.replace(/[\s()-]/g, ''));

export function verifyPhoneOtp(storedHash: string, supplied: string) {
  const expected = Buffer.from(storedHash);
  const actual = Buffer.from(hashPhoneOtp(supplied));
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function verifyPendingPhone(storedHash: string, supplied: string) {
  const expected = Buffer.from(storedHash);
  const actual = Buffer.from(hashPendingPhone(supplied));
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
