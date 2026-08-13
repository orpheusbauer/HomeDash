import { request as httpRequest } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import { z } from 'zod';
import { config } from '../config.js';
import { AppError } from '../errors.js';

const releaseSchema = z.object({
  tag_name: z.string(),
  name: z.string().nullable(),
  body: z.string().nullable(),
  html_url: z.string().url(),
  published_at: z.string().nullable(),
  prerelease: z.boolean(),
  draft: z.boolean(),
  assets: z.array(
    z.object({
      name: z.string(),
      url: z.string().url(),
      browser_download_url: z.string().url(),
      digest: z.string().nullable().optional(),
    }),
  ),
});

const releaseManifestSchema = z.object({
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  image: z.string().regex(/^ghcr\.io\/[a-z0-9_.-]+\/[a-z0-9_.-]+$/),
  digest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  createdAt: z.string().datetime(),
});

export type ReleaseManifest = z.infer<typeof releaseManifestSchema>;

function githubToken(): string | undefined {
  if (!config.HOMEDASH_GITHUB_TOKEN_FILE) return undefined;
  try {
    const token = readFileSync(config.HOMEDASH_GITHUB_TOKEN_FILE, 'utf8').trim();
    return token || undefined;
  } catch {
    return undefined;
  }
}

function githubHeaders(accept = 'application/vnd.github+json'): Record<string, string> {
  const token = githubToken();
  return {
    Accept: accept,
    'User-Agent': `HomeDash/${config.version}`,
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

function semverParts(value: string): [number, number, number] {
  const match = value.replace(/^v/, '').match(/^(\d+)\.(\d+)\.(\d+)/);
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : [0, 0, 0];
}

export function isNewer(candidate: string, current: string): boolean {
  const left = semverParts(candidate);
  const right = semverParts(current);
  for (let index = 0; index < left.length; index += 1) {
    if (left[index]! > right[index]!) return true;
    if (left[index]! < right[index]!) return false;
  }
  return false;
}

export async function checkForUpdates(): Promise<{
  installedVersion: string;
  availableVersion: string | null;
  updateAvailable: boolean;
  installable: boolean;
  name: string | null;
  changelog: string | null;
  publishedAt: string | null;
  url: string | null;
  manifest: ReleaseManifest | null;
}> {
  const response = await fetch(
    `https://api.github.com/repos/${config.HOMEDASH_GITHUB_REPOSITORY}/releases/latest`,
    {
      headers: githubHeaders(),
      signal: AbortSignal.timeout(8000),
    },
  );
  if (response.status === 404) {
    return {
      installedVersion: config.version,
      availableVersion: null,
      updateAvailable: false,
      installable: false,
      name: null,
      changelog: null,
      publishedAt: null,
      url: null,
      manifest: null,
    };
  }
  if (!response.ok)
    throw new AppError(503, 'UPDATE_CHECK_FAILED', 'Impossible de contacter GitHub Releases.');
  const release = releaseSchema.parse(await response.json());
  const availableVersion = release.tag_name.replace(/^v/, '');
  const manifestAsset = release.assets.find((asset) => asset.name === 'homedash-release.json');
  let manifest: ReleaseManifest | null = null;
  if (manifestAsset) {
    try {
      const manifestResponse = await fetch(manifestAsset.url, {
        headers: githubHeaders('application/octet-stream'),
        signal: AbortSignal.timeout(8000),
      });
      if (manifestResponse.ok)
        manifest = releaseManifestSchema.parse(await manifestResponse.json());
    } catch {
      manifest = null;
    }
  }
  return {
    installedVersion: config.version,
    availableVersion,
    updateAvailable: isNewer(availableVersion, config.version),
    installable: Boolean(
      manifest &&
      manifest.version === availableVersion &&
      existsSync(config.HOMEDASH_UPDATER_SOCKET),
    ),
    name: release.name,
    changelog: release.body,
    publishedAt: release.published_at,
    url: release.html_url,
    manifest,
  };
}

export function updaterRequest<T>(path: string, body?: unknown): Promise<T> {
  if (!existsSync(config.HOMEDASH_UPDATER_SOCKET)) {
    throw new AppError(
      503,
      'UPDATER_NOT_INSTALLED',
      "L'agent de mise à jour n'est pas installé sur cet appareil.",
    );
  }
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const updaterToken = config.HOMEDASH_UPDATER_TOKEN_FILE
      ? readFileSync(config.HOMEDASH_UPDATER_TOKEN_FILE, 'utf8').trim()
      : config.HOMEDASH_UPDATER_TOKEN;
    const request = httpRequest(
      {
        socketPath: config.HOMEDASH_UPDATER_SOCKET,
        path,
        method: payload ? 'POST' : 'GET',
        headers: {
          Accept: 'application/json',
          ...(payload
            ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
            : {}),
          ...(updaterToken ? { Authorization: `Bearer ${updaterToken}` } : {}),
        },
        timeout: 5000,
      },
      (response) => {
        let raw = '';
        response.setEncoding('utf8');
        response.on('data', (chunk) => (raw += chunk));
        response.on('end', () => {
          if ((response.statusCode ?? 500) >= 400) {
            reject(
              new AppError(
                503,
                'UPDATER_ERROR',
                "L'agent de mise à jour a refusé la demande.",
                raw,
              ),
            );
            return;
          }
          try {
            resolve(JSON.parse(raw) as T);
          } catch (error) {
            reject(error instanceof Error ? error : new Error(String(error)));
          }
        });
      },
    );
    request.on('error', reject);
    request.on('timeout', () => request.destroy(new Error('Updater timeout')));
    if (payload) request.write(payload);
    request.end();
  });
}

export async function installUpdate(
  manifest: unknown,
): Promise<{ accepted: boolean; jobId: string }> {
  return updaterRequest('/install', releaseManifestSchema.parse(manifest));
}
