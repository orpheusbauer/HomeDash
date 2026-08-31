# Passage définitif en production — HomeDash 0.2.0

Ce document est la procédure courte et ordonnée à suivre maintenant que le Raspberry Pi et la tablette sont physiquement disponibles. Les guides spécialisés donnent les détails et le dépannage : [installation-raspberry-pi.md](installation-raspberry-pi.md), [android-kiosk.md](android-kiosk.md), [updates.md](updates.md) et [backup-and-restore.md](backup-and-restore.md).

## Résultat final attendu

À la fin :

- le Pi Zero démarre HomeDash seul sous `systemd`, sans Docker ;
- Nginx fournit `https://192.168.1.124` ;
- la tablette ouvre automatiquement HomeDash après un reboot ;
- l’icône HomeDash permet de le relancer à tout moment ;
- Accueil, Retour et le bouton **Android** permettent de quitter l’application ;
- portrait/paysage se choisit depuis les paramètres ;
- les futures versions du Pi proviennent des Releases GitHub ;
- les futures APK signées s’installent sans ADB et sans perdre l’association.

## Phase A — préparer GitHub depuis le PC

### A1. Créer et sauvegarder le keystore Android

Suivez la section 1 de [android-kiosk.md](android-kiosk.md). Cette action n’est faite qu’une fois. Vérifiez ensuite que ces secrets existent dans GitHub Actions :

```text
HOMEDASH_ANDROID_KEYSTORE_BASE64
HOMEDASH_ANDROID_KEYSTORE_PASSWORD
HOMEDASH_ANDROID_KEY_ALIAS
HOMEDASH_ANDROID_KEY_PASSWORD
```

Sans eux, la Release doit échouer : n’utilisez pas l’artifact debug comme solution de contournement.

### A2. Contrôler, committer et pousser

```powershell
cd "C:\Users\orphe\OneDrive\Bureau\Orpheus\ProjetHomeDash\HomeDash"

npm.cmd ci
npm.cmd run format:check
npm.cmd run lint
npm.cmd run typecheck
npm.cmd test
npm.cmd run build

git status --short
git add .
git diff --cached --check
git commit -m "Finish production tablet experience"
git push origin main
```

Dans **GitHub > Actions > CI**, attendez que `web-server` et `android` soient verts.

### A3. Créer la Release 0.2.0

```powershell
git tag -a v0.2.0 -m "HomeDash 0.2.0 - production murale"
git push origin v0.2.0
```

Dans **Actions > Release**, attendez le vert. Vérifiez ces quatre fichiers publiés ; GitHub ajoute séparément ses deux archives « Source code » :

```text
homedash-native-0.2.0.tar.gz
homedash-native-0.2.0.tar.gz.sha256
homedash-kiosk-0.2.0.apk
homedash-kiosk-0.2.0.apk.sha256
```

## Phase B — mettre le Raspberry Pi en production

Connectez-vous en SSH :

```powershell
ssh votre-utilisateur@192.168.1.124
```

### B1. Vérifications préalables

```bash
uname -m
getconf LONG_BIT
hostname -I
free -h
df -h /
```

Le Zero original doit afficher `armv6l` et `32`. L’adresse réservée doit être `192.168.1.124`.

### B2. Mettre à jour le clone et installer 0.2.0

```bash
cd /opt/homedash/repository
git status --short
git fetch --tags origin
git checkout v0.2.0

sudo install -o root -g root -m 0755 \
  deployment/raspberry-pi-zero/update-native.sh \
  /usr/local/sbin/homedash-update-native

sudo homedash-update-native v0.2.0
```

Pour une première installation seulement :

```bash
cd /opt/homedash/repository
sudo env HOMEDASH_HOSTNAME=homedash.local HOMEDASH_IP_ADDRESS=192.168.1.124 \
  bash deployment/raspberry-pi-zero/install-native.sh v0.2.0
```

### B3. Valider le Pi

```bash
cat /var/lib/homedash/installed-version
readlink -f /opt/homedash/current
sudo systemctl status homedash nginx --no-pager
curl --fail http://127.0.0.1:4100/health/ready
curl --fail --cacert /var/lib/homedash/tls/root-ca.crt \
  https://192.168.1.124/health/ready
sudo journalctl -u homedash -n 100 --no-pager
```

Résultats attendus : version `0.2.0`, services actifs et deux réponses HTTP 200.

### B4. Créer immédiatement une sauvegarde hors Pi

Suivez [backup-and-restore.md](backup-and-restore.md), puis copiez l’archive produite sur un PC ou NAS chiffré. Une sauvegarde laissée uniquement sur la même microSD n’est pas une sauvegarde suffisante.

## Phase C — mettre la tablette en production

### C1. Retirer une ancienne version debug

Si HomeDash `0.1.x` est installé, désinstallez-le une seule fois avant l’APK signée `0.2.0`. Si l’application était Device Owner et ne peut pas être supprimée, effectuez la transition propre décrite dans [android-kiosk.md](android-kiosk.md).

### C2. Installer sans câble

Depuis Chrome sur la tablette :

1. ouvrez la Release GitHub `v0.2.0` ;
2. téléchargez `homedash-kiosk-0.2.0.apk` ;
3. autorisez temporairement l’installation depuis Chrome ;
4. installez l’APK ;
5. retirez cette autorisation ;
6. installez la CA HomeDash si nécessaire ;
7. ouvrez l’icône HomeDash.

### C3. Associer et choisir l’orientation

1. URL : `https://192.168.1.124` ;
2. dans HomeDash, Paramètres, PIN `0000`, Tablettes, **Associer** ;
3. saisissez le code sur la tablette ;
4. choisissez paysage ou portrait ;
5. accordez caméra et notifications ;
6. configurez batterie **Sans restriction** et **Démarrage automatique** dans Android.

L’extinction réelle après 90 secondes d’absence est facultative. Activez-la depuis l’écran natif uniquement après avoir lu la section 8 de [android-kiosk.md](android-kiosk.md) : elle utilise une autorisation Android standard, jamais Device Owner ou le verrouillage kiosque.

### C4. Tester les sorties avant le montage

Vérifiez séparément :

- bouton **Android** dans HomeDash ;
- bouton Android Retour ;
- bouton rond Accueil ;
- relance par l’icône HomeDash ;
- arrêt de l’indicateur caméra après la sortie ;
- retour du service de présence après réouverture.
- si l’extinction après absence est activée : écran éteint, réveil et désactivation de l’autorisation.

Ne montez pas la tablette au mur si l’un de ces chemins ne fonctionne pas.

## Phase D — recette de production sur 48 heures

### D1. Redémarrages

1. redémarrez le Pi, laissez la tablette allumée, vérifiez la reconnexion ;
2. redémarrez la tablette, vérifiez l’ouverture automatique ;
3. coupez puis remettez le Wi-Fi ;
4. coupez Internet en conservant le LAN ;
5. débranchez puis rebranchez l’alimentation du Pi.

### D2. Fonctionnel

- ouvrir et quitter HomeDash dix fois ;
- passer deux fois de paysage à portrait ;
- modifier une carte dans chaque orientation ;
- vérifier notes, météo, calendrier, capteurs et télémétrie tablette ;
- vérifier que les pages et dispositions survivent à un redémarrage ;
- contrôler la détection de présence dans la lumière réelle de l’entrée.

### D3. Ressources

Sur le Pi :

```bash
free -h
systemctl show homedash -p MemoryCurrent -p MemoryPeak
sudo journalctl -k | grep -i -E 'out of memory|oom|killed process'
df -h /
```

Sur la tablette, contrôlez chaleur, charge et stabilité WebView. Aucun appareil ne doit chauffer anormalement.

## Phase E — exploitation normale

### Développer une nouvelle version

1. modifier sur le PC ;
2. lancer les contrôles locaux ;
3. pousser `main` ;
4. attendre la CI ;
5. créer un nouveau tag immuable ;
6. mettre à jour le Pi avec `homedash-update-native` ;
7. installer l’APK signée depuis Chrome uniquement si le code Android a changé.

### Contrôler le système

```bash
sudo systemctl status homedash nginx --no-pager
sudo journalctl -u homedash --since '1 hour ago' --no-pager
curl --fail http://127.0.0.1:4100/health/ready
```

### Règles à ne pas enfreindre

- ne jamais déplacer un tag publié ;
- ne jamais perdre ou remplacer le keystore Android ;
- ne jamais exposer les ports HomeDash sur Internet ;
- ne jamais stocker les secrets dans Git ;
- ne jamais couper le Pi pendant une mise à jour ;
- conserver au moins une sauvegarde chiffrée hors microSD.

## Définition de « terminé »

Le projet peut être considéré comme installé proprement lorsque :

- CI et Release `v0.2.0` sont vertes ;
- Pi et Nginx redémarrent seuls ;
- la tablette possède l’APK signée ;
- aucun câble/ADB n’est nécessaire au quotidien ;
- ouverture, sortie et orientation fonctionnent ;
- 48 heures sans crash sont observées ;
- une sauvegarde restaurable existe hors du Pi ;
- le keystore et ses mots de passe sont sauvegardés séparément.
