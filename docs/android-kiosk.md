# Tablette Android — installation murale de production

Ce guide cible une tablette sous Android 10 ou ultérieur. HomeDash `0.4.8` utilise le plein écran immersif Android : la barre d’état et la barre de navigation sont masquées pendant l’affichage, mais un glissement depuis le bord inférieur fait réapparaître temporairement Retour, Accueil et les applications récentes. L’application ne devient ni lanceur Android, ni mode kiosque verrouillé ; la sortie se fait avec les gestes système ; le bouton Android a été retiré de la barre supérieure en 0.4.7.

HomeDash conserve en parallèle les fonctions murales utiles : icône dédiée, ouverture automatique après redémarrage, reconnexion au Pi et détection locale de présence. Le délai de veille et le verrouillage configurés dans Android restent applicables pendant l’affichage. Le réveil de l’écran par mouvement est une option distincte, désactivée par défaut : lorsqu’elle est active, la caméra continue son analyse locale pendant que la dalle est éteinte. Le verrouillage anticipé après absence reste une seconde option indépendante. Les deux sont expliquées à la section 8.

## Repères : sur quel appareil exécuter chaque action ?

Dans ce guide, chaque bloc indique explicitement l’appareil concerné :

- **[PC — PowerShell]** : votre ordinateur Windows, utilisé pour GitHub, SSH et le navigateur d’administration ;
- **[PI — terminal SSH]** : les commandes sont saisies après `ssh`, donc réellement exécutées par le Raspberry Pi ;
- **[TABLETTE — Android]** : menus Android, Chrome et application HomeDash ;
- **[GITHUB — navigateur]** : site github.com ouvert depuis le PC ou la tablette.

En production, vous ne lancez ni Vite, ni Node, ni un fichier du dépôt sur le PC. Le serveur tourne sur le Pi sous `systemd`. Le PC et la tablette ouvrent tous les deux l’adresse `https://homedash.local` (ou l’adresse IP réservée à votre Pi).

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
git tag -a v0.4.8 -m "HomeDash 0.4.8 - actualisation horaire et météo nocturne"
git push origin v0.4.8
```

Dans GitHub, ouvrez **Actions > Release** et attendez le vert. Dans **Releases > v0.4.8**, vérifiez la présence de :

```text
homedash-kiosk-0.4.8.apk
homedash-kiosk-0.4.8.apk.sha256
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
$PiHost = "homedash.local"
$PiUser = "VOTRE_UTILISATEUR_DU_PI"
Test-NetConnection $PiHost -Port 22
ssh "$PiUser@$PiHost"
```

Remplacez uniquement la valeur de `$PiUser` par le nom créé dans Raspberry Pi Imager. Si `homedash.local` n’est pas résolu sur votre réseau, remplacez `$PiHost` par l’IP réservée au Pi. `TcpTestSucceeded` doit valoir `True`. Après `ssh`, l’invite ne commence plus par `PS C:\` : les commandes suivantes sont exécutées sur le Pi.

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
- `/opt/homedash/current` pointe vers `/opt/homedash/releases/0.4.8` ;
- le code serveur et la configuration sont présents ;
- Node écoute sur `127.0.0.1:4100`.

Si HomeDash est déjà `active (running)`, passez directement à la section 3.4. Sinon, poursuivez avec la réparation ci-dessous.

### 3.3 Installer ou réparer HomeDash 0.4.8 sur le Pi

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
git checkout v0.4.8

sudo bash deployment/raspberry-pi-zero/install-native.sh v0.4.8
```

Ce script est réexécutable sur une installation existante. Il vérifie l’architecture, installe le runtime Node ARMv6 si nécessaire, remet en place l’unité `systemd`, Nginx et le certificat, retire l’ancien agent Docker s’il subsiste, installe les protections de stockage, télécharge l’archive native `0.4.8`, puis lance un contrôle de santé. Sur un Zero, l’étape `npm ci` peut durer plusieurs minutes. Ne fermez pas SSH et ne coupez pas l’alimentation.

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
  https://homedash.local/health/ready
```

Les deux services doivent répondre `active`, la version doit être `0.4.8`, Node doit être `v22.23.1` avec l’architecture `arm`, et les deux commandes `curl` doivent retourner un JSON contenant :

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
sudo cp /var/lib/homedash/tls/root-ca.crt "$HOME/homedash-root-ca.crt"
sudo chown "$USER:$USER" "$HOME/homedash-root-ca.crt"
sudo chmod 0644 "$HOME/homedash-root-ca.crt"
exit
```

**[PC — PowerShell]** Récupérez et installez uniquement ce certificat public :

```powershell
scp "${PiUser}@${PiHost}:homedash-root-ca.crt" .
Import-Certificate `
  -FilePath .\homedash-root-ca.crt `
  -CertStoreLocation Cert:\CurrentUser\Root
```

N’importez jamais `root-ca.key`. Fermez puis rouvrez Chrome ou Edge et saisissez exactement :

```text
https://homedash.local
```

Le dashboard doit s’afficher, sans `502` et sans alerte de certificat. Cliquez sur l’engrenage en haut à droite, saisissez le PIN `0000`, puis vérifiez que **Serveur Raspberry Pi** affiche `0.4.8`.

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

Si **Désinstaller** reste grisé parce que l’ancienne installation est réellement **Device Owner**, sauvegardez les éléments personnels de la tablette puis effectuez une réinitialisation usine. La réinitialisation de la tablette ne touche pas la base HomeDash du Raspberry Pi. La version `0.4.8` ne réactive ni Device Owner, ni `lock task`.

## 4. Installer l’APK sans relier la tablette au PC

Prérequis : la section 3.4 doit être entièrement verte et le dashboard doit être ouvert sur le PC.

**[TABLETTE — Android]** :

1. ouvrez Chrome ;
2. connectez-vous à GitHub si le dépôt est privé ;
3. ouvrez la Release `v0.4.8` ;
4. téléchargez `homedash-kiosk-0.4.8.apk` ;
5. si Android le demande, autorisez temporairement **Installer des applications inconnues** pour Chrome ou l’application Fichiers ;
6. ouvrez le téléchargement et choisissez **Installer** ;
7. après installation, retirez l’autorisation d’installation inconnue à Chrome ;
8. ouvrez HomeDash depuis sa nouvelle icône verte.

Cette procédure ne nécessite ni câble USB, ni ADB, ni Android Studio. Elle est la **dernière installation manuelle** nécessaire : l’APK `0.4.7` ajoute l’installateur intégré utilisé à la section 12.

## 5. Installer le certificat HTTPS du Pi

Si ce n’est pas déjà fait, transférez sur la tablette le même fichier public `homedash-root-ca.crt` récupéré depuis le Pi à la section 3.5. Ce certificat peut transiter par un câble, un stockage personnel ou un partage local, car il ne contient aucune clé privée.

**[TABLETTE — Android 10]** :

1. **Paramètres > Sécurité > Chiffrement et identifiants** ;
2. **Installer un certificat > Certificat d’autorité de certification** ;
3. sélectionnez `homedash-root-ca.crt` ;
4. testez `https://homedash.local` dans Chrome ;
5. poursuivez uniquement si aucune alerte TLS n’apparaît.

N’installez jamais `root-ca.key` sur la tablette : cette clé privée doit rester sur le Pi et dans les sauvegardes chiffrées.

## 6. Première ouverture et association

Gardez le PC et la tablette devant vous pendant cette étape.

1. **[TABLETTE]** Ouvrez l’icône HomeDash. Dans l’écran natif, saisissez `https://homedash.local` (ou l’IP réservée au Pi), choisissez **Paysage** ou **Portrait**, mais n’inventez pas de code.

   **Depuis HomeDash 0.4.7 :** la saisie accepte aussi un nom ou une IP sans préfixe, par exemple `homedash.local` ou `192.0.2.10`, et ajoute `https://`. Utilisez le nom exact annoncé par le Raspberry Pi.

   Pour un nom en `.local`, l’APK essaie la résolution Android puis une requête mDNS IPv4 sur le Wi-Fi. Elle utilise l’IP obtenue pour le dashboard, l’association, la télémétrie et le téléchargement des mises à jour. Le nom saisi reste enregistré et est résolu à nouveau à l’ouverture de l’application et avec **Réessayer**. La dernière IP connue reste disponible si la résolution échoue temporairement. Le Pi doit annoncer son nom sur ce réseau ; un réseau invité, l’isolation des appareils ou un VPN peut empêcher cette découverte. Dans ce cas, saisir son IP réservée.

   Le certificat HTTPS doit couvrir l’IP utilisée, comme le prévoit l’installeur natif. Aucun contrôle de certificat n’est désactivé. Si le nom fonctionne dans un navigateur mais pas dans un autre, distinguer une erreur de nom introuvable d’une erreur de certificat ; la navigation privée ne répare pas la découverte mDNS. Vérifier le nom exact, l’adresse HTTPS et la confiance dans l’autorité locale.

2. **[PC]** Dans le dashboard ouvert à la section 3.5, cliquez sur l’engrenage, saisissez le PIN `0000`, puis descendez jusqu’à la section **Tablettes**.
3. **[PC]** Cliquez sur **Associer une tablette**. Un code à six chiffres valable dix minutes apparaît.
4. **[TABLETTE]** Recopiez immédiatement ce code, saisissez le nom `Tablette entrée`, puis touchez **Enregistrer et ouvrir HomeDash**.
5. **[TABLETTE]** Acceptez la caméra et les notifications si Android les demande. Le dashboard doit apparaître.
6. **[PC]** Dans **Paramètres > Tablettes**, vérifiez que `Tablette entrée` apparaît avec une date **Vue…** et, après environ une minute, sa batterie.
7. **[PC]** Identifiez l’ancienne association grâce à son ancien nom ou à sa dernière date de connexion, puis cliquez sur sa corbeille. Ne supprimez pas `Tablette entrée`.
8. **[TABLETTE]** Glissez depuis le bord inférieur, testez Retour puis Accueil dans la barre Android temporaire, et rouvrez HomeDash depuis son icône. Vérifiez aussi l’heure et la date centrées dans la barre supérieure.

Le code d’association expire après dix minutes et ne fonctionne qu’une fois. Il n’est plus nécessaire lors des ouvertures suivantes.

## 7. Choisir portrait ou paysage depuis le dashboard

Sur la tablette :

1. ouvrez l’icône engrenage ;
2. saisissez le PIN `0000` ;
3. ouvrez la section **Affichage tablette** ;
4. touchez **Paysage** ou **Portrait**.

Android tourne immédiatement l’activité. HomeDash applique automatiquement :

- une grille de référence unique de 48 colonnes en paysage comme en portrait ;
- des largeurs proportionnelles à l’écran, sans empilement automatique ni conversion des tailles enregistrées ;
- une barre supérieure sur une seule rangée, avec l’onglet Accueil immédiatement à droite du logo ;
- des cartes, marges, titres et onglets adaptés à la largeur disponible.

Depuis 0.4.3, **Terminer** attend l’enregistrement de toute la disposition avant de fermer l’édition. Les actualisations du serveur ne remplacent pas un geste en cours et une interruption tactile libère la grille. En cas de panne réseau, l’édition reste ouverte avec ses modifications : réessayez **Terminer**. **Annuler** abandonne les modifications non enregistrées ; en l’absence de brouillon, il restaure la disposition précédemment sauvegardée. Changer de page en cours d’édition enregistre d’abord la page actuelle.

## 8. Configurer la veille, le réveil par mouvement et le verrouillage

HomeDash ne force pas l’écran à rester allumé. Le délai choisi dans Android s’applique normalement, même quand le dashboard est ouvert et que la tablette est branchée.

### Activer le réveil de l’écran par mouvement

Cette fonction compare environ deux fois par seconde de minuscules trames en niveaux de gris provenant de la caméra frontale. La comparaison et la détection ont lieu uniquement en mémoire sur la tablette : aucune photo ni vidéo n’est créée, conservée ou transmise. Lorsque l’écran est éteint, la détection attend deux secondes avant de s’armer afin d’ignorer le changement d’exposition de la caméra, puis rallume la dalle si une partie significative de l’image change.

**[TABLETTE — Android]** Configuration conseillée :

1. ouvrez **Paramètres Android > Affichage > Veille** et choisissez le délai souhaité, par exemple **1 minute** ;
2. si les **Options pour les développeurs** sont actives, désactivez **Rester activé / Écran toujours allumé pendant la charge** ; désactivez aussi l’économiseur d’écran s’il remplace l’extinction par des photos ou une horloge ;
3. ouvrez l’application HomeDash, puis **Paramètres HomeDash > Affichage tablette > Réveil de l’écran par mouvement** ; cette option n’existe pas dans Chrome, seulement dans l’APK ;
4. touchez **Activer le réveil par mouvement**, puis accordez l’autorisation **Caméra** et, sur Android 13 ou ultérieur, la **Notification** ;
5. touchez **Autoriser l’activité sans restriction** et acceptez l’exclusion d’optimisation de batterie ; selon le fabricant, activez aussi **Démarrage automatique**, **Activité en arrière-plan** ou **Application protégée** pour HomeDash ;
6. laissez HomeDash affiché, attendez l’extinction normale, patientez au moins deux secondes, puis passez devant la caméra frontale ; la dalle doit se rallumer en moins d’une seconde environ ;
7. effectuez plusieurs essais à la distance et avec l’éclairage réels avant de fixer la tablette au mur.

Pendant le fonctionnement, Android affiche son voyant de confidentialité caméra et une notification permanente **HomeDash actif**. Le service conserve le processeur et la caméra actifs alors que seule la dalle est éteinte. Cela consomme davantage d’énergie et peut chauffer : cette fonction est destinée à une tablette murale branchée, à valider pendant au moins 48 heures.

Depuis l’APK 0.4.3, les paramètres distinguent **permission accordée**, **service démarré** et **images effectivement reçues**. Ils montrent le dernier mouvement et un bouton **Réessayer la caméra** en cas de blocage. La caméra et les requêtes réseau utilisent des files séparées, les connexions au Pi expirent après cinq secondes et ML Kit travaille sur une copie privée immédiatement libérée côté CameraX. Une perte d’images déclenche une tentative de réouverture après environ 30 secondes ; les erreurs d’ouverture sont réessayées avec un délai croissant borné à une minute. Une caméra en panne ne déclenche pas l’extinction pour absence.

Les permissions nécessaires sont déjà déclarées : caméra, service de premier plan de type caméra, notifications, verrou CPU et exemption d’optimisation batterie. Il n’existe pas de permission publique « caméra toujours autorisée » qui supprime les restrictions Android. Le service est démarré lorsque HomeDash est visible et reste indépendant de l’activité WebView pendant la veille. Voir les règles officielles [services caméra Android](https://developer.android.com/develop/background-work/services/fgs/service-types#camera) et [permissions pendant l’utilisation](https://developer.android.com/training/permissions/requesting).

Pour diagnostiquer sur la tablette : activez le bouton système **Accès caméra** (Android 12+), fermez les autres applications utilisant la caméra, ouvrez HomeDash puis vérifiez **Caméra opérationnelle** et le dernier mouvement. Coupez temporairement le Wi-Fi : le mouvement doit toujours être détecté. Ensuite, laissez l’écran s’éteindre et testez le réveil après au moins deux secondes. Sans la tablette physique, les tests logiciels ne peuvent garantir que sa ROM conserve la caméra active écran éteint.

La sortie par **Retour** ou par **Retour à Android** dans l’écran natif arrête volontairement la caméra et le service. Le réglage reste mémorisé, mais il faut rouvrir HomeDash pour réarmer la détection. Android impose aussi que le service caméra soit démarré pendant que l’application est visible ; après un redémarrage ou si le constructeur tue l’application, ouvrez HomeDash une fois si la détection n’a pas repris. Certaines ROMs ferment malgré tout la caméra écran éteint : dans ce cas, vérifiez d’abord les réglages batterie/démarrage automatique, puis considérez la fonction comme incompatible avec cette ROM si le problème persiste.

### Ce que signifie « réveiller », et non « déverrouiller »

HomeDash rallume physiquement la dalle, comme un appui sur le bouton d’alimentation. Il ne contourne jamais un PIN, un schéma, un mot de passe, le chiffrement ou l’écran de verrouillage Android.

- pour revoir directement le dashboard, utilisez l’absence de verrouillage sécurisé ou un délai de verrouillage adapté à votre usage et à votre environnement ;
- avec un verrouillage immédiat, le mouvement rallume correctement la dalle mais Android présente son écran de verrouillage ;
- HomeDash ne s’affiche pas par-dessus un écran verrouillé et ne devient ni **Device Owner**, ni lanceur système.

### Option indépendante : verrouiller après 90 secondes d’absence

HomeDash peut demander l’autorisation Android standard **Administrateur de l’appareil** afin d’appeler uniquement le verrouillage après 90 secondes sans visage détecté. Cette option sert à verrouiller plus tôt qu’un délai Android plus long. Elle n’est pas requise pour le réveil par mouvement et reste désactivée par défaut.

Pour l’activer :

1. ouvrez **Paramètres HomeDash > Affichage tablette > Adresse du serveur et association** ;
2. touchez **Activer l’extinction après 90 secondes** ;
3. lisez l’écran Android puis accordez l’autorisation à HomeDash ;
4. pour isoler ce test, réglez temporairement la veille Android sur plus de deux minutes ;
5. revenez au dashboard, quittez le champ de la caméra et vérifiez le verrouillage après environ 90 secondes.

Si les deux options sont actives, l’absence peut verrouiller la tablette puis un mouvement peut rallumer la dalle ; Android présente alors normalement son écran de verrouillage. Pour retirer l’option d’absence, revenez au même écran et touchez **Désactiver l’extinction après 90 secondes**. Si la ROM ne retire pas l’autorisation, faites-le dans **Paramètres Android > Sécurité > Applications d’administration de l’appareil**.

Références de plateforme : [services caméra au premier plan](https://developer.android.com/develop/background-work/services/fgs/service-types), [restrictions de démarrage en arrière-plan](https://developer.android.com/develop/background-work/services/fgs/restrictions-bg-start), [optimisation de batterie et Doze](https://developer.android.com/training/monitoring-device-state/doze-standby) et [API PowerManager](https://developer.android.com/reference/android/os/PowerManager).

## 9. Entrer et sortir de HomeDash au quotidien

Pour ouvrir HomeDash :

- touchez l’icône **HomeDash** sur l’écran d’accueil ;
- après un redémarrage complet, l’application tente de s’ouvrir automatiquement.

Pour revenir à Android :

- glissez du bord inférieur vers le centre pour afficher temporairement la barre Android, puis touchez **Retour** ; ou
- faites le même geste puis touchez le bouton rond **Accueil**.

Le plein écran est uniquement le [mode immersif transitoire prévu par Android](https://developer.android.com/develop/ui/views/layout/immersive) : les barres révélées par un geste se superposent au dashboard et se remasquent après un court délai. HomeDash ne démarre pas `lock task` et ne remplace pas le lanceur du constructeur. La sortie par **Retour** restaure les barres système et arrête le service de présence et la caméra. Le bouton **Accueil** place l’application en arrière-plan ; si le réveil par mouvement est activé, son service peut rester actif. Lorsque vous rouvrez HomeDash, le service redémarre et le plein écran est réappliqué.

Pour changer l’URL ou refaire l’association, ouvrez **Paramètres > Affichage tablette > Adresse du serveur et association**.

## 10. Autoriser un démarrage fiable après reboot

Le récepteur de boot est déjà inclus dans l’APK. Les ROMs de tablettes peuvent néanmoins bloquer les lancements automatiques. Dans les paramètres de votre tablette :

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

Ne collez pas définitivement la tablette avant d’avoir validé la sortie par les gestes système, le redémarrage automatique et les deux orientations.

## 12. Mise à jour future directement depuis HomeDash

Après l’installation manuelle unique de l’APK `0.4.7` et l’installation complète du serveur `0.4.0`, ne retournez plus dans GitHub depuis la tablette et ne réinstallez plus le certificat. Pour chaque nouvelle version applicative :

1. développez et poussez depuis le PC ;
2. attendez la CI verte ;
3. créez un nouveau tag ;
4. attendez la Release signée ;
5. sur la tablette, ouvrez **HomeDash > Paramètres**, puis saisissez le PIN administrateur ;
6. dans **Mises à jour**, touchez **Vérifier** ;
7. touchez d’abord **Installer X.Y.Z** pour le serveur Pi et attendez le redémarrage automatique ;
8. revenez dans **Paramètres > Mises à jour**, touchez **Vérifier**, puis **Installer l’application X.Y.Z** ;
9. lors de la toute première utilisation seulement, Android ouvre **Autoriser depuis cette source** : activez HomeDash puis revenez à l’application ;
10. confirmez **Mettre à jour** dans l’installateur Android ;
11. rouvrez HomeDash et vérifiez les deux versions dans Paramètres.

Le Raspberry Pi télécharge l’APK depuis la Release, refuse les fichiers de plus de 100 Mo, vérifie le SHA‑256 et ne conserve que la dernière APK en cache. La tablette doit déjà être associée : son jeton local protège le téléchargement. Android vérifie ensuite que l’identifiant d’application et la signature sont identiques à la version installée. L’adresse du serveur, l’orientation et l’association restent donc conservées.

Android exige une confirmation visible pour une application distribuée hors Play Store ; HomeDash ne tente pas de contourner ce mécanisme. Si le bouton d’installation n’apparaît pas, vérifiez que le Pi et la tablette ont accès au réseau local, que la Release contient l’APK et son `.sha256`, et que l’application installée est au moins en version `0.4.7`.

N’effacez jamais le keystore et ne changez pas les quatre secrets GitHub sans mettre leurs nouvelles valeurs en cohérence avec le même fichier de clé.

## 13. Recette de validation avant mise au mur

Validez chaque point :

- icône HomeDash visible et ouverture en une pression ;
- aucune barre d’état visible pendant l’affichage normal ;
- glissement depuis le bord inférieur affiche temporairement les trois boutons Android ;
- boutons Retour et Accueil quittent l’application après ce geste ;
- heure et date centrées, bouton crayon et paramètres accessibles sans chevauchement ;
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
- **Erreur de certificat** : réinstallez `root-ca.crt`, vérifiez l’heure et utilisez exactement l’adresse couverte par le certificat, normalement `https://homedash.local`.
- **Orientation inchangée** : vérifiez que vous utilisez bien l’APK `0.4.7` ou ultérieure, pas le site dans Chrome.
- **Bouton de mise à jour tablette absent** : l’APK installée est antérieure à `0.4.7`, la tablette n’est plus associée, ou la Release ne contient pas l’APK et son SHA‑256.
- **Barres Android impossibles à afficher** : commencez le geste exactement sur le bord inférieur et glissez vers le centre ; la commande **Retour à Android** reste disponible dans l’écran natif de configuration et de récupération.
- **Caméra inactive après retour** : rouvrez HomeDash et contrôlez la permission caméra dans les paramètres Android.
- **Le mouvement ne rallume pas la dalle** : vérifiez que l’option est active dans l’APK, que la notification **HomeDash actif** reste présente écran éteint, puis passez la batterie à **Sans restriction** et autorisez le démarrage automatique. Si l’indicateur caméra disparaît dès l’extinction malgré ces réglages, la ROM suspend la caméra et doit être testée avec une mise à jour constructeur ou une autre tablette.
- **La dalle se rallume mais demande un code** : le réveil fonctionne ; le code est le verrouillage Android normal. HomeDash ne le contourne pas. Adaptez le délai de verrouillage système uniquement si le niveau de sécurité du lieu le permet.
- **Faux réveils au changement de lumière** : évitez de placer la caméra face à une fenêtre ou une source lumineuse instable et testez avec l’éclairage définitif. Le changement uniforme d’exposition est filtré, mais une ombre mobile importante reste volontairement considérée comme un mouvement.
- **L’écran ne s’éteint jamais** : vérifiez que l’APK `0.4.7` ou ultérieure est installée, contrôlez **Affichage > Veille**, désactivez **Rester activé pendant la charge** dans les Options pour les développeurs et désactivez l’économiseur d’écran.
- **Le verrouillage facultatif après 90 secondes ne fonctionne pas** : vérifiez l’autorisation Administrateur de l’appareil et testez la caméra en lumière réelle.
- **Un code Android apparaît au réveil** : c’est le verrouillage système normal. Désactivez l’extinction automatique si ce comportement ne vous convient pas.
- **Besoin de modifier le serveur** : Paramètres HomeDash > Affichage tablette > Adresse du serveur et association.
