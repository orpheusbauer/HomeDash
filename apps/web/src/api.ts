import type { ApiErrorPayload } from '@homedash/contracts';

let adminToken = sessionStorage.getItem('homedash.adminToken') ?? '';

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

export function setAdminToken(token: string): void {
  adminToken = token;
  if (token) sessionStorage.setItem('homedash.adminToken', token);
  else sessionStorage.removeItem('homedash.adminToken');
}

export function hasAdminToken(): boolean {
  return Boolean(adminToken);
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
      ...(requiresAdmin && adminToken ? { 'X-HomeDash-Admin': adminToken } : {}),
      ...init.headers,
    },
  });
  if (!response.ok) {
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

export async function verifyAdminToken(token: string): Promise<boolean> {
  setAdminToken(token);
  try {
    await api<{ authenticated: boolean }>('/api/v1/admin/verify', {}, true);
    return true;
  } catch {
    setAdminToken('');
    return false;
  }
}

export function realtimeUrl(): string {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}/api/v1/realtime`;
}
