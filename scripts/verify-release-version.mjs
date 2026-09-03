#!/usr/bin/env node
import { readFileSync } from 'node:fs';

const expected = readFileSync(new URL('../VERSION', import.meta.url), 'utf8').trim();
if (!/^\d+\.\d+\.\d+$/.test(expected)) throw new Error(`VERSION invalide : ${expected}`);

const manifests = [
  '../package.json',
  '../apps/server/package.json',
  '../apps/web/package.json',
  '../packages/contracts/package.json',
];

for (const path of manifests) {
  const document = JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
  if (document.version !== expected) {
    throw new Error(`${path} utilise ${document.version} au lieu de ${expected}`);
  }
  const contractVersion = document.dependencies?.['@homedash/contracts'];
  if (contractVersion !== undefined && contractVersion !== expected) {
    throw new Error(
      `${path} dépend de @homedash/contracts ${contractVersion} au lieu de ${expected}`,
    );
  }
}

const lockfile = JSON.parse(readFileSync(new URL('../package-lock.json', import.meta.url), 'utf8'));
const lockPackages = ['', 'apps/server', 'apps/web', 'packages/contracts'];
if (lockfile.version !== expected) {
  throw new Error(`package-lock.json utilise ${lockfile.version} au lieu de ${expected}`);
}
for (const path of lockPackages) {
  const document = lockfile.packages?.[path];
  if (document?.version !== expected) {
    throw new Error(
      `package-lock.json#packages[${JSON.stringify(path)}] utilise ${document?.version ?? 'aucune version'} au lieu de ${expected}`,
    );
  }
  const contractVersion = document.dependencies?.['@homedash/contracts'];
  if (contractVersion !== undefined && contractVersion !== expected) {
    throw new Error(
      `package-lock.json#packages[${JSON.stringify(path)}] dépend de @homedash/contracts ${contractVersion} au lieu de ${expected}`,
    );
  }
}

const android = readFileSync(
  new URL('../apps/android/app/build.gradle.kts', import.meta.url),
  'utf8',
);
const androidVersion = android.match(/versionName\s*=\s*"([^"]+)"/)?.[1];
const androidCode = Number(android.match(/versionCode\s*=\s*(\d+)/)?.[1]);
if (androidVersion !== expected) {
  throw new Error(`Android utilise ${androidVersion ?? 'aucune version'} au lieu de ${expected}`);
}
if (!Number.isInteger(androidCode) || androidCode < 1) {
  throw new Error('versionCode Android absent ou invalide');
}

const serverConfig = readFileSync(new URL('../apps/server/src/config.ts', import.meta.url), 'utf8');
const serverFallback = serverConfig.match(/HOMEDASH_VERSION\s*\?\?\s*'([^']+)'/)?.[1];
if (serverFallback !== expected) {
  throw new Error(
    `Le fallback HOMEDASH_VERSION du serveur utilise ${serverFallback ?? 'aucune version'} au lieu de ${expected}`,
  );
}

const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');
const readmeVersion = readme.match(/La version `([^`]+)` fournit déjà/)?.[1];
if (readmeVersion !== expected) {
  throw new Error(`Le README présente ${readmeVersion ?? 'aucune version'} au lieu de ${expected}`);
}

const updateGuide = readFileSync(new URL('../docs/updates.md', import.meta.url), 'utf8');
const guideRelease = updateGuide.match(
  /Pour la présente release, les valeurs attendues sont `([^`]+)` et `versionCode = (\d+)`/,
);
if (guideRelease?.[1] !== expected || Number(guideRelease?.[2]) !== androidCode) {
  throw new Error(
    `docs/updates.md attend ${guideRelease?.[1] ?? 'aucune version'} / code ${guideRelease?.[2] ?? 'absent'} au lieu de ${expected} / code ${androidCode}`,
  );
}
const requiredReleaseGuideValues = [
  `git tag -a v${expected} -m "HomeDash ${expected}"`,
  `git push origin v${expected}`,
  `homedash-native-${expected}.tar.gz`,
  `homedash-native-${expected}.tar.gz.sha256`,
  `homedash-kiosk-${expected}.apk`,
  `homedash-kiosk-${expected}.apk.sha256`,
];
for (const value of requiredReleaseGuideValues) {
  if (!updateGuide.includes(value)) {
    throw new Error(`docs/updates.md ne contient pas la valeur de release attendue : ${value}`);
  }
}

const architecture = readFileSync(new URL('../docs/architecture.md', import.meta.url), 'utf8');
const currentRelease = architecture.match(
  /\/opt\/homedash\/current -> \/opt\/homedash\/releases\/([^\s]+)/,
)?.[1];
if (currentRelease !== expected) {
  throw new Error(
    `docs/architecture.md pointe current vers ${currentRelease ?? 'aucune version'} au lieu de ${expected}`,
  );
}

const notes = readFileSync(new URL(`../docs/releases/${expected}.md`, import.meta.url), 'utf8');
if (
  !notes.startsWith(`# HomeDash ${expected}\n`) &&
  !notes.startsWith(`# HomeDash ${expected}\r\n`)
) {
  throw new Error('Les notes de publication ne correspondent pas à VERSION.');
}
if (!notes.includes(`versionCode ${androidCode}`)) {
  throw new Error('Les notes de publication doivent indiquer le versionCode Android.');
}

console.log(`Versions de release cohérentes : ${expected} (Android code ${androidCode}).`);
