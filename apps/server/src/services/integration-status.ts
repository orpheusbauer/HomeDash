import type { IntegrationHealth } from '@homedash/contracts';

const attempts = new Map<string, { at: string; error: string | null }>();
export const INTEGRATION_RETRY_MS = 60_000;

export function recordIntegrationAttempt(key: string): void {
  // Bound memory even if a client requests many different locations/agendas.
  if (attempts.size >= 256 && !attempts.has(key)) attempts.delete(attempts.keys().next().value!);
  attempts.set(key, { at: new Date().toISOString(), error: null });
}

export function recordIntegrationResult(key: string, error: string | null): void {
  const attempt = attempts.get(key);
  if (attempt) attempt.error = error;
}

export function integrationRetryPending(key: string): boolean {
  const attempt = attempts.get(key);
  return Boolean(attempt?.error && Date.now() - Date.parse(attempt.at) < INTEGRATION_RETRY_MS);
}

export function describeIntegration(
  target: Pick<IntegrationHealth, 'id' | 'kind' | 'label' | 'refreshIntervalMs'>,
  fetchedAt: string | null,
  configured = true,
): IntegrationHealth {
  const attempt = attempts.get(target.id);
  const stale =
    fetchedAt !== null && Date.now() - Date.parse(fetchedAt) >= target.refreshIntervalMs;
  return {
    ...target,
    fetchedAt,
    lastAttemptAt: attempt?.at ?? null,
    lastError: attempt?.error ?? null,
    state: !configured
      ? 'unconfigured'
      : fetchedAt
        ? stale || attempt?.error
          ? 'stale'
          : 'ready'
        : attempt?.error
          ? 'error'
          : 'pending',
  };
}
