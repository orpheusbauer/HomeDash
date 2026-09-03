# Publier et installer les mises à jour HomeDash

Ce guide part d’une installation fonctionnelle en version `0.3.0` avec l’APK signée déjà présente sur la tablette.

La version `0.4.0` constitue une transition : son installeur ajoute au Raspberry Pi Zero l’agent natif nécessaire au bouton de mise à jour du dashboard. Le passage serveur de `0.3.0` à `0.4.0` demande donc **une dernière commande SSH**. Ensuite, les releases applicatives ordinaires peuvent être installées depuis la tablette. L’APK `0.3.0` sait déjà mettre à jour l’application Android elle-même.

La version `0.4.2` corrige le premier passage par l’autorisation Android « Installer des applications inconnues ». L’APK est désormais téléchargée et vérifiée avant d’ouvrir ce réglage, puis reprise depuis le cache privé au retour dans HomeDash. Trois tentatives sont effectuées en cas de coupure réseau transitoire et l’interface affiche chaque étape.

La version `0.4.3` corrige la disposition tactile et le service caméra et active les **mises à jour automatiques du serveur Pi**. Si l’agent natif 0.4.0 ou ultérieur fonctionne déjà, installez le serveur actuel une fois depuis les paramètres de la tablette. **Aucun nouvel installeur complet ni SSH n’est nécessaire pour cette transition du serveur.** La boucle automatique sera ensuite active pour les releases suivantes. Pour l’APK, utilisez désormais la version 0.4.7 et la procédure ci-dessous si le téléchargement intégré échoue.

La version `0.4.4` corrige l’erreur **A WebView method was called on thread 'DefaultDispatcher-worker-…'** de l’installateur Android : l’adresse affichée par la WebView est maintenant lue sur le thread principal, avant le téléchargement en arrière-plan. Les nouvelles tentatives réutilisent cette même adresse. **Si cette erreur apparaît dans l’APK déjà installée, installez manuellement l’APK signée actuelle 0.4.7 une fois**, selon la procédure de dépannage ci-dessous ; une mise à jour du serveur ne peut pas corriger le code natif de l’ancienne APK.

La version `0.4.5` corrige l’installation automatique du Pi : npm utilisait `/root/.npm`, inaccessible depuis le service protégé par `ProtectHome=true`. Un cache temporaire privé est maintenant passé explicitement à npm et nettoyé après l’installation. Le statut et le journal donnent aussi l’erreur npm réelle, et la boucle explique la suspension d’une version ayant échoué. **Installeur complet 0.4.5 ou ultérieur requis une fois en SSH** : la publication d’une nouvelle archive applicative ne remplace pas le script privilégié déjà installé. Si cette réparation n’a pas encore été appliquée, utilisez la release actuelle selon la procédure ci-dessous.

## Nouveautés de la release 0.4.7

- **Démarrage tablette** : cache Web corrigé, erreurs de redémarrage exclues du cache, fichiers JavaScript manquants traités correctement, vérification des données locales et récupération native de l’affichage. L’association, les réglages et les brouillons sont conservés.
- **Adresse du Pi** : saisie d’un nom ou d’une IP avec ajout automatique de HTTPS ; résolution Android puis mDNS IPv4 pour les noms en `.local`, avec conservation du nom et de la dernière IP connue.
- **Barre supérieure** : suppression de « Votre espace / Accueil » au-dessus de la grille et du bouton Android, bouton d’édition réduit au crayon, heure et date centrées. Les outils d’édition restent accessibles dans leur barre dédiée.
- **Google Calendar** : suppression du résumé « 14 prochains jours / X événements », des noms ou adresses d’agendas dans les cartes et des liens externes par événement. Les couleurs, horaires, lieux, descriptions et actions d’édition restent disponibles.
- **Météo** : localisation à droite du titre des prévisions quotidiennes ; localisation et date à droite du titre des prévisions horaires. La ligne de résumé sous le titre horaire est supprimée.

La release comprend le serveur, l’interface Web, les contrats et l’APK **0.4.7**, avec **versionCode 14**. Les widgets Calendar, prévisions quotidiennes et météo horaire portent également la version **0.4.7**. Voir les [notes de publication complètes](releases/0.4.7.md).

Depuis une installation dont l’installeur 0.4.5 ou ultérieur est déjà en place, la mise à jour applicative du serveur puis de l’APK suffit : cette release ne change ni l’agent privilégié, ni Nginx, ni le runtime ARMv6. Les identifiants OAuth, agendas configurés et dispositions existantes sont conservés.

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
- `package-lock.json`, à la racine et dans ses entrées de workspaces ;
- le fallback `HOMEDASH_VERSION` dans `apps/server/src/config.ts` ;
- `versionName` dans `apps/android/app/build.gradle.kts` ;
- les notes de publication `docs/releases/X.Y.Z.md`, reprises par le workflow Release.

Actualisez aussi la version du widget modifié dans `apps/server/src/widget-catalog.ts`, la présentation du `README.md`, les commandes et noms d’assets de ce guide et le lien `current` illustré dans `docs/architecture.md`.

Incrémentez aussi `versionCode` Android d’au moins 1. Android refuse une APK dont le code n’est pas supérieur à celui déjà installé.

Le contrôle automatisé doit réussir :

```powershell
npm.cmd run release:check
```

Pour la présente release, les valeurs attendues sont `0.4.7` et `versionCode = 14`.

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
git add VERSION package.json package-lock.json apps packages deployment docs scripts .github README.md .env.example .prettierignore eslint.config.js
git diff --cached --check
git diff --cached --stat
git status --short
```

Créez le commit puis poussez :

```powershell
git commit -m "Release 0.4.7: démarrage tablette fiable et interface compacte"
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
git tag -a v0.4.7 -m "HomeDash 0.4.7"
git push origin v0.4.7
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

Dans **Releases > v0.4.7**, vérifiez la présence des quatre fichiers :

```text
homedash-native-0.4.7.tar.gz
homedash-native-0.4.7.tar.gz.sha256
homedash-kiosk-0.4.7.apk
homedash-kiosk-0.4.7.apk.sha256
```

N’installez rien si un fichier manque ou si le workflow est rouge. Corrigez le projet et publiez un nouveau numéro ; ne remplacez pas discrètement les fichiers d’un tag existant.

Le workflow publie les notes de `docs/releases/0.4.7.md` avec la release. Rappelez également que les installations dont l’installeur date d’avant 0.4.5 doivent appliquer la réparation ci-dessous une fois.

## Réparation unique du cache npm — installeur 0.4.5 ou ultérieur requis

Ce défaut concerne le service natif installé avant 0.4.5. Le journal présente notamment :

```text
npm error code ENOENT
npm error syscall mkdir
npm error path /root/.npm
homedash-update-native terminé avec code 254
```

La détection GitHub a fonctionné : l’échec arrive pendant l’installation des dépendances, avant l’arrêt et le basculement du serveur. Les avertissements `ENOTEMPTY` et `TAR_ENTRY_ERROR` qui l’accompagnent sont des conséquences du nettoyage npm après cet échec. Ne supprimez pas les releases actives et ne désactivez pas `ProtectHome`.

Après publication complète de **v0.4.7**, connectez-vous au Pi en SSH si cette réparation n’a pas encore été appliquée. Assurez-vous qu’aucune installation n’est en cours (`update-status.json` ne doit pas indiquer `installing`), puis :

```bash
cd /opt/homedash/repository
git status --short
git fetch --tags origin
git checkout v0.4.7
sudo bash deployment/raspberry-pi-zero/install-native.sh v0.4.7
```

Si `git status --short` montre des changements, arrêtez-vous avant le `checkout` et préservez-les. L’installeur remplace le script et l’agent natifs, puis installe le serveur 0.4.7 en conservant configuration, association, certificat et données. Sur un Zero, patientez jusqu’au message final ; ne coupez pas l’alimentation.

Vérifiez ensuite :

```bash
sudo cat /var/lib/homedash/installed-version
sudo systemctl is-active homedash homedash-native-updater nginx
curl --fail http://127.0.0.1:4100/health/ready
sudo journalctl -u homedash -u homedash-native-updater --since '15 minutes ago' --no-pager
```

Résultat attendu : **0.4.7**, trois services actifs et HTTP 200. Le statut JSON peut encore décrire la dernière tentative effectuée par l’agent, antérieure à cette installation SSH : le fichier `installed-version` et le contrôle de santé vérifient l’installation réelle. Pour les prochaines releases applicatives, la boucle de dix minutes peut à nouveau télécharger et installer sans SSH. Les modifications futures de l’installateur privilégié restent des transitions annoncées explicitement.

Le message `Permission denied` de `cat /var/lib/homedash/installed-version` sans `sudo` est indépendant de l’échec npm : le dossier parent est volontairement protégé. Utilisez `sudo cat`, sans élargir ses permissions.

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
sudo cat /var/lib/homedash/installed-version
sudo systemctl is-active homedash nginx homedash-native-updater
curl --fail http://127.0.0.1:4100/health/ready
sudo journalctl -u homedash -u homedash-native-updater --since '15 minutes ago' --no-pager
```

Résultat attendu : version `0.4.0`, trois services `active` et réponse HTTP 200.

## Partie C — mises à jour automatiques du Pi, puis APK depuis la tablette

Cette procédure s’applique après la transition serveur 0.4.0.

Si le service natif a été installé avant 0.4.5, appliquez d’abord la réparation du cache npm ci-dessus.

### C0. Fonctionnement automatique à partir du serveur 0.4.3

Le serveur vérifie GitHub une minute après son démarrage, puis toutes les dix minutes après chaque vérification. La tablette peut être éteinte ou déconnectée. Le Pi doit rester allumé, son service HomeDash actif et son accès Internet disponible.

Une release stable publiée avec un tag exact `vX.Y.Z`, plus récente que la version installée et contenant l’archive native et son SHA-256, est transmise à l’agent natif déjà installé. Les brouillons, préversions, tags seuls et archives incomplètes ne sont pas installés. L’agent conserve ses téléchargements vérifiés, sa sauvegarde préalable, son basculement atomique et son rollback.

Le délai de dix minutes concerne **la détection**, à compter de la publication effective de la Release par le workflow GitHub. Il faut y ajouter le téléchargement et l’installation des dépendances ; cela peut prendre plusieurs minutes sur le Pi Zero. Ne coupez pas son alimentation pendant l’installation. Ensuite, sur la tablette, **Paramètres > Mises à jour > Vérifier > Installer l’application X.Y.Z** reste la seule étape habituelle. Android demande toujours la confirmation d’installation de l’APK.

Une installation déjà en cours n’est pas doublée. Si l’agent signale un échec ou une interruption, la même version n’est pas réinstallée automatiquement en boucle : corrigez et publiez une nouvelle release, ou relancez explicitement l’installation depuis la tablette après diagnostic. Une simple indisponibilité de GitHub est réessayée au passage suivant.

Depuis 0.4.5, le journal signale cette suspension une fois par tentative échouée, avec la cause disponible. Le nouvel agent ajoute les lignes `npm error` au statut d’échec et à `journalctl` ; le détail intégral reste dans `native-update.log`.

Les valeurs par défaut s’appliquent aussi aux fichiers de configuration existants. Pour les modifier exceptionnellement dans `/etc/homedash/homedash.env` :

```ini
HOMEDASH_AUTO_UPDATE=true
HOMEDASH_AUTO_UPDATE_INTERVAL_MS=600000
```

Utilisez `false` pour désactiver l’installation automatique, puis redémarrez le service `homedash`. Le mode développement n’installe jamais automatiquement de releases. Les opérations privilégiées restent réservées à l’agent natif, sans nouveau service ni nouvelles permissions root.

Pour vérifier les passages de la boucle et les résultats :

```bash
sudo journalctl -u homedash -u homedash-native-updater --since '30 minutes ago' --no-pager
sudo cat /var/lib/homedash/data/update-status.json
sudo cat /var/lib/homedash/installed-version
```

### C1. Mettre à jour le serveur Pi

À utiliser pour installer 0.4.3 la première fois, forcer une vérification/installation, ou si l’automatisme est désactivé. Pour les releases suivantes, la section C0 remplace normalement ces manipulations.

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
3. attendez la fin du téléchargement et de la vérification de l’APK ;
4. la première fois seulement, Android ouvre **Installer des applications inconnues** : autorisez HomeDash, puis revenez ;
5. HomeDash reprend l’APK déjà vérifiée, sans nouveau téléchargement ;
6. confirmez **Mettre à jour** dans l’écran système Android ;
7. rouvrez HomeDash et vérifiez **Application tablette X.Y.Z**.

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

### Écran blanc après une mise à jour — corrigé en 0.4.7

Le correctif 0.4.7 concerne le serveur et l’APK. Le cache Web ne conserve plus les erreurs reçues pendant le redémarrage du Pi et ne renvoie plus une page HTML à la place d’un script manquant. Le serveur force une nouvelle lecture de la page de démarrage et du service worker. Les données locales d’un ancien format sont ignorées et remplacées par la réponse du serveur.

L’APK détecte une interface qui ne démarre pas, tente une réparation du cache des ressources et propose **Réessayer**, **Adresse du serveur** et **Retour à Android** si la connexion reste impossible. Cette réparation ne supprime ni les préférences Android, ni l’association, ni les cookies, ni les brouillons de notes. Elle s’exécute indépendamment des scripts du dashboard.

Après publication de la release 0.4.7, mettre à jour le serveur puis l’APK signée 0.4.7 (versionCode 14). Si l’ancienne APK est déjà bloquée sur un écran blanc, ouvrir la nouvelle APK signée depuis le navigateur ou le gestionnaire de fichiers et choisir **Mettre à jour**, sans désinstaller HomeDash ni effacer ses données.

Vérification sur tablette : conserver une tablette associée et un brouillon de note, mettre à jour l’APK, puis vérifier l’association, l’orientation et le brouillon. Tester aussi un redémarrage du Pi pendant le chargement, un démarrage hors ligne après avoir chargé le dashboard, puis un retour du réseau. Les tests automatisés couvrent les réponses 502, les scripts manquants, le nettoyage ciblé et les données locales incompatibles ; un essai sur la tablette reste nécessaire.

### Erreur rouge « A WebView method was called on thread … » pendant la mise à jour APK

Ce défaut vient du code Android déjà installé : il lit `webView.url` depuis `Dispatchers.IO`. Même un accès en lecture à la WebView doit se faire sur son thread principal. Ajouter des permissions ou réinstaller le serveur ne répare pas cette erreur.

Après publication de la release `v0.4.4` :

1. laissez le Pi installer le serveur 0.4.4, ou lancez sa mise à jour depuis les paramètres ;
2. sur la tablette, ouvrez **Chrome**, puis la page **Releases** du dépôt HomeDash sur GitHub (connectez-vous si le dépôt est privé) ;
3. téléchargez **homedash-kiosk-0.4.4.apk**, l’APK signée publiée par le workflow, pas `app-debug.apk` ; vous pouvez aussi copier ce même fichier depuis le PC par USB ;
4. ouvrez l’APK téléchargée et autorisez temporairement le navigateur ou le gestionnaire de fichiers à installer cette source si Android le demande ;
5. choisissez **Mettre à jour**, **sans désinstaller HomeDash** : avec la même signature et le code de version supérieur, l’adresse du Pi, l’association et les réglages sont conservés ;
6. rouvrez HomeDash et vérifiez **Application tablette 0.4.4**. Les mises à jour suivantes pourront à nouveau utiliser le bouton intégré.

L’ancienne application ne peut pas installer elle-même ce correctif si son téléchargement échoue avant de recevoir l’APK. L’installation manuelle est donc nécessaire une seule fois pour sortir de cette situation. Ne modifiez pas le tag 0.4.3 déjà publié.

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

### Une APK 0.4.0 ou 0.4.1 affiche `Failed to connect …:443`

Ces versions demandaient l’autorisation Android avant de télécharger l’APK. Sur certaines tablettes, la connexion locale n’est pas immédiatement rétablie au retour de ce réglage.

Après avoir autorisé HomeDash comme source, fermez complètement puis rouvrez l’application, déverrouillez les paramètres et touchez de nouveau **Installer l’application 0.4.2**. L’autorisation étant déjà acquise, l’ancienne application tente cette fois le téléchargement sans quitter HomeDash. Si la connexion échoue encore, téléchargez `homedash-kiosk-0.4.2.apk` depuis la Release GitHub sur la tablette et ouvrez le fichier : cette installation manuelle unique conserve l’adresse du Pi, l’association et les réglages de HomeDash. Les mises à jour suivantes utiliseront le flux corrigé.

## Rollback manuel de dernier recours

Le rollback automatique couvre l’échec de démarrage immédiat. Pour un défaut fonctionnel constaté plus tard, identifiez d’abord les versions et sauvegardes :

```bash
readlink -f /opt/homedash/current
ls -la /opt/homedash/releases
ls -lt /var/lib/homedash/data/backups
```

Suivez ensuite [backup-and-restore.md](backup-and-restore.md). Revenir seulement au code ne rétrograde pas automatiquement SQLite ; si une migration incompatible a été appliquée, restaurez aussi la sauvegarde `pre-X.Y.Z-*.tar.gz` créée avant la mise à jour.
