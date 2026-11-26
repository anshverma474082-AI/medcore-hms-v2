import { rateLimitBucketKey, rateLimitPolicy, shouldRejectRequest } from './rate-limit.rules';

describe('rate limit policy', () => {
  it('uses the stricter window for authentication routes', () => {
    expect(rateLimitPolicy('/auth/login')).toEqual({ category: 'auth', limit: 100, windowSeconds: 900 });
  });

  it('uses the general API window for other routes', () => {
    expect(rateLimitPolicy('/appointments')).toEqual({ category: 'api', limit: 1000, windowSeconds: 60 });
  });

  it('creates a time bucket key and sanitizes the client address', () => {
    expect(rateLimitBucketKey('::1/attacker', 'auth', 900, 1_800_000))
      .toBe('rate:::1_attacker:auth:2');
  });

  it('rejects only requests above the configured limit', () => {
    expect(shouldRejectRequest(100, 100)).toBe(false);
    expect(shouldRejectRequest(101, 100)).toBe(true);
  });
});
