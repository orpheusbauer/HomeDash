# Raspberry Pi qui devient inaccessible après plusieurs heures

Une panne HomeDash seule devrait laisser le Pi accessible en SSH. Si SSH et le dashboard deviennent inaccessibles et que la Freebox ne voit plus le Pi connecté, il faut distinguer une déconnexion Wi-Fi d'un blocage du système. La liste des appareils de la Freebox ne suffit pas à prouver que le Pi s'est arrêté.

Les causes à examiner sont le Wi-Fi/pilote, l'alimentation et son câble, une saturation mémoire ou du swap, puis le stockage et la température. HomeDash peut contribuer à une saturation ; aucun de ces symptômes ne permet seul de l'accuser ou de l'écarter.

## 1. Capturer un rapport après récupération de l'accès

Si le Pi est actuellement inaccessible, essayer d'abord son adresse IP habituelle, plutôt que seulement `homedash.local`. Un écran et un clavier, si disponibles, permettent de vérifier si Linux répond encore sans couper l'alimentation. En cas de blocage complet sans accès local, une remise sous tension peut être nécessaire ; elle peut perdre les dernières traces non écrites sur la carte.

Le script `deployment/raspberry-pi-zero/diagnose-pi-offline.sh` ne modifie ni les services ni leur configuration. Il recueille matériel/OS, mémoire, swap, stockage, connexion Wi-Fi, limites mémoire du noyau, santé locale HomeDash, journaux actuels et démarrage précédent s'il est disponible. Les lectures de journaux sont bornées. Il ne lit pas les `.env`, clés ni tokens ; les journaux et SSID peuvent néanmoins contenir des informations à relire avant partage.

Sur le PC, dans PowerShell, adapter le compte SSH et, si nécessaire, remplacer `homedash.local` par l'IP du Pi :

```powershell
$PiUser = "VOTRE_UTILISATEUR_SSH"
$PiHost = "homedash.local"
scp ".\deployment\raspberry-pi-zero\diagnose-pi-offline.sh" "${PiUser}@${PiHost}:diagnose-pi-offline.sh"
ssh "${PiUser}@${PiHost}"
```

Sur le Pi, une fois connecté :

```bash
sudo bash "$HOME/diagnose-pi-offline.sh" 2>&1 | tee "$HOME/homedash-pi-diagnostic.txt"
```

Conserver ce premier rapport et en refaire un après la prochaine panne. Le fichier est dans le dossier personnel du compte SSH. Depuis le PC, on peut le récupérer avec :

```powershell
scp "${PiUser}@${PiHost}:homedash-pi-diagnostic.txt" "$env:USERPROFILE\Downloads\homedash-pi-diagnostic.txt"
```

Les états, températures et compteurs actuels sont ceux **après** redémarrage. Pour la panne précédente, les journaux `-1` sont plus utiles ; un état sain après redémarrage ne disculpe pas le matériel ou l'application.

## 2. Conserver les traces de la prochaine panne

Si le rapport indique que le démarrage précédent est indisponible, activer les journaux persistants. Les anciennes installations HomeDash limitaient leur volume sans fixer `Storage=persistent`. Raspberry Pi OS peut imposer `Storage=volatile` dans `/usr/lib/systemd/journald.conf.d/40-rpi-volatile-storage.conf` : créer `/var/log/journal` ne suffit alors pas. La configuration HomeDash du dépôt fixe désormais explicitement la persistance ; pour corriger un Pi déjà installé, utiliser le fichier ci-dessous sans réinstaller l'application.

Exécuter sur le Pi, si le rapport ne montre pas d'erreurs de carte SD et qu'il reste suffisamment d'espace libre :

```bash
sudo install -d -m 0755 /etc/systemd/journald.conf.d
sudo tee /etc/systemd/journald.conf.d/90-homedash-diagnostic.conf >/dev/null <<'EOF'
[Journal]
Storage=persistent
SystemMaxUse=64M
SystemKeepFree=256M
RuntimeMaxUse=32M
MaxRetentionSec=7day
EOF
sudo systemctl restart systemd-journald
sudo journalctl --flush
sudo journalctl --list-boots
```

Cela n'invente pas les anciens journaux perdus. Après la prochaine remise sous tension, relancer le diagnostic. Lors d'un gel brutal ou d'une coupure, les derniers messages peuvent manquer même avec la persistance activée.

Pour suivre une éventuelle dégradation mémoire pendant 24 heures, indépendamment de la session SSH, on peut démarrer cette collecte temporaire **après** avoir activé la persistance :

```bash
sudo systemd-run --unit=homedash-memory-diagnostic --collect \
  --property=RuntimeMaxSec=24h --property=Nice=10 \
  /usr/bin/vmstat -w -t 60
```

Cette collecte échantillonne mémoire, swap, CPU et entrées/sorties toutes les minutes sans envoyer de sondes réseau. Elle s'arrête après 24 heures ou au redémarrage. Pour consulter ses traces, y compris après redémarrage :

```bash
sudo journalctl -u homedash-memory-diagnostic --since '2 days ago' --no-pager
```

Pour l'arrêter avant la fin : `sudo systemctl stop homedash-memory-diagnostic`.

## 3. Lire les indices

| Indice                                                                      | Interprétation et suite                                                                                                       |
| --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Le nom `.local` échoue mais SSH par IP fonctionne                           | Problème de résolution de nom ; vérifier mDNS et réservation DHCP.                                                            |
| Console locale réactive, `curl` local HTTP 200, mais Wi-Fi déconnecté       | Piste réseau dominante : signal, pilote, reconnexion et économie d'énergie.                                                   |
| `brcmfmac`, erreurs de firmware, désassociations répétées                   | Examiner le pilote Wi-Fi et la radio ; le code seul ne prouve pas une alimentation saine.                                     |
| `Out of memory`, `Killed process`, événements `oom`/`oom_kill`              | Identifier le processus et distinguer manque de RAM global et limite du service. Vérifier la progression de mémoire/swap.     |
| `MemAvailable` très bas, swap chargé et `si`/`so` persistants dans `vmstat` | Pression mémoire avec échanges disque pouvant rendre tout le système très lent. La colonne `free` seule n'est pas suffisante. |
| Partition/inodes presque pleins, nouveaux `/core.*`                         | Vérifier l'ancien updater Docker et les protections existantes, puis libérer de l'espace après sauvegarde et identification.  |
| `mmc`, erreurs I/O, erreurs `EXT4`, racine en lecture seule                 | Piste microSD ou alimentation ; sauvegarder avant réparation/remplacement.                                                    |
| Température élevée et throttling thermique                                  | Tester l'aération et le refroidissement ; une valeur actuelle après redémarrage peut manquer l'incident.                      |
| Journaux arrêtés brusquement sans erreur explicite                          | Compatible avec alimentation ou gel du noyau, sans permettre de conclure.                                                     |

Sur la gamme Zero, l'absence de détection matérielle de sous-tension signifie que `vcgencmd get_throttled` égal à `0x0` **ne valide pas l'alimentation**. Tester un bloc fiable et un câble micro-USB court en bon état ; noter le changement et observer au moins 24 heures. Le type de connecteur ne renseigne pas sur la qualité du bloc.

Si le Pi est alimenté par un port USB de la Freebox, commencer par comparer avec un bloc secteur fiable de 5 V / 2 A, adapté au Pi. Sans connaître le modèle de Freebox ni mesurer la tension au Pi, le branchement USB ne permet pas de conclure à une alimentation insuffisante. Capturer le rapport disponible, puis changer la source d'alimentation en conservant d'abord le même câble et les mêmes réglages. Observer pendant 24 à 48 heures ; tester ensuite le câble séparément si nécessaire.

## 4. Essai Wi-Fi réversible

Capturer d'abord le rapport. Si `iw ... get power_save` indique `on`, essayer la désactivation en direct sur l'interface indiquée par le rapport, généralement `wlan0` :

```bash
sudo iw dev wlan0 set power_save off
iw dev wlan0 get power_save
```

Cela teste une hypothèse, sans garantie de résoudre la panne. Le gestionnaire réseau peut réappliquer son réglage à une reconnexion ; l'essai ne rend pas le changement permanent. Si `iw` est absent, relever le résultat et adapter la procédure au gestionnaire réseau plutôt que modifier plusieurs paramètres à la fois.

Si ce test améliore la stabilité et que **NetworkManager gère cette interface**, rendre ce seul réglage persistant dans son profil actif. Vérifier d'abord la valeur précédente pour pouvoir la restaurer :

```bash
wifi_uuid="$(nmcli -g GENERAL.CON-UUID device show wlan0)"
nmcli -g 802-11-wireless.powersave connection show uuid "$wifi_uuid"
# Continuer uniquement si wifi_uuid est un UUID de connexion actif.
sudo nmcli connection modify uuid "$wifi_uuid" 802-11-wireless.powersave 2
sudo iw dev wlan0 set power_save off
```

La valeur `2` signifie désactivé. Le profil sera utilisé aux prochaines connexions ; `iw` applique l'essai maintenant. Pour revenir au réglage précédent, remettre la valeur relevée dans le profil ; s'il était actif en direct, `sudo iw dev wlan0 set power_save on` le réactive immédiatement. Avec dhcpcd/wpa_supplicant, cette procédure NetworkManager ne s'applique pas.

Pour un profil généré par Netplan dont `802-11-wireless.powersave` vaut `0 (default)`, on peut définir plutôt le défaut NetworkManager pour `wlan0`, sans modifier le YAML contenant le mot de passe Wi-Fi :

```bash
sudo install -d -m 0755 /etc/NetworkManager/conf.d
sudo tee /etc/NetworkManager/conf.d/90-homedash-wifi.conf >/dev/null <<'EOF'
[connection-homedash-wifi]
match-device=interface-name:wlan0
wifi.powersave=2
EOF
sudo nmcli general reload conf
sudo /usr/sbin/iw dev wlan0 set power_save off
sudo /usr/sbin/iw dev wlan0 get power_save
```

Le résultat attendu est `Power save: off`. La valeur par défaut concerne les futures activations du profil ; `iw` applique le changement sur la connexion actuelle. Un profil imposant explicitement une autre valeur a priorité sur ce défaut. Pour annuler cet essai, retirer uniquement `90-homedash-wifi.conf`, recharger la configuration puis réactiver l'économie d'énergie en direct. Aucun redémarrage de NetworkManager n'est nécessaire.

Un autre essai consiste à rapprocher temporairement le Pi de la Freebox, en conservant alimentation et logiciel identiques. Tester un changement à la fois pendant au moins 24 heures, puisque la panne survient environ deux fois par jour.

## 5. Ce que l'examen de HomeDash permet de dire

L'unité Zero actuelle déclare `--max-old-space-size=192`, `MemoryHigh=320M` et `MemoryMax=400M`. La limite V8 concerne une partie de la mémoire de Node, pas toute la RAM du processus. La limite systemd doit être confirmée dans les fichiers cgroup du rapport ; une directive seule ne prouve pas que le contrôleur est disponible. Avec 512 Mo physiques, cette configuration laisse peu de marge lorsque HomeDash approche de sa limite, surtout si un autre processus consomme de la RAM.

Si `/sys/fs/cgroup/cgroup.controllers` ne contient pas `memory` et que les fichiers `memory.*` du service sont absents, le plafond systemd n'est pas appliqué. L'option de démarrage `cgroup_disable=memory` peut l'expliquer. Activer ce contrôleur demande une modification du démarrage et un redémarrage ; commencer par conserver les traces et mesurer la mémoire, plutôt que changer les options de boot sur la seule base d'une panne réseau.

L'agent `homedash-native-updater.service` n'a pas de plafond mémoire explicite. L'installation npm utilise un plafond V8 mais se déroule avant l'arrêt du serveur : leurs charges peuvent se cumuler pendant une mise à jour. Vérifier la concordance avec les horaires des incidents avant de modifier les limites ou les mises à jour.

Le dépôt prévoit déjà le retrait de l'ancien updater Docker, une limitation des redémarrages, la désactivation des core dumps et un contrôle du disque. Une installation ancienne peut ne pas avoir ces protections, même si l'application a été mise à jour : le rapport examine l'état réel sur le Pi.

Si le doute subsiste, un essai contrôlé avec **HomeDash et son agent natif arrêtés**, pendant une durée supérieure au délai habituel de panne, peut aider à isoler la charge applicative. La tablette ne recevra pas de données pendant cet essai. Noter les états initiaux et attendre la fin d'une éventuelle installation avant d'arrêter les deux services. Une nouvelle panne dans ces conditions renforce les pistes réseau/matériel/système ; une seule période stable ne prouve pas la responsabilité de HomeDash.

HomeDash 0.4.11 ajoute une sonde de liaison et un timer de redémarrage à 03 h Europe/Paris ; la [migration du timer](updates.md#migration-unique-du-timer-de-03-h) active aussi les journaux persistants. Cette mitigation ne répare pas l'alimentation, la microSD ou un pilote défaillant ; un noyau complètement figé ne peut pas exécuter le timer. Conserver le rapport et comparer les démarrages reste nécessaire pour identifier la cause des pertes de SSH.

## Sources techniques

- [Raspberry Pi : détection de sous-tension et alimentation](https://www.raspberrypi.com/documentation/computers/raspberry-pi.html#power-supply-warnings)
- [Raspberry Pi : vcgencmd](https://www.raspberrypi.com/documentation/computers/os.html#vcgencmd)
- [systemd : configuration journald, source officielle](https://github.com/systemd/systemd/blob/main/man/journald.conf.xml)
- [Noyau Linux : contrôleur mémoire cgroup v2](https://www.kernel.org/doc/html/latest/admin-guide/cgroup-v2.html#memory)
- [NetworkManager : réglage powersave](https://networkmanager.dev/docs/api/latest/settings-802-11-wireless.html)
