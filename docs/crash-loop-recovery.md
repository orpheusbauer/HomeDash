# Diagnostic et correction d’une boucle de core dumps

Ce guide concerne l’incident où des fichiers `/core.<PID>` d’environ 4,2 Mo apparaissent toutes les six secondes sur le Raspberry Pi Zero. Toutes les commandes de ce document s’exécutent **sur le Raspberry Pi par SSH**, sauf la création du tag GitHub explicitement marquée « PC ».

## Cause racine

La cadence, le chemin des dumps et les unités versionnées désignent l’ancien agent Docker `homedash-updater.service`, laissé actif lors du passage au déploiement ARMv6 natif :

| Indice observé                              | Configuration qui l’explique                                                                                      |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| un crash environ toutes les 6 secondes      | `Restart=on-failure` et `RestartSec=5` dans l’ancienne unité                                                      |
| dumps nommés `/core.<PID>`                  | aucun `WorkingDirectory`; systemd lance donc le service depuis `/`, avec `core_pattern=core` et `core_uses_pid=1` |
| nouveau PID à chaque fichier                | chaque redémarrage crée un nouveau processus                                                                      |
| petit core Node répété                      | `ExecStart=/usr/bin/node /opt/homedash/deployment/updater/agent.mjs`                                              |
| environnement ARMv6 utilisant un autre Node | le service natif correct utilise `/usr/local/bin/node`, lié à `/opt/node-v22.23.1-linux-armv6l/bin/node`          |

L’agent Docker est inutile dans l’architecture actuelle. Les mises à jour natives sont effectuées ponctuellement par `/usr/local/sbin/homedash-update-native`. La correction consiste donc à retirer l’agent obsolète, pas à le faire survivre avec un autre binaire.

Le signal natif exact doit être lu sur le Pi avant de supprimer le dernier dump. Un `ExecMainStatus=4` ou `status=4/ILL`, accompagné de `Illegal instruction` pour `/usr/bin/node --version`, confirme un binaire `/usr/bin/node` incompatible ARMv6. Un statut `6/ABRT` ou `11/SEGV` doit être conservé dans le rapport : il confirme toujours le processus, mais demande l’analyse contrôlée d’un seul dump pour préciser la fonction native fautive.

## Processus responsable

### 1. Capturer la preuve avant l’arrêt

Sur le Pi, vérifiez d’abord qu’il reste assez d’espace :

```bash
df -h /
```

Depuis le clone contenant cette correction :

```bash
cd /opt/homedash/repository
sudo bash deployment/raspberry-pi-zero/diagnose-crash-loop.sh \
  | tee /tmp/homedash-crash-diagnostic.txt
```

Le script est en lecture seule. Il n’affiche ni `/etc/homedash/homedash.env`, ni PIN, ni token. Les lignes déterminantes sont :

```text
FragmentPath=/etc/systemd/system/homedash-updater.service
ExecStart=.../usr/bin/node .../deployment/updater/agent.mjs
WorkingDirectory=
Restart=on-failure
NRestarts=...
ExecMainCode=...
ExecMainStatus=...
... core file ... from '/usr/bin/node .../deployment/updater/agent.mjs'
```

Pour interpréter `ExecMainStatus` :

- `4` = `SIGILL`, généralement instruction CPU non prise en charge ;
- `6` = `SIGABRT`, arrêt natif volontaire de Node ou d’une bibliothèque ;
- `11` = `SIGSEGV`, accès mémoire invalide.

Le test de `/usr/bin/node --version` exécuté par le script se fait avec `ulimit -c 0` : même si ce mauvais binaire crashe, ce test ne produit aucun dump supplémentaire. Le test de `/usr/local/bin/node` doit afficher `v22.23.1`.

### 2. Si tous les dumps ont déjà été supprimés

Ne réactivez pas un service arrêté uniquement pour obtenir un core. L’état systemd et le journal suffisent généralement :

```bash
sudo systemctl show homedash-updater.service \
  -p FragmentPath -p ExecStart -p WorkingDirectory -p Restart \
  -p NRestarts -p ExecMainCode -p ExecMainStatus -p Result
sudo journalctl -u homedash-updater.service -b -n 100 --no-pager
sudo bash -c 'ulimit -c 0; /usr/bin/node --version'; echo "code=$?"
sudo bash -c 'ulimit -c 0; /usr/local/bin/node --version'; echo "code=$?"
```

Si l’ancien service est encore actif, ces commandes n’ajoutent pas de délai à son arrêt : passez immédiatement à la section suivante après avoir enregistré la sortie.

## Pourquoi les core dumps étaient générés

Le noyau écrit un core lorsqu’un processus se termine par un signal qui en produit un, par exemple `SIGILL`, `SIGABRT` ou `SIGSEGV`, si sa limite de core l’autorise. L’ancienne unité n’avait aucune directive `LimitCORE`, et le système avait :

```text
kernel.core_pattern = core
kernel.core_uses_pid = 1
```

Le nom effectif devenait donc `core.<PID>`.

Le serveur HomeDash natif n’est pas cet agent : il exécute `apps/server/dist/index.js` avec le Node ARMv6 vérifié. Il n’utilise ni PM2, ni nodemon, ni `worker_threads`, ni `fork`, ni boucle shell. Sa seule frontière native applicative est `node:sqlite`, intégré au runtime Node verrouillé et testé par `install-node-armv6.sh` avant installation.

## Pourquoi ils étaient générés à `/`

L’unité historique ne déclarait pas `WorkingDirectory=`. Pour un service système, systemd utilise `/` par défaut. Avec un motif de core relatif (`core`), le noyau a donc écrit directement `/core.<PID>`.

L’unité native corrigée déclare explicitement :

```ini
WorkingDirectory=/opt/homedash/current
```

Elle ajoute aussi `LimitCORE=0`; même un futur crash natif de HomeDash ne pourra plus déposer de dump dans ce répertoire.

## Pourquoi le processus redémarrait

L’ancienne unité déclarait :

```ini
Restart=on-failure
RestartSec=5
```

Elle ne déclarait aucune limite `StartLimitIntervalSec`/`StartLimitBurst`. Après chaque mort par signal, systemd attendait cinq secondes puis créait un nouveau processus. Le temps de lancement et d’écriture du dump explique l’intervalle observé d’environ six secondes.

## Correction appliquée

### Arrêt d’urgence sur le Pi

Après la capture du diagnostic :

```bash
sudo systemctl disable --now homedash-updater.service
sudo rm -f -- /etc/systemd/system/homedash-updater.service
sudo systemctl daemon-reload
sudo systemctl reset-failed
```

Vérifiez pendant trente secondes qu’aucun nouveau dump n’apparaît :

```bash
before="$(sudo find / -maxdepth 1 -type f \( -name core -o -name 'core.*' \) | wc -l)"
sleep 30
after="$(sudo find / -maxdepth 1 -type f \( -name core -o -name 'core.*' \) | wc -l)"
printf 'avant=%s après=%s\n' "$before" "$after"
```

Les deux valeurs doivent être identiques. Si `après` augmente encore, un deuxième processus est impliqué : ne supprimez pas la nouvelle preuve et relancez `diagnose-crash-loop.sh`.

### Installer la correction durable

La correction doit être publiée sous un nouveau tag, jamais en déplaçant `v0.2.0`. Après publication de `v0.2.1`, sur le Pi :

```bash
cd /opt/homedash/repository
git fetch --tags origin
git checkout v0.2.1
sudo bash deployment/raspberry-pi-zero/install-native.sh v0.2.1
```

Il faut relancer **l’installeur complet**, et pas seulement `homedash-update-native`, car cette version met aussi à jour les unités systemd, la politique de core dumps, la limite du journal et le timer de surveillance disque.

`install-native.sh` est idempotent. Il conserve `homedash.env`, la base SQLite, le certificat et le token GitHub existants. Il arrête et retire automatiquement toute ancienne unité `homedash-updater.service` avant le reste de l’installation.

## Protection contre les crash loops

Le service natif utilise maintenant :

```ini
Restart=on-failure
RestartSec=15
StartLimitIntervalSec=300
StartLimitBurst=3
```

Un incident transitoire bénéficie donc de quelques reprises espacées. Trois démarrages défaillants en cinq minutes placent ensuite l’unité en échec au lieu de boucler indéfiniment. Le signal, le statut de sortie et les messages de l’application restent visibles dans le journal.

Pour autoriser un nouveau démarrage **après avoir corrigé la cause** :

```bash
sudo systemctl reset-failed homedash.service
sudo systemctl start homedash.service
```

## Protection contre les core dumps

Deux barrières complémentaires sont appliquées :

1. `LimitCORE=0` dans les unités HomeDash ;
2. sur ce Pi dédié, `/etc/sysctl.d/60-homedash-core-dumps.conf` redirige les cores globaux vers `/dev/null` et désactive les dumps SUID.

La deuxième barrière empêche aussi un ancien service oublié de remplir la carte. Ce choix est adapté à un appliance ARMv6 de production. L’identification d’un futur crash repose d’abord sur `journalctl`, `ExecMainCode` et `ExecMainStatus`. Si une analyse native est réellement nécessaire, réactivez temporairement un seul dump sous contrôle, puis restaurez immédiatement cette politique.

Après installation :

```bash
cat /proc/sys/kernel/core_pattern
cat /proc/sys/kernel/core_uses_pid
sudo systemctl show homedash.service -p LimitCORE
```

Résultats attendus : `/dev/null`, `0`, puis `LimitCORE=0`.

## Protection contre le disque plein

`homedash-disk-guard.timer` vérifie `/` toutes les cinq minutes :

- avertissement à 80 % ;
- erreur à 90 % ;
- critique à 95 % ;
- alerte critique immédiate si un fichier `core` ou `core.*` réapparaît sous `/` ;
- contrôle identique du taux d’inodes.

Le niveau est journalisé à chaque changement, puis rappelé toutes les heures tant que l’alerte persiste. L’état est stocké sous `/run`, qui reste disponible en RAM même si la partition racine approche de 100 %.

```bash
sudo systemctl status homedash-disk-guard.timer --no-pager
sudo systemctl start homedash-disk-guard.service
sudo journalctl -t homedash-disk-guard -n 50 --no-pager
```

Les journaux systemd sont bornés à 64 Mo persistants, 32 Mo volatils et sept jours par `/etc/systemd/journald.conf.d/60-homedash-journal.conf`. L’unité HomeDash limite également le débit de ses messages.

## Fichiers modifiés

- `deployment/raspberry-pi-zero/install-native.sh` : migration de l’agent Docker et installation des protections ;
- `deployment/raspberry-pi-zero/update-native.sh` : filet de migration et remise à zéro contrôlée des limites systemd ;
- `deployment/raspberry-pi-zero/homedash-zero.service` : répertoire explicite, restart borné, cores et logs bornés ;
- `deployment/raspberry-pi-zero/diagnose-crash-loop.sh` : diagnostic non destructif ;
- `deployment/raspberry-pi-zero/homedash-disk-guard*` : surveillance du stockage ;
- `deployment/raspberry-pi-zero/60-homedash-core-dumps.conf` : politique de dumps ;
- `deployment/raspberry-pi-zero/60-homedash-journal.conf` : rétention des logs ;
- `deployment/raspberry-pi/homedash-updater.service` : durcissement du chemin Docker historique ;
- `deployment/raspberry-pi/install-services.sh` : refus explicite de Docker sur ARMv6.

## Tests à effectuer

Après installation de `v0.2.1` :

```bash
sudo systemctl status homedash nginx homedash-disk-guard.timer --no-pager
sudo systemctl is-enabled homedash-updater.service || true
sudo systemctl is-active homedash-updater.service || true
sudo systemctl show homedash.service \
  -p WorkingDirectory -p ExecStart -p Restart -p RestartUSec \
  -p StartLimitBurst -p StartLimitIntervalUSec -p LimitCORE -p NRestarts
curl --fail http://127.0.0.1:4100/health/ready
sudo journalctl -u homedash -b --no-pager
df -h /
sudo find / -maxdepth 1 -type f \( -name core -o -name 'core.*' \) -ls
cd /opt/homedash/repository && git status --short
```

Attendez au moins vingt minutes et répétez les quatre dernières commandes. Le service doit rester actif, `NRestarts` stable, aucun nouveau core ne doit apparaître, l’espace disque doit rester stable et Git doit fonctionner normalement.

Un test non destructif du garde-disque peut utiliser un seuil simulé seulement dans une copie de développement du script. Ne remplissez jamais volontairement la carte SD pour tester les seuils.

## Commandes utiles pour diagnostiquer le problème à l’avenir

```bash
df -h /
df -i /
sudo du -xhd1 / 2>/dev/null | sort -h
sudo find / -maxdepth 1 -type f \( -name core -o -name 'core.*' \) -ls
cat /proc/sys/kernel/core_pattern
sudo systemctl --failed --no-pager
sudo systemctl status homedash --no-pager -l
sudo systemctl show homedash -p NRestarts -p ExecMainCode -p ExecMainStatus -p Result
sudo journalctl -u homedash -b -n 150 --no-pager
sudo journalctl -t homedash-disk-guard -b --no-pager
ps -eo pid,ppid,user,stat,lstart,args | grep -E '[n]ode|[h]omedash'
readlink -f /usr/local/bin/node
/usr/local/bin/node --version
```

Ne relancez jamais en boucle un binaire fautif pour obtenir davantage de dumps : un seul rapport systemd et, exceptionnellement, un seul core contrôlé suffisent.
