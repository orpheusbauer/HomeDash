# Installation complète — Raspberry Pi Zero original, 32 bits, sans Docker

Ce guide vise le **Raspberry Pi Zero, Zero W ou Zero WH original** : BCM2835, un cœur ARMv6 à 1 GHz et 512 Mo de RAM. Il ne vise pas le Zero 2 W, qui est une machine ARM64 différente. HomeDash tourne directement sous `systemd`; Nginx fournit HTTPS et GitHub Actions compile les fichiers lourds avant leur arrivée sur le Pi.

Le Pi ne lance ni Docker, ni TypeScript, ni Vite, ni Gradle. Il télécharge une archive déjà compilée depuis une GitHub Release, vérifie son SHA-256, installe uniquement les dépendances JavaScript d’exécution puis démarre Node.js.

## 0. Limites à connaître avant de commencer

- Le Zero original est utilisable pour un dashboard domestique avec une tablette et quelques capteurs, mais les démarrages et mises à jour sont lents.
- Utilisez Raspberry Pi OS **Lite 32 bits**. N’installez pas de bureau graphique sur ce Pi serveur.
- Les binaires Node.js officiels ne couvrent pas ARMv6. Le projet verrouille le build communautaire Node.js `22.23.1` et son SHA-256. Cette cible reste moins sûre à long terme qu’un Zero 2 W.
- Si le build ARMv6 communautaire disparaît ou si les performances sont insuffisantes, le remplacement matériel recommandé est un Zero 2 W ou un Pi 3/4/5.
- La tablette exécute l’interface. Le Pi ne doit jamais ouvrir Chromium.

## 1. Préparer la release depuis le PC

Votre push GitHub initial est déjà fait. Après avoir récupéré les changements ARMv6 de ce document, poussez-les sur `main` et attendez que la nouvelle CI soit verte :

```powershell
cd "C:\Users\orphe\OneDrive\Bureau\Orpheus\ProjetHomeDash\HomeDash"
git status --short
git add .
git commit -m "Add native Raspberry Pi Zero deployment"
git push origin main
```

Dans GitHub, ouvrez **Actions > CI**. Le dernier run de `main` doit avoir les jobs `web-server` et `android` verts. Le job web vérifie aussi que l’archive native peut être créée et démarrée.

Les tags `v0.1.0`, `v0.1.1` et `v0.1.2` existent déjà et ne doivent pas être déplacés. La version de production murale est publiée en `v0.2.0`. Avant de créer ce tag, configurez les quatre secrets de signature décrits dans [android-kiosk.md](android-kiosk.md).

```powershell
git tag -a v0.2.0 -m "HomeDash 0.2.0 — production murale"
git push origin v0.2.0
```

Attendez ensuite le workflow **Release**. La release doit contenir au minimum :

- `homedash-native-0.2.0.tar.gz` ;
- `homedash-native-0.2.0.tar.gz.sha256` ;
- `homedash-kiosk-0.2.0.apk` ;
- `homedash-kiosk-0.2.0.apk.sha256`.

Ne poursuivez pas l’installation si l’archive native ou son fichier SHA-256 manque.

## 2. Écrire Raspberry Pi OS sur la carte microSD

1. Installez Raspberry Pi Imager sur le PC.
2. Choisissez le modèle Raspberry Pi Zero correspondant.
3. Choisissez **Raspberry Pi OS Lite (32-bit)**. La variante Legacy Bookworm 32 bits est également acceptable.
4. Dans les options avancées, configurez :
   - nom d’hôte `homedash` ;
   - un utilisateur personnel, par exemple `orpheus` ;
   - un mot de passe long ;
   - Wi-Fi et pays `FR` si c’est un Zero W/WH ;
   - fuseau `Europe/Paris` et clavier français ;
   - SSH activé, idéalement avec la clé publique de votre PC.
5. Écrivez la carte et démarrez le Pi avec une alimentation stable.
6. Dans votre routeur, réservez l’adresse `192.168.1.124` au Pi. Une réservation DHCP est préférable à une IP statique saisie à deux endroits.

Un Zero sans Wi-Fi nécessite un adaptateur USB OTG Ethernet ou Wi-Fi compatible.

## 3. Connexion et vérification impérative du matériel

Depuis PowerShell :

```powershell
ssh votre-utilisateur@192.168.1.124
```

Sur le Pi :

```bash
cat /proc/device-tree/model; echo
uname -m
getconf LONG_BIT
free -h
df -h /
```

Pour le modèle visé, les deux lignes importantes doivent être :

```text
armv6l
32
```

Si `uname -m` affiche `aarch64`, vous avez probablement un Zero 2 W avec un OS 64 bits : n’utilisez pas l’installeur ARMv6. Si le modèle est bien un Zero original mais que l’architecture diffère, arrêtez-vous et vérifiez l’image OS.

## 4. Mettre le système à jour et installer les outils légers

```bash
sudo apt update
sudo apt full-upgrade -y
sudo apt install -y ca-certificates curl git jq nginx openssl xz-utils
sudo reboot
```

Reconnectez-vous ensuite en SSH et revérifiez l’adresse :

```bash
hostname -I
ip -4 route
```

Le Pi doit toujours avoir `192.168.1.124`. Si l’adresse a changé, corrigez d’abord la réservation DHCP : le certificat HTTPS contiendra cette IP.

## 5. Donner au Pi un accès Git en lecture seule

Le dépôt est privé. Le moyen propre pour `git clone` est une **Deploy key** en lecture seule.

Sur le Pi, avec votre utilisateur normal :

```bash
install -d -m 0700 ~/.ssh
ssh-keygen -t ed25519 -f ~/.ssh/homedash_deploy -C "homedash-pi-zero" -N ""
cat ~/.ssh/homedash_deploy.pub
```

Copiez toute la ligne publique. Dans GitHub :

1. ouvrez le dépôt `orpheusbauer/HomeDash` ;
2. ouvrez **Settings > Deploy keys > Add deploy key** ;
3. nommez-la `Raspberry Pi Zero HomeDash` ;
4. collez la clé publique ;
5. **ne cochez pas** l’autorisation d’écriture ;
6. validez.

Créez ensuite la configuration SSH du Pi :

```bash
cat >> ~/.ssh/config <<'EOF'
Host github-homedash
  HostName github.com
  User git
  IdentityFile ~/.ssh/homedash_deploy
  IdentitiesOnly yes
EOF
chmod 0600 ~/.ssh/config
ssh -T github-homedash
```

À la première connexion, comparez l’empreinte proposée avec les empreintes SSH publiées par GitHub avant de répondre `yes`. GitHub doit ensuite indiquer que l’authentification a réussi mais que l’accès shell n’est pas fourni ; c’est normal.

## 6. Cloner le dépôt dans `/opt/homedash/repository`

```bash
sudo install -d -o "$USER" -g "$USER" -m 0755 /opt/homedash
git clone git@github-homedash:orpheusbauer/HomeDash.git /opt/homedash/repository
cd /opt/homedash/repository
git fetch --tags origin
git checkout v0.2.0
git status --short --branch
```

Le statut doit être propre et indiquer le tag ou le commit de `v0.2.0`. Le clone fournit les scripts, unités `systemd` et guides ; l’application compilée sera téléchargée depuis la release.

## 7. Créer un token GitHub limité pour télécharger la release privée

Une Deploy key permet le clone Git, mais pas le téléchargement d’assets privés via l’API Releases. Créez sur GitHub un **fine-grained personal access token** limité :

- propriétaire : votre compte ;
- accès au seul dépôt `HomeDash` ;
- permission **Contents: Read-only** ;
- aucune permission d’écriture ;
- expiration définie et notée dans votre calendrier.

Sur le Pi, saisissez-le sans l’ajouter à l’historique du shell :

```bash
sudo install -d -o root -g root -m 0755 /etc/homedash
read -rsp "Token GitHub en lecture seule: " GITHUB_RELEASE_TOKEN; echo
printf '%s' "$GITHUB_RELEASE_TOKEN" | sudo tee /etc/homedash/github-token >/dev/null
unset GITHUB_RELEASE_TOKEN
sudo chown root:root /etc/homedash/github-token
sudo chmod 0600 /etc/homedash/github-token
```

Si le dépôt devient public, ce fichier est facultatif. Ne copiez jamais ce token dans Git, une capture d’écran ou un message.

## 8. Lancer l’installation native automatisée

Toujours depuis le clone :

```bash
cd /opt/homedash/repository
sudo env HOMEDASH_HOSTNAME=homedash.local HOMEDASH_IP_ADDRESS=192.168.1.124 \
  bash deployment/raspberry-pi-zero/install-native.sh v0.2.0
```

Le script effectue les opérations suivantes :

1. vérifie `armv6l` et le mode 32 bits ;
2. télécharge Node.js ARMv6 `22.23.1` ;
3. vérifie le hash SHA-256 du binaire avant extraction ;
4. teste réellement `node:sqlite` ;
5. crée l’utilisateur système non connecté `homedash` ;
6. configure le PIN administrateur `0000` et génère deux secrets aléatoires dans `/etc/homedash/homedash.env` ;
7. crée une autorité de certification locale et un certificat pour `homedash.local` et `192.168.1.124` ;
8. configure Nginx ;
9. télécharge l’archive `v0.2.0` et son SHA-256 depuis GitHub ;
10. installe uniquement les dépendances de production du serveur, sans les bibliothèques de build/front déjà compilé et avec les scripts npm désactivés ;
11. démarre HomeDash et attend `/health/ready` ;
12. restaure automatiquement la version/base précédente si le health check échoue.

Sur un Zero, cette étape peut prendre plusieurs minutes. Ne coupez pas l’alimentation pendant `npm ci`.

## 9. Vérifier le service natif

```bash
/usr/local/bin/node --version
/usr/local/bin/node -p "process.arch"
cat /var/lib/homedash/installed-version
sudo systemctl status homedash nginx --no-pager
sudo journalctl -u homedash -n 100 --no-pager
curl --fail http://127.0.0.1:4100/health/ready
curl --fail --cacert /var/lib/homedash/tls/root-ca.crt https://192.168.1.124/health/ready
```

Valeurs attendues :

- Node `v22.23.1` ;
- architecture Node `arm` ;
- version installée `0.2.0` ;
- services `active (running)` ;
- deux réponses de santé HTTP 200.

Les fichiers importants sont :

```text
/opt/homedash/repository             clone Git et scripts
/opt/homedash/releases/0.2.0         application précompilée
/opt/homedash/current                lien vers la release active
/etc/homedash/homedash.env           secrets et configuration
/etc/homedash/github-token           token GitHub lecture seule
/var/lib/homedash/data/homedash.db   base SQLite
/var/lib/homedash/data/backups       sauvegardes avant mise à jour
/var/lib/homedash/tls/root-ca.crt     CA publique à installer sur la tablette
```

## 10. Copier et installer le certificat sur la tablette

Le certificat à transmettre est public. Ne copiez jamais `root-ca.key`.

Sur le Pi :

```bash
cp /var/lib/homedash/tls/root-ca.crt "$HOME/homedash-root-ca.crt"
sudo chown "$USER:$USER" "$HOME/homedash-root-ca.crt"
chmod 0644 "$HOME/homedash-root-ca.crt"
```

Depuis le PC :

```powershell
scp votre-utilisateur@192.168.1.124:homedash-root-ca.crt .
```

Transférez `homedash-root-ca.crt` sur la tablette. Sous Android 10, cherchez généralement :

1. **Paramètres > Sécurité** ;
2. **Chiffrement et identifiants** ou **Installer depuis le stockage** ;
3. **Certificat CA** ;
4. sélectionnez le fichier et confirmez.

Testez ensuite `https://192.168.1.124` dans Chrome sur la tablette. Il ne doit rester aucune alerte de certificat. Si `homedash.local` fonctionne sur votre réseau, vous pouvez aussi utiliser `https://homedash.local`.

## 11. Installer et associer l’application Android

Téléchargez l’APK signée `homedash-kiosk-0.2.0.apk` depuis la GitHub Release, puis suivez [android-kiosk.md](android-kiosk.md). N’utilisez plus l’artifact debug de la CI sur la tablette murale.

Dans l’écran de configuration de l’application, utilisez :

```text
https://192.168.1.124
```

Dans HomeDash depuis un navigateur administrateur :

1. ouvrez les paramètres ;
2. saisissez le code PIN administrateur `0000` ;
3. créez un code d’association ;
4. saisissez ce code sur la tablette ;
5. accordez les permissions nécessaires ;
6. vérifiez la remontée batterie/charge et la détection de présence.

L’extinction de l’écran après absence est facultative et désactivée par défaut. Elle se configure sans ADB dans l’écran natif de l’application ; consultez la section 8 de [android-kiosk.md](android-kiosk.md) avant de l’activer.

Le PIN est configuré dans `/etc/homedash/homedash.env`. Pour vérifier sa présence :

```bash
sudo grep '^HOMEDASH_ADMIN_PIN=' /etc/homedash/homedash.env
```

Le navigateur échange ce PIN contre une session aléatoire valable huit heures dans l’onglet courant. Le PIN n’est donc pas envoyé avec chaque modification. Cinq tentatives de déverrouillage par minute sont autorisées au maximum.

## 12. ESP32 et port capteur limité

Nginx écoute `192.168.1.124:4100` uniquement pour :

```text
POST /api/v1/sensors/ingest
```

Toutes les autres routes sur ce port renvoient `403`. L’exemple ESP32 existant peut donc conserver :

```text
http://192.168.1.124:4100/api/v1/sensors/ingest
```

Le token capteur circule alors en clair sur le LAN. Utilisez un VLAN IoT isolé ou adaptez ultérieurement l’ESP32 à la CA privée et HTTPS. L’interface tablette et l’administration passent toujours par HTTPS.

## 13. Réduire les risques liés aux 512 Mo de RAM

Le service est configuré avec :

- heap Node limité à 192 Mo ;
- avertissement `systemd` à 320 Mo ;
- limite dure à 400 Mo ;
- métriques système toutes les 30 secondes ;
- capteurs simulés périodiques désactivés en production ;
- un seul worker Nginx suffisant.

Surveillez pendant la première journée :

```bash
free -h
ps -o pid,rss,%mem,%cpu,cmd -C node
systemctl show homedash -p MemoryCurrent -p MemoryPeak
sudo journalctl -k | grep -i -E 'out of memory|oom|killed process'
```

Si `npm ci` est tué pendant une installation, ajoutez temporairement 256 Mo de swap, relancez, puis désactivez ce swap afin de limiter l’usure de la microSD :

```bash
sudo fallocate -l 256M /var/swap-homedash
sudo chmod 0600 /var/swap-homedash
sudo mkswap /var/swap-homedash
sudo swapon /var/swap-homedash
swapon --show
```

Après l’installation réussie :

```bash
sudo swapoff /var/swap-homedash
sudo rm /var/swap-homedash
```

## 14. Commandes quotidiennes

```bash
sudo systemctl restart homedash
sudo systemctl status homedash nginx --no-pager
sudo journalctl -u homedash --since '30 minutes ago' --no-pager
sudo nginx -t
curl --fail http://127.0.0.1:4100/health/ready
```

Mise à jour vers une release future :

```bash
cd /opt/homedash/repository
git fetch --tags origin
git checkout v0.2.0
sudo install -m 0755 deployment/raspberry-pi-zero/update-native.sh /usr/local/sbin/homedash-update-native
sudo homedash-update-native v0.2.0
```

Consultez [updates.md](updates.md) avant chaque mise à jour et [backup-and-restore.md](backup-and-restore.md) pour les sauvegardes.

## 15. Dépannage ciblé

### `Illegal instruction` au lancement de Node

Vérifiez :

```bash
uname -m
readlink -f /usr/local/bin/node
```

Le binaire doit finir par `node-v22.23.1-linux-armv6l/bin/node`. N’installez pas un binaire ARMv7 ou ARM64 sur le Zero original.

### GitHub répond 404 pendant le téléchargement

- vérifiez que la release et le tag existent ;
- vérifiez le nom de l’asset ;
- recréez un token Contents: Read limité au dépôt ;
- vérifiez que `/etc/homedash/github-token` ne contient qu’une ligne, sans espace.

### `npm ci` est tué

Contrôlez `free -h` et les logs OOM. Fermez tout service inutile, créez le swap temporaire décrit plus haut et relancez `sudo homedash-update-native v0.2.0`.

### Nginx ne démarre pas

```bash
sudo nginx -t
sudo journalctl -u nginx -n 100 --no-pager
sudo ss -ltnp | grep -E ':80|:443|:4100'
```

Le serveur Node doit écouter seulement `127.0.0.1:4100`; Nginx écoute `192.168.1.124:4100` pour l’ESP32.

### Le certificat est refusé

- vérifiez que la tablette a installé `root-ca.crt`, pas `homedash.crt` ;
- utilisez exactement l’IP ou le nom inclus lors de l’installation ;
- vérifiez l’heure du Pi et de la tablette ;
- si l’IP fixe change, relancez `generate-tls.sh` avec la nouvelle IP, régénérez la configuration Nginx et redémarrez Nginx.

### HomeDash boucle au démarrage

```bash
sudo journalctl -u homedash -n 150 --no-pager
sudo -u homedash test -r /etc/homedash/homedash.env && echo OK
sudo -u homedash test -w /var/lib/homedash/data && echo OK
readlink -f /opt/homedash/current
```

Ne supprimez pas la base. Copiez d’abord `/var/lib/homedash/data` et utilisez le rollback documenté.
