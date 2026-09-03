import { bootstrapSchema, type BootstrapData } from '@homedash/contracts';

export function cachedBootstrap(): BootstrapData | undefined {
  try {
    const raw = localStorage.getItem('homedash.bootstrap');
    if (!raw) return undefined;
    const parsed = bootstrapSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

export function saveBootstrapCache(data: BootstrapData): void {
  try {
    localStorage.setItem('homedash.bootstrap', JSON.stringify(data));
  } catch {
    // The server response remains usable when browser storage is full or unavailable.
  }
}
