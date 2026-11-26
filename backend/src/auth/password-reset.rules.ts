import { createHash, timingSafeEqual } from 'node:crypto';

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

export function passwordResetKey(email: string) {
  return 'password-reset:' + sha256(email.trim().toLowerCase());
}

export function passwordResetAttemptsKey(email: string) {
  return passwordResetKey(email) + ':attempts';
}

export function passwordResetDevKey(email: string) {
  return passwordResetKey(email) + ':dev-code';
}

export function passwordResetCooldownKey(email: string) {
  return passwordResetKey(email) + ':cooldown';
}

export function hashPasswordResetCode(code: string) {
  return sha256(code);
}

export function matchesPasswordResetCode(storedHash: string, suppliedCode: string) {
  const expected = Buffer.from(storedHash);
  const supplied = Buffer.from(hashPasswordResetCode(suppliedCode));
  return expected.length === supplied.length && timingSafeEqual(expected, supplied);
}
