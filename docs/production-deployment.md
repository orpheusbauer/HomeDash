# Passage définitif en production — HomeDash 0.4.8

Ce document est la procédure courte et ordonnée à suivre maintenant que le Raspberry Pi et la tablette sont physiquement disponibles. Les guides spécialisés donnent les détails et le dépannage : [installation-raspberry-pi.md](installation-raspberry-pi.md), [android-kiosk.md](android-kiosk.md), [updates.md](updates.md), [backup-and-restore.md](backup-and-restore.md) et [crash-loop-recovery.md](crash-loop-recovery.md).

## Résultat final attendu

À la fin :

- le Pi Zero démarre HomeDash seul sous `systemd`, sans Docker ;
- Nginx fournit `https://homedash.local` et l’adresse IP réservée au Pi ;
- la tablette ouvre automatiquement HomeDash après un reboot ;
- l’icône HomeDash permet de le relancer à tout moment ;
- le plein écran masque les barres système, un glissement inférieur rappelle Accueil/Retour/Récentes et le délai de veille Android reste actif ;
- portrait/paysage se choisit depuis les paramètres ;
- le réveil facultatif de la dalle par mouvement se configure depuis les paramètres de l’APK ;
- les futures versions du Pi proviennent des Releases GitHub ;
- les futures APK signées s’installent depuis les paramètres HomeDash, sans ADB, GitHub sur la tablette, nouveau certificat ou perte d’association.

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
$ProjectDirectory = "C:\chemin\vers\HomeDash"
Set-Location $ProjectDirectory

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

### A3. Créer la Release 0.4.8

```powershell
git tag -a v0.4.8 -m "HomeDash 0.4.8 - actualisation horaire et météo nocturne"
git push origin v0.4.8
```

Dans **Actions > Release**, attendez le vert. Vérifiez ces quatre fichiers publiés ; GitHub ajoute séparément ses deux archives « Source code » :

```text
homedash-native-0.4.8.tar.gz
homedash-native-0.4.8.tar.gz.sha256
homedash-kiosk-0.4.8.apk
homedash-kiosk-0.4.8.apk.sha256
```

## Phase B — mettre le Raspberry Pi en production

Toutes les commandes de cette phase sont lancées depuis le PC au moyen de SSH, mais elles s’exécutent sur le Pi. En production, aucun serveur HomeDash n’est lancé sur le PC. Le PC et la tablette utilisent tous deux `https://homedash.local` une fois le service du Pi opérationnel.

Connectez-vous en SSH :

```powershell
$PiHost = "homedash.local"
$PiUser = "VOTRE_UTILISATEUR_DU_PI"
ssh "$PiUser@$PiHost"
```

### B1. Vérifications préalables

```bash
uname -m
getconf LONG_BIT
hostname -I
free -h
df -h /
```

Le Zero original doit afficher `armv6l` et `32`. Notez l’adresse affichée par `hostname -I` et réservez-la dans votre routeur.

### B2. Mettre à jour le clone et installer 0.4.8

```bash
cd /opt/homedash/repository
git status --short
git fetch --tags origin
git checkout v0.4.8

sudo bash deployment/raspberry-pi-zero/install-native.sh v0.4.8
```

Pour `0.4.8`, une mise à jour applicative ordinaire suffit si l’installeur natif `0.4.5` ou ultérieur est déjà en place. Si l’installeur est plus ancien, appliquez une fois l’installation complète afin de corriger son cache npm. La configuration, la base, les certificats et le token GitHub existants sont conservés.

### B3. Valider le Pi

```bash
cat /var/lib/homedash/installed-version
readlink -f /opt/homedash/current
sudo systemctl status homedash nginx --no-pager
sudo systemctl status homedash-disk-guard.timer --no-pager
sudo systemctl is-active homedash-updater.service || true
cat /proc/sys/kernel/core_pattern
curl --fail http://127.0.0.1:4100/health/ready
curl --fail --cacert /var/lib/homedash/tls/root-ca.crt \
  https://homedash.local/health/ready
sudo journalctl -u homedash -n 100 --no-pager
```

Résultats attendus : version `0.4.8`, HomeDash et Nginx actifs, timer disque `active (waiting)`, ancien updater inactif ou inconnu, motif de core `/dev/null` et deux réponses HTTP 200.

Un navigateur affichant `502 Bad Gateway nginx` signifie que Nginx est joignable, mais que `curl http://127.0.0.1:4100/health/ready` échoue sur le Pi. Dans ce cas, ne commencez pas la phase tablette : suivez la section 3 de [android-kiosk.md](android-kiosk.md), notamment `systemctl status`, `journalctl` et la relance de l’installeur natif.

### B4. Créer immédiatement une sauvegarde hors Pi

Suivez [backup-and-restore.md](backup-and-restore.md), puis copiez l’archive produite sur un PC ou NAS chiffré. Une sauvegarde laissée uniquement sur la même microSD n’est pas une sauvegarde suffisante.

## Phase C — mettre la tablette en production

### C1. Retirer une ancienne version debug

Si une ancienne APK debug est installée, désinstallez-la une seule fois avant l’APK signée `0.4.8`. Si l’application était Device Owner et ne peut pas être supprimée, effectuez la transition propre décrite dans [android-kiosk.md](android-kiosk.md).

### C2. Installer sans câble

Depuis Chrome sur la tablette :

1. ouvrez la Release GitHub `v0.4.8` ;
2. téléchargez `homedash-kiosk-0.4.8.apk` ;
3. autorisez temporairement l’installation depuis Chrome ;
4. installez l’APK ;
5. retirez cette autorisation ;
6. installez la CA HomeDash si nécessaire ;
7. ouvrez l’icône HomeDash.

### C3. Associer et choisir l’orientation

1. URL : `https://homedash.local` ou l’adresse IP réservée au Pi ;
2. dans HomeDash, Paramètres, PIN `0000`, Tablettes, **Associer** ;
3. saisissez le code sur la tablette ;
4. choisissez paysage ou portrait ;
5. accordez caméra et notifications ;
6. configurez batterie **Sans restriction** et **Démarrage automatique** dans Android.

Le délai de veille configuré dans Android fonctionne directement avec HomeDash. Le réveil par mouvement et le verrouillage anticipé après 90 secondes d’absence sont deux fonctions facultatives et indépendantes. Configurez-les uniquement après avoir lu la section 8 de [android-kiosk.md](android-kiosk.md) : le réveil maintient un service caméra local actif, tandis que le verrouillage utilise une autorisation Android standard, jamais Device Owner ou le verrouillage kiosque.

### C4. Tester les sorties avant le montage

Vérifiez séparément :

- glissement depuis le bord inférieur puis bouton Android Retour ;
- glissement depuis le bord inférieur puis bouton rond Accueil ;
- relance par l’icône HomeDash ;
- heure/date centrées et absence de chevauchement de la barre supérieure ;
- arrêt de l’indicateur caméra après la sortie par **Retour** ;
- retour du service de présence après réouverture ;
- extinction selon le délai Android, puis affichage normal de l’écran de verrouillage au réveil ;
- si le réveil par mouvement est activé : notification permanente, extinction normale, réveil devant la caméra et comportement du verrouillage validés ;
- si le verrouillage après absence est activé : verrouillage anticipé et désactivation possible de l’autorisation.

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
7. sur la tablette, ouvrir **Paramètres > Mises à jour > Vérifier**, puis installer l’APK proposée si le code Android a changé.

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

- CI et Release `v0.4.8` sont vertes ;
- Pi et Nginx redémarrent seuls ;
- la tablette possède l’APK signée ;
- aucun câble/ADB n’est nécessaire au quotidien ;
- ouverture, sortie et orientation fonctionnent ;
- 48 heures sans crash sont observées ;
- une sauvegarde restaurable existe hors du Pi ;
- le keystore et ses mots de passe sont sauvegardés séparément.
