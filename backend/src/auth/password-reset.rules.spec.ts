import {
  hashPasswordResetCode,
  matchesPasswordResetCode,
  passwordResetAttemptsKey,
  passwordResetCooldownKey,
  passwordResetDevKey,
  passwordResetKey,
} from './password-reset.rules';

describe('password reset code rules', () => {
  it('normalizes email addresses before deriving private storage keys', () => {
    expect(passwordResetKey(' User@Example.com ')).toBe(passwordResetKey('user@example.com'));
    expect(passwordResetKey('user@example.com')).not.toContain('user@example.com');
    expect(passwordResetAttemptsKey('USER@example.com')).toBe(passwordResetAttemptsKey('user@example.com'));
  });

  it('keeps dev and cooldown values isolated from the one-time code hash', () => {
    const base = passwordResetKey('user@example.com');
    expect(passwordResetDevKey('user@example.com')).toBe(base + ':dev-code');
    expect(passwordResetCooldownKey('user@example.com')).toBe(base + ':cooldown');
    expect(hashPasswordResetCode('123456')).not.toBe('123456');
  });

  it('compares code hashes safely and rejects incorrect codes', () => {
    const hash = hashPasswordResetCode('123456');
    expect(matchesPasswordResetCode(hash, '123456')).toBe(true);
    expect(matchesPasswordResetCode(hash, '654321')).toBe(false);
    expect(matchesPasswordResetCode('bad', '123456')).toBe(false);
  });
});
