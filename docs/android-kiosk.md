# Tablette Android — installation murale de production

Ce guide cible la qunyiCO Y10 sous Android 10. HomeDash `0.2.1` utilise le plein écran immersif Android : la barre d’état et la barre de navigation sont masquées pendant l’affichage, mais un glissement depuis le bord inférieur fait réapparaître temporairement Retour, Accueil et les applications récentes. L’application ne devient ni lanceur Android, ni mode kiosque verrouillé ; le bouton **Android** reste visible dans la barre supérieure.

HomeDash conserve en parallèle les fonctions murales utiles : icône dédiée, ouverture automatique après redémarrage, écran maintenu actif pendant l’affichage, reconnexion au Pi et détection locale de présence. La caméra s’arrête lorsque vous quittez l’application. L’extinction réelle après absence est une option distincte, désactivée par défaut et expliquée à la section 8.

## Repères : sur quel appareil exécuter chaque action ?

Dans ce guide, chaque bloc indique explicitement l’appareil concerné :

- **[PC — PowerShell]** : votre ordinateur Windows, utilisé pour GitHub, SSH et le navigateur d’administration ;
- **[PI — terminal SSH]** : les commandes sont saisies après `ssh`, donc réellement exécutées par le Raspberry Pi ;
- **[TABLETTE — Android]** : menus Android, Chrome et application HomeDash ;
- **[GITHUB — navigateur]** : site github.com ouvert depuis le PC ou la tablette.

En production, vous ne lancez ni Vite, ni Node, ni un fichier du dépôt sur le PC. Le serveur tourne sur le Pi sous `systemd`. Le PC et la tablette ouvrent tous les deux l’adresse fournie par le Pi : `https://192.168.1.124`.

## 1. Préparer une signature Android durable — une seule fois

Ne publiez plus une APK debug comme version de production. Chaque mise à jour doit être signée avec le même keystore, sinon Android refusera de remplacer l’application installée.

Sur le PC, ouvrez PowerShell et créez un dossier sauvegardé hors du dépôt :

```powershell
$keyDirectory = Join-Path $env:USERPROFILE "Documents\HomeDash-secrets"
New-Item -ItemType Directory -Force -Path $keyDirectory

keytool -genkeypair -v `
  -keystore (Join-Path $keyDirectory "homedash-release.jks") `
  -storetype JKS `
  -alias homedash `
  -keyalg RSA `
  -keysize 4096 `
  -validity 10000
```

Choisissez deux mots de passe longs et uniques : celui du keystore et celui de la clé. Conservez dans un gestionnaire de mots de passe :

- le mot de passe du keystore ;
- l’alias `homedash` ;
- le mot de passe de la clé ;
- une copie de `homedash-release.jks` sur deux supports chiffrés distincts.

La perte du keystore empêcherait toute mise à jour de l’APK déjà installée. Ne placez jamais ce fichier dans Git, OneDrive public, une capture d’écran ou la microSD du Pi.

Convertissez le keystore en Base64 et copiez le résultat dans le presse-papiers :

```powershell
$keyPath = Join-Path $keyDirectory "homedash-release.jks"
$base64 = [Convert]::ToBase64String([IO.File]::ReadAllBytes($keyPath))
Set-Clipboard $base64
```

Dans GitHub, ouvrez le dépôt puis **Settings > Secrets and variables > Actions > New repository secret**. Créez exactement ces quatre secrets :

| Secret GitHub                        | Valeur                           |
| ------------------------------------ | -------------------------------- |
| `HOMEDASH_ANDROID_KEYSTORE_BASE64`   | contenu Base64 du presse-papiers |
| `HOMEDASH_ANDROID_KEYSTORE_PASSWORD` | mot de passe du keystore         |
| `HOMEDASH_ANDROID_KEY_ALIAS`         | `homedash`                       |
| `HOMEDASH_ANDROID_KEY_PASSWORD`      | mot de passe de la clé           |

Le workflow Release s’arrête volontairement si un secret manque. Il publie ensuite une APK signée et son SHA-256.

## 2. Publier la version de production

Depuis le PC, après une CI verte :

```powershell
git tag -a v0.2.1 -m "HomeDash 0.2.1 - correction Raspberry Pi"
git push origin v0.2.1
```

Dans GitHub, ouvrez **Actions > Release** et attendez le vert. Dans **Releases > v0.2.1**, vérifiez la présence de :

```text
homedash-kiosk-0.2.1.apk
homedash-kiosk-0.2.1.apk.sha256
```

L’artifact `homedash-kiosk-debug` du workflow CI reste destiné au développement. Ne l’installez pas sur la tablette murale finale.

## 3. D’abord rendre le serveur du Raspberry Pi opérationnel

**Ne désinstallez pas encore l’ancienne APK.** Le serveur doit fonctionner et être accessible depuis le PC avant toute modification de la tablette.

Le message `502 Bad Gateway nginx` signifie :

```text
PC ou tablette  ->  Nginx du Pi : joignable
Nginx           ->  HomeDash sur 127.0.0.1:4100 : indisponible
```

Ce n’est donc pas un problème d’APK. Nginx est lancé, mais le service Node HomeDash est arrêté, en échec ou pas encore installé.

### 3.1 Se connecter au Raspberry Pi depuis le PC

**[PC — PowerShell]** Ouvrez une nouvelle fenêtre PowerShell :

```powershell
Test-NetConnection 192.168.1.124 -Port 22
ssh <UTILISATEUR_DU_PI>@192.168.1.124
```

Remplacez `<UTILISATEUR_DU_PI>` par le nom créé dans Raspberry Pi Imager, par exemple `orpheus`. `TcpTestSucceeded` doit valoir `True`. Après `ssh`, l’invite ne commence plus par `PS C:\` : les commandes suivantes sont exécutées sur le Pi.

### 3.2 Diagnostiquer le `502` sans rien supprimer

**[PI — terminal SSH]** Exécutez le bloc entier :

```bash
hostname
uname -m
getconf LONG_BIT
hostname -I

sudo systemctl status nginx --no-pager
sudo systemctl status homedash --no-pager
sudo systemctl is-enabled nginx homedash

readlink -f /opt/homedash/current || true
cat /var/lib/homedash/installed-version 2>/dev/null || true
test -f /opt/homedash/current/apps/server/dist/index.js && echo "Code serveur présent" || echo "Code serveur absent"
test -f /etc/homedash/homedash.env && echo "Configuration présente" || echo "Configuration absente"
sudo ss -ltnp | grep -E ':(80|443|4100)\b' || true
```

Pour un Pi Zero original, les résultats matériels attendus sont `armv6l` et `32`. L’état final recherché est :

- `nginx` : `active (running)` ;
- `homedash` : `active (running)` ;
- `/opt/homedash/current` pointe vers `/opt/homedash/releases/0.2.1` ;
- le code serveur et la configuration sont présents ;
- Node écoute sur `127.0.0.1:4100`.

Si HomeDash est déjà `active (running)`, passez directement à la section 3.4. Sinon, poursuivez avec la réparation ci-dessous.

### 3.3 Installer ou réparer HomeDash 0.2.1 sur le Pi

**[PI — terminal SSH]** Vérifiez d’abord que le clone existe :

```bash
test -d /opt/homedash/repository/.git && echo "Clone présent" || echo "Clone absent"
```

Si le résultat est **Clone absent**, arrêtez cette procédure et suivez les sections 2 à 8 de [installation-raspberry-pi.md](installation-raspberry-pi.md). Revenez ici uniquement lorsque l’installeur a terminé.

Si le résultat est **Clone présent** :

```bash
cd /opt/homedash/repository
git status --short
```

La commande ne doit rien afficher. Si elle affiche des fichiers modifiés, ne lancez ni `git reset`, ni suppression : conservez la sortie et demandez un diagnostic.

Si le statut est vide, installez exactement la release publiée :

```bash
cd /opt/homedash/repository
git fetch --tags origin
git checkout v0.2.1

sudo env HOMEDASH_HOSTNAME=homedash.local HOMEDASH_IP_ADDRESS=192.168.1.124 \
  bash deployment/raspberry-pi-zero/install-native.sh v0.2.1
```

Ce script est réexécutable sur une installation existante. Il vérifie l’architecture, installe le runtime Node ARMv6 si nécessaire, remet en place l’unité `systemd`, Nginx et le certificat, retire l’ancien agent Docker s’il subsiste, installe les protections de stockage, télécharge l’archive native `0.2.1`, puis lance un contrôle de santé. Sur un Zero, l’étape `npm ci` peut durer plusieurs minutes. Ne fermez pas SSH et ne coupez pas l’alimentation.

Si le dépôt GitHub est privé, le fichier `/etc/homedash/github-token` doit déjà contenir le token en lecture seule décrit dans la section 7 de [installation-raspberry-pi.md](installation-raspberry-pi.md). Une erreur GitHub `404` pendant l’installation indique généralement que ce token manque, a expiré ou n’a pas `Contents: Read-only` sur ce dépôt.

### 3.4 Vérifier le serveur directement sur le Pi

**[PI — terminal SSH]** Après l’installation ou le redémarrage :

```bash
sudo systemctl is-active homedash nginx
cat /var/lib/homedash/installed-version
readlink -f /opt/homedash/current
/usr/local/bin/node --version
/usr/local/bin/node -p "process.arch"

curl --fail --show-error http://127.0.0.1:4100/health/ready
curl --fail --show-error \
  --cacert /var/lib/homedash/tls/root-ca.crt \
  https://192.168.1.124/health/ready
```

Les deux services doivent répondre `active`, la version doit être `0.2.1`, Node doit être `v22.23.1` avec l’architecture `arm`, et les deux commandes `curl` doivent retourner un JSON contenant :

```json
{ "status": "ready" }
```

Le JSON réel peut aussi contenir `realtimeClients`. Tant que le premier `curl` échoue, Nginx continuera à afficher `502`.

Si le premier `curl` échoue, exécutez :

```bash
sudo systemctl reset-failed homedash
sudo systemctl restart homedash
sleep 10
sudo systemctl status homedash --no-pager -l
sudo journalctl -u homedash -n 150 --no-pager
```

Ne poursuivez pas vers la tablette. Copiez alors les sorties de `status`, `journalctl`, `readlink -f /opt/homedash/current`, `uname -m` et `/usr/local/bin/node --version` pour demander de l’aide. Ces commandes n’affichent pas les mots de passe du fichier `homedash.env`.

Si le premier `curl` fonctionne mais pas le second :

```bash
sudo nginx -t
sudo systemctl restart nginx
sudo systemctl status nginx --no-pager -l
sudo journalctl -u nginx -n 100 --no-pager
```

### 3.5 Ouvrir HomeDash depuis le PC

HomeDash n’est pas ouvert à partir des fichiers présents sur le PC. Le navigateur du PC charge l’application déjà servie par le Raspberry Pi.

**[PI — terminal SSH]** Préparez une copie du certificat public, puis quittez SSH :

```bash
cp /var/lib/homedash/tls/root-ca.crt "$HOME/homedash-root-ca.crt"
sudo chown "$USER:$USER" "$HOME/homedash-root-ca.crt"
chmod 0644 "$HOME/homedash-root-ca.crt"
exit
```

**[PC — PowerShell]** Récupérez et installez uniquement ce certificat public :

```powershell
scp <UTILISATEUR_DU_PI>@192.168.1.124:homedash-root-ca.crt .
Import-Certificate `
  -FilePath .\homedash-root-ca.crt `
  -CertStoreLocation Cert:\CurrentUser\Root
```

N’importez jamais `root-ca.key`. Fermez puis rouvrez Chrome ou Edge et saisissez exactement :

```text
https://192.168.1.124
```

Le dashboard doit s’afficher, sans `502` et sans alerte de certificat. Cliquez sur l’engrenage en haut à droite, saisissez le PIN `0000`, puis vérifiez que **Version installée** affiche `0.2.1`.

À ce stade seulement, le serveur est prêt. Gardez cette page ouverte sur le PC : elle servira à créer le code d’association de la nouvelle APK.

### 3.6 Retirer l’ancienne APK sans perdre les données du Pi

Les anciennes APK utilisaient une signature debug. La nouvelle APK signée ne peut généralement pas les remplacer directement. Les pages, notes et dispositions sont stockées sur le Pi et ne sont pas supprimées par la désinstallation Android.

Ne révoquez pas encore l’ancienne tablette depuis le PC : vous la supprimerez de la liste seulement après la réussite de la nouvelle association.

**[TABLETTE — Android]** Procédez dans cet ordre :

1. quittez l’ancien HomeDash pour atteindre les paramètres Android ;
2. ouvrez **Paramètres > Applications par défaut > Application d’accueil** et remettez le lanceur Android du constructeur si HomeDash est sélectionné ;
3. ouvrez **Paramètres > Sécurité > Applications d’administration de l’appareil** et désactivez HomeDash s’il apparaît comme actif ;
4. ouvrez **Paramètres > Applications > HomeDash > Désinstaller** ;
5. redémarrez la tablette et vérifiez que l’écran d’accueil Android normal apparaît.

Si **Désinstaller** reste grisé parce que l’ancienne installation est réellement **Device Owner**, sauvegardez les éléments personnels de la tablette puis effectuez une réinitialisation usine. La réinitialisation de la tablette ne touche pas la base HomeDash du Raspberry Pi. La version `0.2.1` ne réactive ni Device Owner, ni `lock task`.

## 4. Installer l’APK sans relier la tablette au PC

Prérequis : la section 3.4 doit être entièrement verte et le dashboard doit être ouvert sur le PC.

**[TABLETTE — Android]** :

1. ouvrez Chrome ;
2. connectez-vous à GitHub si le dépôt est privé ;
3. ouvrez la Release `v0.2.1` ;
4. téléchargez `homedash-kiosk-0.2.1.apk` ;
5. si Android le demande, autorisez temporairement **Installer des applications inconnues** pour Chrome ou l’application Fichiers ;
6. ouvrez le téléchargement et choisissez **Installer** ;
7. après installation, retirez l’autorisation d’installation inconnue à Chrome ;
8. ouvrez HomeDash depuis sa nouvelle icône verte.

Cette procédure ne nécessite ni câble USB, ni ADB, ni Android Studio. Pour une mise à jour future, téléchargez la nouvelle APK signée et touchez **Mettre à jour** : données et association seront conservées.

## 5. Installer le certificat HTTPS du Pi

Si ce n’est pas déjà fait, transférez sur la tablette le même fichier public `homedash-root-ca.crt` récupéré depuis le Pi à la section 3.5. Ce certificat peut transiter par un câble, un stockage personnel ou un partage local, car il ne contient aucune clé privée.

**[TABLETTE — Android 10]** :

1. **Paramètres > Sécurité > Chiffrement et identifiants** ;
2. **Installer un certificat > Certificat d’autorité de certification** ;
3. sélectionnez `homedash-root-ca.crt` ;
4. testez `https://192.168.1.124` dans Chrome ;
5. poursuivez uniquement si aucune alerte TLS n’apparaît.

N’installez jamais `root-ca.key` sur la tablette : cette clé privée doit rester sur le Pi et dans les sauvegardes chiffrées.

## 6. Première ouverture et association

Gardez le PC et la tablette devant vous pendant cette étape.

1. **[TABLETTE]** Ouvrez l’icône HomeDash. Dans l’écran natif, saisissez `https://192.168.1.124`, choisissez **Paysage** ou **Portrait**, mais n’inventez pas de code.
2. **[PC]** Dans le dashboard ouvert à la section 3.5, cliquez sur l’engrenage, saisissez le PIN `0000`, puis descendez jusqu’à la section **Tablettes**.
3. **[PC]** Cliquez sur **Associer une tablette**. Un code à six chiffres valable dix minutes apparaît.
4. **[TABLETTE]** Recopiez immédiatement ce code, saisissez le nom `Tablette entrée`, puis touchez **Enregistrer et ouvrir HomeDash**.
5. **[TABLETTE]** Acceptez la caméra et les notifications si Android les demande. Le dashboard doit apparaître.
6. **[PC]** Dans **Paramètres > Tablettes**, vérifiez que `Tablette entrée` apparaît avec une date **Vue…** et, après environ une minute, sa batterie.
7. **[PC]** Identifiez l’ancienne association grâce à son ancien nom ou à sa dernière date de connexion, puis cliquez sur sa corbeille. Ne supprimez pas `Tablette entrée`.
8. **[TABLETTE]** Testez immédiatement le bouton **Android**. Rouvrez HomeDash, glissez depuis le bord inférieur, testez Retour puis Accueil dans la barre Android temporaire, et rouvrez encore HomeDash depuis son icône.

Le code d’association expire après dix minutes et ne fonctionne qu’une fois. Il n’est plus nécessaire lors des ouvertures suivantes.

## 7. Choisir portrait ou paysage depuis le dashboard

Sur la tablette :

1. ouvrez l’icône engrenage ;
2. saisissez le PIN `0000` ;
3. ouvrez la section **Affichage tablette** ;
4. touchez **Paysage** ou **Portrait**.

Android tourne immédiatement l’activité. HomeDash applique automatiquement :

- 12 colonnes en grand paysage ;
- 6 colonnes en portrait de tablette ;
- une seule colonne sur un écran très étroit ;
- une barre supérieure sur deux rangées en portrait ;
- des cartes, marges, titres et onglets adaptés à la largeur disponible.

La transformation responsive n’écrase pas la disposition 12 colonnes enregistrée tant que le mode édition n’est pas activé.

## 8. Facultatif : éteindre l’écran après 90 secondes d’absence

Une application Android ordinaire ne peut pas éteindre réellement l’écran. HomeDash peut demander l’autorisation Android standard **Administrateur de l’appareil** afin d’appeler uniquement le verrouillage de l’écran après 90 secondes sans visage détecté.

Cette option :

- est désactivée par défaut ;
- n’est pas le mode **Device Owner** ;
- n’active ni `lock task`, ni remplacement du lanceur ;
- ne modifie pas le plein écran immersif normal de HomeDash ; Retour et Accueil restent accessibles en glissant depuis le bord inférieur ;
- ne fonctionne que lorsque HomeDash est ouvert ; la caméra et le service s’arrêtent dès que vous quittez l’application.

Pour l’activer :

1. ouvrez **Paramètres HomeDash > Affichage tablette > Adresse du serveur et association** ;
2. touchez **Activer l’extinction après 90 secondes** ;
3. lisez l’écran Android puis accordez l’autorisation à HomeDash ;
4. revenez au dashboard et testez l’extinction puis le réveil par présence.

Si la tablette possède un verrouillage sécurisé, Android peut afficher l’écran de verrouillage après le réveil. HomeDash ne contourne pas cette sécurité. Dans ce cas, désactivez l’option si la saisie du code est gênante et utilisez plutôt un délai d’écran Android, une luminosité faible ou, ultérieurement, un capteur PIR/mmWave externe.

Pour la désactiver, revenez au même écran et touchez **Désactiver l’extinction après 90 secondes**. HomeDash désactive alors la fonction et retire sa propre autorisation d’administration. Si la ROM ne la retire pas, faites-le dans **Paramètres Android > Sécurité > Applications d’administration de l’appareil**.

## 9. Entrer et sortir de HomeDash au quotidien

Pour ouvrir HomeDash :

- touchez l’icône **HomeDash** sur l’écran d’accueil ;
- après un redémarrage complet, l’application tente de s’ouvrir automatiquement.

Pour revenir à Android :

- touchez **Android** en haut à droite du dashboard ; ou
- glissez du bord inférieur vers le centre pour afficher temporairement la barre Android, puis touchez **Retour** ; ou
- faites le même geste puis touchez le bouton rond **Accueil**.

Le plein écran est uniquement le [mode immersif transitoire prévu par Android](https://developer.android.com/develop/ui/views/layout/immersive) : les barres révélées par un geste se superposent au dashboard et se remasquent après un court délai. HomeDash ne démarre pas `lock task` et ne remplace pas le lanceur du constructeur. Lorsque vous quittez l’application, les barres système sont restaurées, le service de présence et la caméra sont arrêtés. Lorsque vous rouvrez HomeDash, le service redémarre et le plein écran est réappliqué.

Pour changer l’URL ou refaire l’association, ouvrez **Paramètres > Affichage tablette > Adresse du serveur et association**.

## 10. Autoriser un démarrage fiable après reboot

Le récepteur de boot est déjà inclus dans l’APK. Les ROMs de tablettes peuvent néanmoins bloquer les lancements automatiques. Dans les paramètres de la Y10 :

1. **Applications > HomeDash > Batterie > Sans restriction** ;
2. activez **Démarrage automatique** si ce menu existe ;
3. autorisez l’activité en arrière-plan ;
4. conservez le Wi-Fi actif en veille ;
5. désactivez l’économiseur de batterie pour HomeDash ;
6. redémarrez physiquement la tablette et attendez deux minutes sans la toucher.

Si la ROM refuse malgré tout d’afficher une application au boot, HomeDash reste accessible en une pression grâce à son icône. Ne remettez pas HomeDash comme lanceur par défaut : cela ferait disparaître à nouveau l’accès normal à Android.

Après un redémarrage, Android exige toujours un premier déverrouillage si la tablette possède un code système. Aucune application ne doit contourner cette étape.

## 11. Montage mural et alimentation

Avant le montage définitif :

1. testez la tablette posée à son emplacement pendant 48 heures ;
2. vérifiez que le support ne masque ni caméra, ni ventilation, ni boutons ;
3. utilisez un câble et une alimentation stables ;
4. gardez une luminosité modérée ;
5. vérifiez la température et l’état physique de la batterie chaque semaine le premier mois ;
6. si la batterie chauffe, gonfle ou reste constamment à 100 %, débranchez immédiatement et mettez en place une prise intelligente ou un cycle de charge adapté.

Ne collez pas définitivement la tablette avant d’avoir validé le bouton **Android**, le redémarrage automatique et les deux orientations.

## 12. Mise à jour future sans ordinateur branché à la tablette

Pour chaque nouvelle version :

1. développez et poussez depuis le PC ;
2. attendez la CI verte ;
3. créez un nouveau tag ;
4. attendez la Release signée ;
5. ouvrez cette Release depuis Chrome sur la tablette ;
6. téléchargez la nouvelle APK ;
7. touchez **Mettre à jour** ;
8. ouvrez HomeDash et vérifiez la version dans Paramètres.

N’effacez jamais le keystore et ne changez pas les quatre secrets GitHub sans mettre leurs nouvelles valeurs en cohérence avec le même fichier de clé.

## 13. Recette de validation avant mise au mur

Validez chaque point :

- icône HomeDash visible et ouverture en une pression ;
- aucune barre d’état visible pendant l’affichage normal ;
- glissement depuis le bord inférieur affiche temporairement les trois boutons Android ;
- boutons Retour et Accueil quittent l’application après ce geste ;
- bouton **Android** quitte l’application ;
- caméra arrêtée après la sortie ;
- réouverture et reconnexion sans nouveau code ;
- passage paysage/portrait depuis Paramètres ;
- onglets et cartes lisibles dans les deux orientations ;
- si l’extinction après absence est activée : extinction, réveil et retrait de l’autorisation testés ;
- redémarrage tablette et ouverture automatique ;
- redémarrage Pi et reconnexion automatique ;
- coupure Internet avec LAN actif : dashboard local toujours disponible ;
- coupure puis retour Wi-Fi sans réinstaller l’APK ;
- fonctionnement continu pendant au moins 48 heures.

## 14. Dépannage

- **L’APK refuse la mise à jour** : l’ancienne APK n’a pas la même signature. Désinstallez-la une seule fois, puis installez la version signée.
- **HomeDash ne démarre pas après reboot** : autorisez démarrage automatique et batterie sans restriction dans la ROM.
- **Écran blanc** : testez l’URL dans Chrome et mettez Android System WebView/Chrome à jour.
- **Erreur de certificat** : réinstallez `root-ca.crt`, vérifiez l’heure et utilisez exactement `https://192.168.1.124`.
- **Orientation inchangée** : vérifiez que vous utilisez bien l’APK `0.2.1`, pas le site dans Chrome.
- **Barres Android impossibles à afficher** : commencez le geste exactement sur le bord inférieur et glissez vers le centre ; le bouton **Android** du dashboard reste la sortie de secours permanente.
- **Caméra inactive après retour** : rouvrez HomeDash et contrôlez la permission caméra dans les paramètres Android.
- **L’écran ne s’éteint pas après absence** : activez l’option native, vérifiez l’autorisation Administrateur de l’appareil et testez la caméra en lumière réelle.
- **Un code Android apparaît au réveil** : c’est le verrouillage système normal. Désactivez l’extinction automatique si ce comportement ne vous convient pas.
- **Besoin de modifier le serveur** : Paramètres HomeDash > Affichage tablette > Adresse du serveur et association.
