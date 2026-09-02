# Publier et installer les mises à jour HomeDash

Ce guide part d’une installation fonctionnelle en version `0.3.0` avec l’APK signée déjà présente sur la tablette.

La version `0.4.0` constitue une transition : son installeur ajoute au Raspberry Pi Zero l’agent natif nécessaire au bouton de mise à jour du dashboard. Le passage serveur de `0.3.0` à `0.4.0` demande donc **une dernière commande SSH**. Ensuite, les releases applicatives ordinaires peuvent être installées depuis la tablette. L’APK `0.3.0` sait déjà mettre à jour l’application Android elle-même.

## Vue d’ensemble

Une mise à jour comporte deux éléments distincts :

1. **Serveur Raspberry Pi** : interface Web, API, base et widgets. C’est là que se trouvent la plupart des nouveautés.
2. **Application tablette** : enveloppe Android, plein écran, association, présence et installateur APK.

Il faut toujours mettre à jour le serveur avant l’APK. Les données, les paramètres, le certificat local, l’adresse du serveur et l’association de la tablette sont conservés.

## Partie A — publier une nouvelle version depuis le PC

### A1. Choisir le numéro

HomeDash suit `MAJEURE.MINEURE.CORRECTIF` :

- correctif, par exemple `0.4.0` → `0.4.1`, pour une correction compatible ;
- mineure, par exemple `0.4.0` → `0.5.0`, pour de nouvelles fonctions compatibles ;
- majeure, par exemple `0.9.0` → `1.0.0`, pour un changement incompatible important.

Un tag publié ne doit jamais être déplacé ou réutilisé. En cas d’erreur après `v0.4.0`, corrigez et publiez `v0.4.1`.

### A2. Synchroniser tous les numéros de version

Mettez le même numéro dans :

- `VERSION` ;
- `package.json` à la racine ;
- `apps/server/package.json` ;
- `apps/web/package.json` ;
- `packages/contracts/package.json` ;
- les dépendances internes `@homedash/contracts` ;
- `versionName` dans `apps/android/app/build.gradle.kts`.

Incrémentez aussi `versionCode` Android d’au moins 1. Android refuse une APK dont le code n’est pas supérieur à celui déjà installé.

Le contrôle automatisé doit réussir :

```powershell
npm.cmd run release:check
```

Pour la présente release, les valeurs attendues sont `0.4.1` et `versionCode = 8`.

### A3. Exécuter tous les contrôles locaux

Depuis la racine du dépôt :

```powershell
npm.cmd install
npm.cmd run format:check
npm.cmd run lint
npm.cmd run audit:public
npm.cmd run release:check
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
git diff --check
git status --short
```

Corrigez toute erreur avant de continuer. Lisez la sortie de `git status --short` et vérifiez que chaque fichier modifié appartient bien à la release. Ne commitez jamais `.env`, token Google/GitHub, keystore, base SQLite, APK locale ou certificat privé.

### A4. Créer le commit et pousser `main`

Ajoutez uniquement les fichiers voulus, puis contrôlez ce qui sera committé :

```powershell
git add VERSION package.json package-lock.json apps packages deployment docs scripts .github README.md .env.example
git diff --cached --check
git diff --cached --stat
git status --short
```

Créez le commit puis poussez :

```powershell
git commit -m "Release 0.4.1: icônes météo et réveil par mouvement"
git push origin main
```

Si votre branche n’est pas `main`, ouvrez d’abord une pull request et fusionnez-la. Le tag doit désigner le commit effectivement présent sur `main`.

### A5. Attendre la CI avant de créer le tag

Dans GitHub :

1. ouvrez **Actions > CI** ;
2. sélectionnez l’exécution correspondant au commit qui vient d’être poussé ;
3. attendez que les jobs **web-server** et **android** soient verts ;
4. ouvrez les logs si un job est rouge, corrigez sur le PC, créez un nouveau commit et poussez-le ;
5. ne créez le tag qu’une fois la CI du dernier commit entièrement verte.

La CI vérifie formatage, lint, audit public, cohérence des versions, types, tests, build Web/serveur, archive native et APK Android debug.

### A6. Créer et pousser le tag

Vérifiez que `HEAD` correspond bien au commit vert :

```powershell
git status --short
git log -1 --oneline
git tag -a v0.4.1 -m "HomeDash 0.4.1"
git push origin v0.4.1
```

Le push du tag lance automatiquement le workflow **Release**. Ne créez pas manuellement une Release vide dans l’interface GitHub.

### A7. Attendre et vérifier la Release

Dans **GitHub > Actions > Release**, attendez le vert. Le workflow :

1. vérifie que tous les numéros correspondent au tag ;
2. construit le serveur, l’interface et les contrats ;
3. fabrique l’archive native du Pi et son SHA-256 ;
4. reconstruit le keystore depuis les secrets GitHub ;
5. compile l’APK release signée et son SHA-256 ;
6. publie la GitHub Release.

Dans **Releases > v0.4.1**, vérifiez la présence des quatre fichiers :

```text
homedash-native-0.4.1.tar.gz
homedash-native-0.4.1.tar.gz.sha256
homedash-kiosk-0.4.1.apk
homedash-kiosk-0.4.1.apk.sha256
```

N’installez rien si un fichier manque ou si le workflow est rouge. Corrigez le projet et publiez un nouveau numéro ; ne remplacez pas discrètement les fichiers d’un tag existant.

## Partie B — transition unique de 0.3.0 vers 0.4.0

Cette étape installe l’agent natif sécurisé. Elle se fait une fois depuis le PC, en SSH. Elle conserve `/etc/homedash/homedash.env`, la base SQLite, les sauvegardes, le token GitHub et l’autorité de certification.

Connectez-vous au Pi puis exécutez :

```bash
cd /opt/homedash/repository
git status --short
git fetch --tags origin
git checkout v0.4.0
sudo bash deployment/raspberry-pi-zero/install-native.sh v0.4.0
```

Le statut Git doit être propre avant le `checkout`. Ne supprimez pas des modifications inconnues : sauvegardez-les et comprenez-les d’abord.

L’installeur remet en place les services, installe l’agent `homedash-native-updater`, crée son secret local, télécharge les assets de la Release, sauvegarde les données, bascule la version et effectue un health check. Sur un Pi Zero, `npm ci` peut prendre plusieurs minutes. Ne fermez pas SSH et ne coupez pas l’alimentation.

La migration 0.4.0 conserve toutes les positions et dimensions visuelles, mais remet à zéro l’historique temporaire du bouton **Annuler la disposition** afin de convertir la grille de 12 à 48 unités sans restaurer ensuite une ancienne échelle.

Vérifiez ensuite :

```bash
cat /var/lib/homedash/installed-version
sudo systemctl is-active homedash nginx homedash-native-updater
curl --fail http://127.0.0.1:4100/health/ready
sudo journalctl -u homedash -u homedash-native-updater --since '15 minutes ago' --no-pager
```

Résultat attendu : version `0.4.0`, trois services `active` et réponse HTTP 200.

## Partie C — installer les versions suivantes depuis la tablette

Cette procédure s’applique après la transition serveur 0.4.0.

### C1. Mettre à jour le serveur Pi

1. Gardez la tablette alimentée et le Pi connecté à Internet.
2. Ouvrez **HomeDash > Paramètres**.
3. Saisissez le PIN administrateur.
4. Dans **Mises à jour**, touchez **Vérifier**.
5. Vérifiez la version installée et la dernière version proposée.
6. Touchez **Installer X.Y.Z** sous la partie serveur.
7. Ne coupez pas le Pi. L’interface indique que la mise à jour est en cours, devient brièvement indisponible, puis se recharge à la fin.
8. Rouvrez **Paramètres > Mises à jour** et vérifiez que **Serveur Raspberry Pi** affiche `X.Y.Z` et **À jour**.

L’agent n’accepte qu’un numéro SemVer et les noms exacts de l’archive native publiée. Le script télécharge l’archive et son SHA-256 depuis la Release configurée, vérifie le hash et les chemins, installe dans un dossier séparé, crée une sauvegarde, bascule atomiquement `current`, puis restaure automatiquement l’ancienne version si le health check échoue.

### C2. Mettre à jour l’application Android

Après la réussite de la mise à jour serveur :

1. dans **Paramètres > Mises à jour**, touchez de nouveau **Vérifier** ;
2. touchez **Installer l’application X.Y.Z** ;
3. la première fois seulement, Android ouvre **Installer des applications inconnues** : autorisez HomeDash, puis revenez ;
4. confirmez **Mettre à jour** dans l’écran système Android ;
5. rouvrez HomeDash et vérifiez **Application tablette X.Y.Z**.

Android exige toujours cette confirmation visible pour une APK hors Play Store. HomeDash ne la contourne pas. L’adresse du Pi, l’orientation et l’association restent enregistrées.

## Ce qui reste exceptionnellement manuel

Une release qui modifie seulement l’interface, les widgets, l’API ou les migrations SQLite suit la procédure tablette normale.

Une release qui change l’unité `systemd`, Nginx, le runtime Node ARMv6, le script d’update lui-même ou l’agent natif doit annoncer explicitement **installeur complet requis** dans ses notes. Dans ce cas seulement :

```bash
cd /opt/homedash/repository
git fetch --tags origin
git checkout vX.Y.Z
sudo bash deployment/raspberry-pi-zero/install-native.sh vX.Y.Z
```

Ce garde-fou empêche l’agent privilégié de modifier son propre périmètre ou d’exécuter des commandes arbitraires depuis l’interface Web.

## Dépannage

### Le bouton serveur n’apparaît pas

Vérifiez les quatre causes possibles :

- aucune version plus récente n’est publiée ;
- l’archive native ou son `.sha256` manque dans la Release ;
- le Pi n’accède pas à GitHub ;
- l’agent natif n’est pas installé ou actif.

Diagnostic sur le Pi :

```bash
sudo systemctl status homedash-native-updater --no-pager
sudo ls -l /run/homedash-updater/updater.sock /etc/homedash/updater-token
sudo journalctl -u homedash-native-updater -n 100 --no-pager
```

### La mise à jour serveur échoue

La version précédente doit rester active ou être restaurée automatiquement. Consultez :

```bash
sudo tail -n 100 /var/lib/homedash/data/native-update.log
sudo cat /var/lib/homedash/data/update-status.json
sudo journalctl -u homedash --since '30 minutes ago' --no-pager
```

Pour relancer manuellement la même procédure vérifiée :

```bash
sudo homedash-update-native vX.Y.Z
```

### Le bouton APK n’apparaît pas

- mettez d’abord le serveur à la dernière version ;
- vérifiez que l’APK et son `.sha256` existent dans la Release ;
- vérifiez que l’application installée est au moins en version 0.3.0 ;
- vérifiez que la tablette est toujours associée au Pi.

### Android refuse l’APK

La nouvelle APK doit conserver le même `applicationId`, être signée par le même keystore et avoir un `versionCode` supérieur. Si l’un de ces trois éléments diffère, Android refuse la mise à jour pour protéger les données de l’application.

## Rollback manuel de dernier recours

Le rollback automatique couvre l’échec de démarrage immédiat. Pour un défaut fonctionnel constaté plus tard, identifiez d’abord les versions et sauvegardes :

```bash
readlink -f /opt/homedash/current
ls -la /opt/homedash/releases
ls -lt /var/lib/homedash/data/backups
```

Suivez ensuite [backup-and-restore.md](backup-and-restore.md). Revenir seulement au code ne rétrograde pas automatiquement SQLite ; si une migration incompatible a été appliquée, restaurez aussi la sauvegarde `pre-X.Y.Z-*.tar.gz` créée avant la mise à jour.
