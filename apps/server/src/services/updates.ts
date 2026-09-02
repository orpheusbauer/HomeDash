import { request as httpRequest } from 'node:http';
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync, readFileSync } from 'node:fs';
import { mkdir, readdir, rename, rm, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
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
      size: z.number().int().nonnegative().optional(),
    }),
  ),
});

const releaseManifestSchema = z.object({
  kind: z.literal('native'),
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  tag: z.string().regex(/^v\d+\.\d+\.\d+$/),
  archive: z.string().regex(/^homedash-native-\d+\.\d+\.\d+\.tar\.gz$/),
  checksum: z.string().regex(/^homedash-native-\d+\.\d+\.\d+\.tar\.gz\.sha256$/),
});

export type ReleaseManifest = z.infer<typeof releaseManifestSchema>;
type GitHubRelease = z.infer<typeof releaseSchema>;

const ANDROID_APK_MAX_BYTES = 100 * 1024 * 1024;
const androidDownloads = new Map<string, Promise<PreparedAndroidApk>>();

export type PreparedAndroidApk = {
  path: string;
  fileName: string;
  digest: string;
  size: number;
};

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

async function fetchRelease(path: string): Promise<GitHubRelease | null> {
  const response = await fetch(
    `https://api.github.com/repos/${config.HOMEDASH_GITHUB_REPOSITORY}/releases/${path}`,
    {
      headers: githubHeaders(),
      signal: AbortSignal.timeout(8000),
    },
  );
  if (response.status === 404) return null;
  if (!response.ok)
    throw new AppError(503, 'UPDATE_CHECK_FAILED', 'Impossible de contacter GitHub Releases.');
  return releaseSchema.parse(await response.json());
}

function androidAssetNames(version: string): { apk: string; checksum: string } {
  const apk = `homedash-kiosk-${version}.apk`;
  return { apk, checksum: `${apk}.sha256` };
}

export function parseAndroidChecksum(raw: string, expectedFileName: string): string {
  const match = raw.trim().match(/^([a-f0-9]{64})\s+\*?([^\s]+)$/i);
  if (!match || match[2] !== expectedFileName) {
    throw new AppError(
      503,
      'ANDROID_UPDATE_CHECKSUM_INVALID',
      "La somme de contrôle de l'APK est invalide.",
    );
  }
  return match[1]!.toLowerCase();
}

async function sha256File(path: string): Promise<string> {
  return new Promise((resolveDigest, rejectDigest) => {
    const hash = createHash('sha256');
    const stream = createReadStream(path);
    stream.on('data', (chunk) => {
      if (Buffer.isBuffer(chunk)) hash.update(chunk);
    });
    stream.on('error', rejectDigest);
    stream.on('end', () => resolveDigest(hash.digest('hex')));
  });
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
  android: { version: string | null; downloadAvailable: boolean };
}> {
  const release = await fetchRelease('latest');
  if (!release) {
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
      android: { version: null, downloadAvailable: false },
    };
  }
  const availableVersion = release.tag_name.replace(/^v/, '');
  const androidNames = androidAssetNames(availableVersion);
  const androidDownloadAvailable =
    release.assets.some((asset) => asset.name === androidNames.apk) &&
    release.assets.some((asset) => asset.name === androidNames.checksum);
  const nativeArchive = `homedash-native-${availableVersion}.tar.gz`;
  const nativeChecksum = `${nativeArchive}.sha256`;
  const nativeAssetsAvailable =
    release.assets.some((asset) => asset.name === nativeArchive) &&
    release.assets.some((asset) => asset.name === nativeChecksum);
  const manifest: ReleaseManifest | null = nativeAssetsAvailable
    ? {
        kind: 'native',
        version: availableVersion,
        tag: `v${availableVersion}`,
        archive: nativeArchive,
        checksum: nativeChecksum,
      }
    : null;
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
    android: { version: availableVersion, downloadAvailable: androidDownloadAvailable },
  };
}

async function prepareAndroidApkDownload(version: string): Promise<PreparedAndroidApk> {
  if (!/^\d+\.\d+\.\d+$/.test(version)) {
    throw new AppError(400, 'ANDROID_UPDATE_VERSION_INVALID', 'Version Android invalide.');
  }
  const release = await fetchRelease(`tags/v${version}`);
  if (!release || release.draft || release.prerelease || release.tag_name !== `v${version}`) {
    throw new AppError(404, 'ANDROID_UPDATE_NOT_FOUND', 'Mise à jour Android introuvable.');
  }

  const names = androidAssetNames(version);
  const apkAsset = release.assets.find((asset) => asset.name === names.apk);
  const checksumAsset = release.assets.find((asset) => asset.name === names.checksum);
  if (!apkAsset || !checksumAsset || (apkAsset.size ?? 0) > ANDROID_APK_MAX_BYTES) {
    throw new AppError(404, 'ANDROID_UPDATE_NOT_FOUND', 'APK Android vérifiable introuvable.');
  }

  const checksumResponse = await fetch(checksumAsset.url, {
    headers: githubHeaders('application/octet-stream'),
    signal: AbortSignal.timeout(8000),
  });
  if (!checksumResponse.ok) {
    throw new AppError(503, 'ANDROID_UPDATE_DOWNLOAD_FAILED', 'Somme de contrôle indisponible.');
  }
  const checksumText = await checksumResponse.text();
  if (checksumText.length > 1024) {
    throw new AppError(503, 'ANDROID_UPDATE_CHECKSUM_INVALID', 'Somme de contrôle trop longue.');
  }
  const expectedDigest = parseAndroidChecksum(checksumText, names.apk);

  const cacheDirectory = resolve(config.HOMEDASH_ANDROID_UPDATE_CACHE);
  const destination = resolve(cacheDirectory, names.apk);
  const temporary = resolve(cacheDirectory, `.${names.apk}.${process.pid}.tmp`);
  await mkdir(cacheDirectory, { recursive: true, mode: 0o750 });

  if (existsSync(destination)) {
    const cachedDigest = await sha256File(destination);
    if (cachedDigest === expectedDigest) {
      const details = await stat(destination);
      return { path: destination, fileName: names.apk, digest: expectedDigest, size: details.size };
    }
    await rm(destination, { force: true });
  }

  const apkResponse = await fetch(apkAsset.url, {
    headers: githubHeaders('application/octet-stream'),
    signal: AbortSignal.timeout(120_000),
  });
  if (!apkResponse.ok || !apkResponse.body) {
    throw new AppError(503, 'ANDROID_UPDATE_DOWNLOAD_FAILED', "Impossible de télécharger l'APK.");
  }
  const advertisedSize = Number(apkResponse.headers.get('content-length') ?? 0);
  if (advertisedSize > ANDROID_APK_MAX_BYTES) {
    throw new AppError(413, 'ANDROID_UPDATE_TOO_LARGE', "L'APK dépasse la taille autorisée.");
  }

  let size = 0;
  const hash = createHash('sha256');
  const verifier = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      size += chunk.length;
      if (size > ANDROID_APK_MAX_BYTES) {
        callback(new Error('APK Android trop volumineuse'));
        return;
      }
      hash.update(chunk);
      callback(null, chunk);
    },
  });

  try {
    await rm(temporary, { force: true });
    await pipeline(
      Readable.from(apkResponse.body),
      verifier,
      createWriteStream(temporary, { flags: 'wx', mode: 0o640 }),
    );
    const actualDigest = hash.digest('hex');
    if (actualDigest !== expectedDigest) {
      throw new AppError(
        503,
        'ANDROID_UPDATE_CHECKSUM_MISMATCH',
        "L'APK téléchargée ne correspond pas à sa somme SHA-256.",
      );
    }
    await rename(temporary, destination);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }

  const cachedFiles = await readdir(cacheDirectory);
  await Promise.all(
    cachedFiles
      .filter((name) => /^homedash-kiosk-\d+\.\d+\.\d+\.apk$/.test(name) && name !== names.apk)
      .map((name) => rm(resolve(cacheDirectory, name), { force: true })),
  );
  return { path: destination, fileName: names.apk, digest: expectedDigest, size };
}

export async function prepareAndroidApk(version: string): Promise<PreparedAndroidApk> {
  const running = androidDownloads.get(version);
  if (running) return running;
  const download = prepareAndroidApkDownload(version).finally(() =>
    androidDownloads.delete(version),
  );
  androidDownloads.set(version, download);
  return download;
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
