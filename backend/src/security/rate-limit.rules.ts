export type RateLimitCategory = 'auth' | 'api';

export function rateLimitPolicy(path: string) {
  const isAuth = path.startsWith('/auth/');
  return { category: (isAuth ? 'auth' : 'api') as RateLimitCategory, limit: isAuth ? 100 : 1000, windowSeconds: isAuth ? 900 : 60 };
}

export function rateLimitBucketKey(ip: string, category: RateLimitCategory, windowSeconds: number, now = Date.now()) {
  const safeIp = ip.replace(/[^a-zA-Z0-9:._-]/g, '_');
  const bucket = Math.floor(now / (windowSeconds * 1000));
  return 'rate:' + safeIp + ':' + category + ':' + bucket;
}

export function shouldRejectRequest(count: number, limit: number) {
  return count > limit;
}
