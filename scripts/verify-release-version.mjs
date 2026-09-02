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

console.log(`Versions de release cohérentes : ${expected} (Android code ${androidCode}).`);
