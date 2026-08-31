# Releases et mises à jour natives du Raspberry Pi Zero

HomeDash n’utilise pas Docker sur le Raspberry Pi Zero original. Une GitHub Release contient une archive JavaScript déjà compilée. Le Pi installe chaque version dans un dossier séparé et `/opt/homedash/current` désigne la version active.

À partir de `v0.1.2`, l’updater supprime automatiquement l’ancien long jeton administrateur et configure `HOMEDASH_ADMIN_PIN=0000` avant le redémarrage. Les autres secrets restent inchangés.

## 1. Contenu d’une release

Un tag `vX.Y.Z` lance `.github/workflows/release.yml`. GitHub Actions :

1. installe les dépendances sur un runner puissant ;
2. construit les contrats TypeScript, le serveur et l’interface Vite ;
3. crée `homedash-native-X.Y.Z.tar.gz` ;
4. crée son fichier `homedash-native-X.Y.Z.tar.gz.sha256` ;
5. reconstruit le keystore depuis les secrets GitHub et compile l’APK Android release signée ;
6. publie l’archive native, l’APK et leurs deux SHA-256 dans GitHub Releases.

Le Pi ne compile aucun TypeScript et ne télécharge aucune image GHCR.

## 2. Publier une nouvelle version depuis le PC

Mettez `VERSION`, `package.json` et les trois packages applicatifs à la même version. Exécutez :

```powershell
npm.cmd run format:check
npm.cmd run lint
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
git status --short
```

Committez puis poussez `main`. Attendez une CI entièrement verte. Créez seulement ensuite le tag :

```powershell
git tag -a v0.2.1 -m "HomeDash 0.2.1"
git push origin v0.2.1
```

Ne réutilisez et ne déplacez jamais un tag publié. Cette correction de `v0.2.0` est donc publiée sous `v0.2.1`.

## 3. Vérifier la release dans GitHub

Dans **Actions > Release**, attendez le vert. Dans **Releases > v0.2.1**, vérifiez :

```text
homedash-native-0.2.1.tar.gz
homedash-native-0.2.1.tar.gz.sha256
homedash-kiosk-0.2.1.apk
homedash-kiosk-0.2.1.apk.sha256
```

L’absence du SHA-256 interdit l’installation automatique. Ne fabriquez pas ce fichier manuellement après coup : corrigez le workflow et créez une nouvelle version.

## 4. Mettre à jour le clone de maintenance sur le Pi

```bash
cd /opt/homedash/repository
git status --short
git fetch --tags origin
git checkout v0.2.1
```

Le statut doit être propre. Le clone ne sert pas à compiler ; il apporte les nouveaux scripts de déploiement et la documentation correspondant au tag.

Avant d’installer, recopiez la dernière version du script d’update :

```bash
sudo install -o root -g root -m 0755 \
  deployment/raspberry-pi-zero/update-native.sh \
  /usr/local/sbin/homedash-update-native
```

Si la release modifie l’unité `systemd` ou Nginx, relancez plutôt l’installeur idempotent :

```bash
sudo env HOMEDASH_HOSTNAME=homedash.local HOMEDASH_IP_ADDRESS=192.168.1.124 \
  bash deployment/raspberry-pi-zero/install-native.sh v0.2.1
```

Cette relance complète est **obligatoire pour `v0.2.1`** : elle installe les limites de redémarrage, la politique de core dumps, la rotation du journal, le contrôle disque et retire l’ancien agent Docker. Le fichier `/etc/homedash/homedash.env` et l’autorité de certification existants ne sont pas remplacés.

## 5. Installation normale d’une release

```bash
sudo homedash-update-native v0.2.1
```

Le script :

1. lit le dépôt configuré dans `/etc/homedash/homedash.env` ;
2. utilise `/etc/homedash/github-token` si le dépôt est privé ;
3. télécharge l’archive et le SHA-256 via l’API GitHub ;
4. vérifie le hash et refuse les chemins d’archive dangereux ;
5. installe dans `/opt/homedash/releases/0.2.1` ;
6. lance `npm ci --omit=dev --ignore-scripts` avec un seul job et une limite mémoire ;
7. arrête brièvement HomeDash ;
8. sauvegarde les données dans `/var/lib/homedash/data/backups` ;
9. bascule atomiquement le lien `/opt/homedash/current` ;
10. attend jusqu’à 120 secondes que `/health/ready` réponde ;
11. restaure automatiquement la base et l’ancien lien en cas d’échec.

N’interrompez pas le Pi entre l’arrêt du service et la fin du health check.

## 6. Vérifications après mise à jour

```bash
cat /var/lib/homedash/installed-version
readlink -f /opt/homedash/current
sudo systemctl status homedash --no-pager
curl --fail http://127.0.0.1:4100/health/ready
sudo journalctl -u homedash --since '15 minutes ago' --no-pager
```

Depuis la tablette :

- rechargez l’interface ;
- vérifiez les widgets essentiels ;
- testez une écriture de note ;
- vérifiez la télémétrie de la tablette ;
- confirmez que la version affichée correspond à la release.

## 7. Rollback manuel

Le rollback automatique couvre l’échec de démarrage immédiat. Pour revenir manuellement après un problème fonctionnel découvert plus tard :

```bash
ls -la /opt/homedash/releases
ls -lt /var/lib/homedash/data/backups
sudo systemctl stop homedash
sudo ln -sfn /opt/homedash/releases/0.1.1 /opt/homedash/current
sudo systemctl start homedash
curl --fail http://127.0.0.1:4100/health/ready
```

Attention : revenir seulement au code ne rétrograde pas automatiquement le schéma SQLite. Si la nouvelle version a lancé une migration incompatible, restaurez aussi la sauvegarde `pre-X.Y.Z-*.tar.gz` créée juste avant cette mise à jour. Suivez [backup-and-restore.md](backup-and-restore.md).

## 8. Rotation du token GitHub

Avant l’expiration du fine-grained token :

1. créez un nouveau token limité au dépôt, `Contents: Read-only` ;
2. saisissez-le sur le Pi sans historique :

```bash
read -rsp "Nouveau token GitHub: " GITHUB_RELEASE_TOKEN; echo
printf '%s' "$GITHUB_RELEASE_TOKEN" | sudo tee /etc/homedash/github-token >/dev/null
unset GITHUB_RELEASE_TOKEN
sudo chown root:homedash /etc/homedash/github-token
sudo chmod 0640 /etc/homedash/github-token
```

3. testez la prochaine release ;
4. révoquez l’ancien token dans GitHub.

## 9. Mise à jour de Node.js ARMv6

Ne remplacez pas Node à chaque release HomeDash. La version ARMv6 est verrouillée avec un hash dans `install-node-armv6.sh`.

Avant de changer cette version :

- vérifiez qu’un asset `linux-armv6l` existe réellement ;
- vérifiez sa provenance et son SHA-256 ;
- vérifiez que `node:sqlite` fonctionne ;
- testez HomeDash sur le vrai Pi ;
- gardez l’ancien dossier `/opt/node-v…` jusqu’à validation.

Node 24 n’est actuellement pas produit par la recette ARMv6 utilisée. Ne faites pas pointer `/usr/local/bin/node` vers un binaire ARMv7/ARM64.

## 10. Nettoyage manuel des anciennes releases

Le script ne supprime rien automatiquement. Après plusieurs mises à jour validées, gardez au moins la version active et une version précédente :

```bash
readlink -f /opt/homedash/current
ls -la /opt/homedash/releases
```

Avant toute suppression, vérifiez que le dossier n’est pas la cible de `current` et qu’une sauvegarde exploitable existe. Sur une petite carte SD, surveillez aussi :

```bash
df -h /
du -sh /opt/homedash/releases/* /var/lib/homedash/data/backups/*
```

## 11. Limite actuelle de l’interface de mise à jour

Sur le Zero, la vérification de la dernière release peut utiliser le token GitHub en lecture seule. En revanche, l’installation depuis un bouton de l’interface reste volontairement désactivée : la mise à jour nécessite une commande `sudo` par SSH.

Ce choix évite de donner au serveur web le droit de remplacer son propre code ou de contrôler `systemd`. Une future version pourra ajouter un petit agent natif privilégié avec protocole strict, mais ce n’est pas requis pour l’installation initiale.
