# GitHub, releases et mises à jour sûres

Un push sur `main` ne met jamais le Raspberry Pi à jour. Seul un tag SemVer crée une GitHub Release et une image Docker multiarchitecture. L’installation reste un clic administrateur.

## 1. Préparer le dépôt GitHub

Sur GitHub :

1. vérifiez que le dépôt `orpheusbauer/HomeDash` existe ;
2. Settings > Actions > General : autorisez les actions GitHub utilisées par le dépôt ;
3. Workflow permissions : accordez lecture/écriture pour permettre à `release.yml` de créer une release et pousser dans GHCR ;
4. gardez la protection de `main` optionnelle au début, puis exigez la CI quand elle est verte ;
5. vérifiez qu’aucun secret n’est commité ; les secrets de production restent sur le Pi.

## 2. Premier push depuis le PC

Examinez toujours les fichiers avant de les indexer :

```powershell
git status --short
git diff --check
git diff
git add .
git status --short
git diff --cached --stat
git diff --cached
git commit -m "feat: build HomeDash 0.1.0 MVP"
git push origin main
```

Sur GitHub > Actions, attendez que `CI` réussisse : format, lint, types, tests, build web/server et APK Android. Corrigez la CI avant de créer un tag.

Si `origin` n’existait pas :

```powershell
git remote add origin https://github.com/orpheusbauer/HomeDash.git
git push -u origin main
```

Dans ce workspace, `origin` est déjà configuré ; ne répétez pas `remote add`.

## 3. Créer la première release

La valeur dans `VERSION` doit être `0.1.0`, et le tag `v0.1.0` :

```powershell
Get-Content VERSION
git tag -a v0.1.0 -m "HomeDash 0.1.0"
git push origin v0.1.0
```

Le workflow `Release` :

1. construit `deployment/docker/Dockerfile` pour `linux/amd64` et `linux/arm64` ;
2. pousse `ghcr.io/orpheusbauer/homedash:v0.1.0` et `latest` ;
3. récupère le digest immuable SHA-256 ;
4. construit l’APK debug ;
5. publie `homedash-release.json`, l’APK et les notes générées dans GitHub Releases.

Ne déplacez pas un tag publié vers un autre commit. En cas de correction, créez `0.1.1`.

## 4. Fonctionnement du bouton Installer

Le serveur lit uniquement la dernière GitHub Release du dépôt configuré. Le bouton n’est actif que si :

- la version est supérieure à `VERSION` ;
- la release contient `homedash-release.json` valide ;
- l’image est exactement dans l’allowlist `ghcr.io/orpheusbauer/homedash` ;
- le digest a 64 caractères hexadécimaux ;
- le socket de l’agent est présent ;
- l’utilisateur a fourni le token administrateur.

L’agent séparé effectue : sauvegarde SQLite, `docker pull image@digest`, écriture atomique de `release.env`, `docker compose up`, attente de `/health/ready`. Après 90 secondes sans santé, il arrête la candidate, restaure la base pré-mise-à-jour et l’image précédente, puis vérifie le rollback.

Le serveur web n’a ni le socket Docker ni la capacité d’exécuter une commande. L’agent construit des tableaux d’arguments Docker sans shell et n’accepte aucun nom d’image arbitraire.

## 5. Publier une version suivante

Pour une fonctionnalité compatible :

```powershell
# modifier VERSION et les versions package/app si nécessaire
npm run format
npm run lint
npm run typecheck
npm test
npm run build
git add .
git commit -m "feat: describe the feature"
git push origin main
# attendre la CI
git tag -a v0.2.0 -m "HomeDash 0.2.0"
git push origin v0.2.0
```

Règles SemVer : PATCH pour bug compatible, MINOR pour fonctionnalité compatible, MAJOR pour rupture. Tant que le produit est `0.x`, documentez malgré tout les migrations et changements de configuration.

## 6. Mise à jour des fichiers d’exploitation du Pi

L’image met à jour l’application, mais un changement de `compose.yml`, Caddy, systemd ou de l’agent exige aussi une mise à jour contrôlée de `/opt/homedash`. À chaque release qui modifie `deployment/` :

```bash
cd /opt/homedash
sudo git fetch --tags origin
sudo git checkout v0.2.0
sudo bash deployment/raspberry-pi/install-services.sh
sudo systemctl restart homedash-updater homedash
```

Faites cette étape en SSH avec accès physique possible. Une évolution future pourra versionner l’agent séparément, mais il ne doit jamais s’auto-remplacer depuis une requête web.

## 7. Diagnostic et reprise manuelle

```bash
sudo cat /var/lib/homedash/data/update-status.json
sudo journalctl -u homedash-updater --since '30 minutes ago'
sudo cat /var/lib/homedash/data/release.env
sudo docker images ghcr.io/orpheusbauer/homedash --digests
curl -fsS http://127.0.0.1:4100/health/ready
```

Si l’état est `rollback-failed`, n’effacez rien. Sauvegardez `/var/lib/homedash/data`, choisissez un ancien digest connu dans `release.env`, puis relancez Compose. Consultez [backup-and-restore.md](backup-and-restore.md).

## 8. Durcissements avant 1.0

- signer le descripteur de release avec Sigstore/cosign et vérifier la signature sur le Pi ;
- signer l’APK release avec un keystore hors dépôt et secrets GitHub Actions ;
- tester automatiquement une migration destructive puis rollback sur une copie réelle ;
- ajouter une rétention automatique des anciennes images/backups ;
- afficher la progression détaillée de l’agent par WebSocket.
