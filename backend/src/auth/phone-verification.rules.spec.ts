import { hashPendingPhone, hashPhoneOtp, phoneOtpAttemptsKey, phoneOtpCooldownKey, phoneOtpDevKey, phoneOtpKey, verifyPendingPhone, verifyPhoneOtp } from './phone-verification.rules';

describe('patient phone verification rules', () => {
  it('uses per-user ephemeral Redis keys', () => {
    expect(phoneOtpKey(17)).toBe('phone-otp:17');
    expect(phoneOtpDevKey(17)).toBe('phone-otp-dev:17');
    expect(phoneOtpAttemptsKey(17)).toBe('phone-otp-attempts:17');
    expect(phoneOtpCooldownKey(17)).toBe('phone-otp-cooldown:17');
  });

  it('hashes OTP and normalized phone values', () => {
    expect(hashPhoneOtp('123456')).not.toBe('123456');
    expect(hashPendingPhone('+1 (555) 222-3333')).toBe(hashPendingPhone('+1 555 222 3333'));
  });

  it('matches the intended code and number only', () => {
    expect(verifyPhoneOtp(hashPhoneOtp('123456'), '123456')).toBe(true);
    expect(verifyPhoneOtp(hashPhoneOtp('123456'), '654321')).toBe(false);
    expect(verifyPendingPhone(hashPendingPhone('+15552223333'), '+1 555 222 3333')).toBe(true);
    expect(verifyPendingPhone(hashPendingPhone('+15552223333'), '+1 555 444 3333')).toBe(false);
  });
});
