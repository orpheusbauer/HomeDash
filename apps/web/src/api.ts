import type { ApiErrorPayload } from '@homedash/contracts';

sessionStorage.removeItem('homedash.adminToken');
let adminSession = sessionStorage.getItem('homedash.adminSession') ?? '';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export function setAdminSession(token: string): void {
  adminSession = token;
  if (token) sessionStorage.setItem('homedash.adminSession', token);
  else sessionStorage.removeItem('homedash.adminSession');
}

export function hasAdminSession(): boolean {
  return Boolean(adminSession);
}

export async function api<T>(
  path: string,
  init: RequestInit = {},
  requiresAdmin = false,
): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      Accept: 'application/json',
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...(requiresAdmin && adminSession ? { 'X-HomeDash-Admin': adminSession } : {}),
      ...init.headers,
    },
  });
  if (!response.ok) {
    if (requiresAdmin && response.status === 401) {
      setAdminSession('');
      window.dispatchEvent(new Event('homedash:admin-locked'));
    }
    let payload: ApiErrorPayload | undefined;
    try {
      payload = (await response.json()) as ApiErrorPayload;
    } catch {
      // Network intermediaries do not always return JSON.
    }
    throw new ApiError(
      response.status,
      payload?.error.code ?? 'HTTP_ERROR',
      payload?.error.message ?? `Erreur HTTP ${response.status}`,
      payload?.error.details,
    );
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export async function unlockAdmin(pin: string): Promise<boolean> {
  try {
    const session = await api<{ token: string; expiresAt: string }>('/api/v1/admin/unlock', {
      method: 'POST',
      body: JSON.stringify({ pin }),
    });
    setAdminSession(session.token);
    return true;
  } catch {
    setAdminSession('');
    return false;
  }
}

export function realtimeUrl(): string {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}/api/v1/realtime`;
}
