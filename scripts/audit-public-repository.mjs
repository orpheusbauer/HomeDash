import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';

const files = execFileSync(
  'git',
  ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
  {
    encoding: 'utf8',
  },
)
  .split('\0')
  .filter(Boolean);
const findings = [];

const riskyPath =
  /(^|\/)(\.env($|\.)|local\.properties$|[^/]+\.(key|pem|p12|pfx|jks|keystore|db|sqlite|sqlite3|apk|aab)$|id_(rsa|ed25519)$)/i;

const secretPatterns = [
  ['clé privée', new RegExp(`BEGIN (RSA |EC |OPENSSH |DSA )?${'PRIVATE'} KEY`)],
  ['token GitHub classique', new RegExp(`g${'hp'}_[A-Za-z0-9]{20,}`)],
  ['token GitHub fin', new RegExp(`github_${'pat'}_[A-Za-z0-9_]{20,}`)],
  ['clé API Google', new RegExp(`AI${'za'}[A-Za-z0-9_-]{30,}`)],
  ['chemin utilisateur Windows', /[A-Za-z]:\\Users\\[^\\\r\n]+\\/i],
  [
    'IPv4 privée codée en dur',
    new RegExp(
      `(?:10\\.\\d+\\.\\d+\\.\\d+|192\\.168\\.\\d+\\.\\d+|172\\.(?:1[6-9]|2\\d|3[01])\\.\\d+\\.\\d+)`,
    ),
  ],
];

for (const file of files) {
  if (riskyPath.test(file) && file !== '.env.example' && !file.endsWith('.env.example')) {
    findings.push({ file, category: 'fichier local ou secret suivi par Git' });
  }
  if (statSync(file).size > 5 * 1024 * 1024) continue;
  const content = readFileSync(file);
  if (content.includes(0)) continue;
  const text = content.toString('utf8');
  for (const [category, pattern] of secretPatterns) {
    if (pattern.test(text)) findings.push({ file, category });
  }
}

const privateMarkers = (process.env.HOMEDASH_PRIVATE_MARKERS ?? '')
  .split(',')
  .map((value) => value.trim().toLowerCase())
  .filter(Boolean);
if (privateMarkers.length > 0) {
  for (const file of files) {
    if (statSync(file).size > 5 * 1024 * 1024) continue;
    const content = readFileSync(file);
    if (content.includes(0)) continue;
    const normalized = content.toString('utf8').toLowerCase();
    if (privateMarkers.some((marker) => normalized.includes(marker))) {
      findings.push({ file, category: 'marqueur privé configuré' });
    }
  }
}

const uniqueFindings = [
  ...new Map(findings.map((finding) => [`${finding.file}\0${finding.category}`, finding])).values(),
];
if (uniqueFindings.length > 0) {
  console.error('Audit public refusé. Les fichiers suivants doivent être examinés :');
  for (const finding of uniqueFindings) console.error(`- ${finding.file} (${finding.category})`);
  process.exitCode = 1;
} else {
  console.log(
    `Audit public courant réussi : ${files.length} fichiers suivis, aucun motif interdit.`,
  );
  console.log("Cet audit ne remplace pas l'analyse de l'historique Git ni GitHub Secret Scanning.");
}
