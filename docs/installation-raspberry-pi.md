# Installation complète sur Raspberry Pi

Ce guide part d’un Raspberry Pi 4/5 sous Raspberry Pi OS Lite 64 bits récent, relié au même LAN que la tablette. Un Pi 4 avec 2 Go suffit. Utilisez une alimentation officielle, une carte microSD de qualité ou de préférence un SSD USB, et une connexion Ethernet si possible.

## 1. Préparer le système depuis le PC

1. Installez Raspberry Pi Imager.
2. Sélectionnez Raspberry Pi OS Lite 64-bit.
3. Dans les options avancées : nom d’hôte `homedash`, utilisateur non trivial, mot de passe long, fuseau `Europe/Paris`, clavier français, Wi-Fi si nécessaire et SSH par clé publique.
4. Écrivez la carte, démarrez le Pi et trouvez son adresse dans l’interface du routeur.
5. Dans le routeur, créez un bail DHCP fixe, par exemple `192.168.1.50`. Ne configurez pas simultanément une IP statique différente sur le Pi.
6. Idéalement, ajoutez au DNS local `homedash.home.arpa -> 192.168.1.50`. Sans DNS local, utilisez l’IP pendant l’installation.

Connexion initiale :

```bash
ssh votre-utilisateur@192.168.1.50
sudo apt update
sudo apt full-upgrade -y
sudo apt install -y ca-certificates curl git gnupg openssl
sudo reboot
```

Reconnectez-vous après le redémarrage.

## 2. Installer Docker depuis son dépôt officiel

N’utilisez pas l’ancien paquet `docker.io` si vous voulez rester aligné sur Docker Compose v2. Les commandes suivantes reprennent la [procédure Debian officielle](https://docs.docker.com/engine/install/debian/) :

```bash
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/debian/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc
sudo tee /etc/apt/sources.list.d/docker.sources >/dev/null <<EOF
Types: deb
URIs: https://download.docker.com/linux/debian
Suites: $(. /etc/os-release && echo "$VERSION_CODENAME")
Components: stable
Architectures: $(dpkg --print-architecture)
Signed-By: /etc/apt/keyrings/docker.asc
EOF
sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo systemctl enable --now docker
sudo docker run --rm hello-world
```

Si Raspberry Pi OS annonce que son codename n’existe pas dans le dépôt Debian, remplacez `Suites:` par le Debian de base indiqué dans `/etc/debian_version` (`bookworm` ou `trixie`).

## 3. Installer Node.js sur l’hôte

L’application tourne dans Docker, mais l’agent de rollback utilise `node:sqlite` sur l’hôte. Il faut Node.js 22.12 minimum ; Node 24 LTS est la cible. Installez Node 24 avec une source de paquets adaptée à votre version Debian, puis vérifiez :

```bash
node --version
npm --version
```

La première ligne doit afficher `v24.x` ou au minimum une version `>=22.12`. Si le dépôt système est trop ancien, suivez l’installation Linux de [Node.js](https://nodejs.org/en/download/package-manager) ou le dépôt NodeSource, en inspectant tout script téléchargé avant `sudo`.

## 4. Publier la première release depuis le PC

Avant d’installer le Pi, le dépôt doit contenir une release `v0.1.0` et l’image GHCR correspondante. Suivez [updates.md](updates.md) : poussez `main`, attendez la CI, puis poussez le tag. Vérifiez dans GitHub > Releases et GitHub > Packages que `v0.1.0` existe.

Si le dépôt/package est privé, créez un Personal Access Token GitHub en lecture des packages puis, sur le Pi :

```bash
echo 'VOTRE_PAT' | sudo docker login ghcr.io -u VOTRE_LOGIN --password-stdin
```

Le token ne doit ni apparaître dans l’historique shell ni être écrit dans le dépôt. Pour un projet domestique, rendre uniquement le package conteneur public simplifie le pull sans rendre les secrets publics — les secrets ne sont jamais dans l’image.

## 5. Installer le dépôt

```bash
sudo git clone https://github.com/orpheusbauer/HomeDash.git /opt/homedash
cd /opt/homedash
sudo git checkout v0.1.0
```

Le code n’est pas mis à jour à chaque push. Le tag sert à installer les fichiers d’exploitation ; l’application elle-même est tirée par digest depuis GHCR.

## 6. Créer la configuration secrète

Générez trois valeurs aléatoires :

```bash
cd /opt/homedash
node scripts/generate-secrets.mjs
```

Copiez les trois lignes dans un gestionnaire de mots de passe, puis créez le fichier :

```bash
sudo install -d -o root -g root -m 0750 /etc/homedash
sudoedit /etc/homedash/homedash.env
```

Contenu minimal, en remplaçant les valeurs :

```dotenv
NODE_ENV=production
HOMEDASH_TIMEZONE=Europe/Paris
HOMEDASH_PUBLIC_URL=https://homedash.home.arpa
HOMEDASH_ADMIN_TOKEN=64_CARACTERES_GENERES
HOMEDASH_SENSOR_INGEST_TOKEN=64_AUTRES_CARACTERES
HOMEDASH_ENCRYPTION_KEY=64_AUTRES_CARACTERES
HOMEDASH_GITHUB_REPOSITORY=orpheusbauer/HomeDash
```

Puis :

```bash
sudo chown root:root /etc/homedash/homedash.env
sudo chmod 0600 /etc/homedash/homedash.env
```

Le script de l’étape suivante créera `release.env`. Si vous n’avez pas configuré le DNS local, vous y remplacerez `HOMEDASH_HOSTNAME` par l’IP fixe et adapterez `HOMEDASH_PUBLIC_URL`. Pour le premier diagnostic, `http://192.168.1.50` fonctionne aussi grâce au port 80 de Caddy, mais la tablette finale doit utiliser HTTPS.

## 7. Installer et démarrer les services

```bash
cd /opt/homedash
sudo bash deployment/raspberry-pi/install-services.sh
sudoedit /var/lib/homedash/data/release.env
sudo systemctl start homedash-updater.service
sudo systemctl start homedash.service
sudo systemctl status homedash-updater.service homedash.service --no-pager
sudo docker compose --env-file /var/lib/homedash/data/release.env -f deployment/docker/compose.yml ps
```

Testez sur le Pi :

```bash
node scripts/verify-installation.mjs http://127.0.0.1:4100
curl -I http://127.0.0.1
```

Puis depuis le PC, ouvrez `https://homedash.home.arpa` ou l’adresse choisie. L’alerte de certificat est normale tant que la CA locale n’est pas installée.

## 8. Installer le certificat local Caddy

Caddy crée sa propre autorité locale pour les noms privés. Selon la [documentation Caddy](https://caddyserver.com/docs/automatic-https), chaque client doit faire confiance à cette racine.

Après le premier démarrage :

```bash
sudo ls /var/lib/homedash/caddy-data/pki/authorities/local/root.crt
```

Depuis le PC :

```bash
scp votre-utilisateur@192.168.1.50:/var/lib/homedash/caddy-data/pki/authorities/local/root.crt ./homedash-caddy-root.crt
```

La lecture peut être refusée car le fichier appartient à root. Dans ce cas, sur le Pi, copiez uniquement le certificat public :

```bash
sudo cp /var/lib/homedash/caddy-data/pki/authorities/local/root.crt /tmp/homedash-caddy-root.crt
sudo chown votre-utilisateur:votre-utilisateur /tmp/homedash-caddy-root.crt
```

Récupérez-le, puis supprimez la copie `/tmp`. Installez ce certificat comme autorité de confiance sur la tablette selon [android-kiosk.md](android-kiosk.md). Ne copiez jamais `root.key`.

## 9. Vérifications finales

Dans HomeDash :

1. ouvrez Paramètres ;
2. déverrouillez avec `HOMEDASH_ADMIN_TOKEN` ;
3. créez une sauvegarde ;
4. créez un code d’association tablette ;
5. ajoutez une page et un widget, rechargez, vérifiez la persistance ;
6. coupez temporairement l’accès Internet du Pi : notes, édition et valeurs en cache doivent rester disponibles ;
7. rétablissez Internet et vérifiez météo et recherche de mise à jour.

## 10. Exploitation quotidienne

```bash
# État
sudo systemctl status homedash homedash-updater --no-pager
sudo docker compose --env-file /var/lib/homedash/data/release.env -f /opt/homedash/deployment/docker/compose.yml ps

# Logs récents, sans rotation manuelle : journald s’en charge
sudo journalctl -u homedash -u homedash-updater --since '1 hour ago'
sudo docker logs --since 1h homedash
sudo docker logs --since 1h homedash-caddy

# Redémarrage
sudo systemctl restart homedash

# Santé
curl -fsS http://127.0.0.1:4100/health/ready
```

Configurez la rotation de journald dans `/etc/systemd/journald.conf` si votre image OS n’a pas déjà des limites, par exemple `SystemMaxUse=200M`, puis `sudo systemctl restart systemd-journald`.

## 11. Dépannage rapide

- **`manifest unknown` au démarrage** : le tag GHCR n’a pas été créé, le package est privé ou le login GHCR manque.
- **502 Caddy** : `sudo docker logs homedash`, puis vérifiez `/health/ready`.
- **Erreur de token production** : changez `HOMEDASH_ADMIN_TOKEN`; la valeur de développement est volontairement refusée.
- **Socket updater inaccessible** : vérifiez le groupe `homedash`, `HOMEDASH_HOST_GID` dans `release.env`, le montage `/run/homedash-updater` et les deux services systemd.
- **Nom `home.arpa` introuvable** : créez l’enregistrement DNS dans le routeur ou utilisez l’IP fixe comme hostname Caddy.
- **Horloge fausse** : `timedatectl`, puis `sudo timedatectl set-timezone Europe/Paris`.
- **CPU/température absente** : certains chemins matériels ne sont pas exposés dans le conteneur ; le widget affiche `N/D` plutôt qu’une valeur inventée.
