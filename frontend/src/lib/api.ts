export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const method = String(init?.method || 'GET').toUpperCase();
  const csrf = typeof document === 'undefined' ? '' : document.cookie.split(';').map((part) => part.trim()).find((part) => part.startsWith('csrf_token='))?.slice('csrf_token='.length) || '';
  const headers = new Headers(init?.headers);
  headers.set('Content-Type', 'application/json');
  if (['POST', 'PATCH', 'DELETE', 'PUT'].includes(method) && csrf) headers.set('X-CSRF-Token', decodeURIComponent(csrf));
  const response = await fetch('/api' + path, {
    ...init,
    credentials: 'include',
    cache: 'no-store',
    headers,
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(payload?.error?.message || payload?.message || 'Request failed');
  return payload as T;
}

export async function apiFormData<T>(path: string, method: string, body: FormData): Promise<T> {
  const csrf = typeof document === 'undefined' ? '' : document.cookie.split(';').map((part) => part.trim()).find((part) => part.startsWith('csrf_token='))?.slice('csrf_token='.length) || '';
  const headers = new Headers();
  if (csrf) headers.set('X-CSRF-Token', decodeURIComponent(csrf));
  const response = await fetch('/api' + path, { method, body, credentials: 'include', cache: 'no-store', headers });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(payload?.error?.message || payload?.message || 'Request failed');
  return payload as T;
}
export function data<T>(payload: { data: T }) { return payload.data; }
