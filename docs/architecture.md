# Architecture et décisions — cible Raspberry Pi Zero ARMv6

## Vue d’ensemble

```text
PC de développement
  -> push/tag GitHub
  -> GitHub Actions construit TypeScript + Vite + APK
  -> GitHub Release publie archive native + SHA-256

Tablette Android
  <-> HTTPS / WebSocket
Nginx natif sur le Pi Zero
  <-> HTTP loopback 127.0.0.1:4100
Node.js/Fastify natif
  <-> SQLite local
```

Le Raspberry Pi est la source de vérité. La tablette conserve seulement l’adresse, son identifiant et son token. Les images de caméra utilisées pour la présence restent en mémoire sur la tablette et ne sont pas envoyées au Pi.

## Pourquoi Docker a été retiré de cette cible

Le Zero original utilise un BCM2835 ARMv6 monocœur avec 512 Mo. Les images officielles modernes visent principalement ARMv7/ARM64, et Docker ajouterait mémoire, espace disque, couche réseau et complexité de build. HomeDash s’exécute donc comme un processus Node non privilégié sous `systemd`.

Les anciens fichiers `deployment/docker` peuvent rester dans le dépôt comme référence pour une future machine ARM64, mais ils ne font plus partie du chemin de release et d’installation du Zero.

## Build déporté hors du Pi

Le Zero ne doit pas exécuter :

- TypeScript (`tsc`) ;
- Vite/Rolldown/esbuild ;
- Gradle/Android SDK ;
- les dépendances de développement npm.

Le workflow de release construit ces éléments sur GitHub puis crée une archive contenant uniquement les `dist`, les manifests npm et le lockfile. Sur le Pi, `npm ci --omit=dev --ignore-scripts` installe les dépendances JavaScript d’exécution. `node:sqlite` évite tout module SQLite natif à compiler.

## Node.js sur ARMv6

Node.js 22 fournit l’API `node:sqlite` requise par HomeDash, mais le projet Node officiel ne publie pas de binaire ARMv6. `install-node-armv6.sh` utilise le projet communautaire `nodejs/unofficial-builds`, version `22.23.1`, optimisée pour `armv6zk`.

Mesures de réduction du risque :

- URL et version épinglées ;
- SHA-256 attendu codé dans le script ;
- vérification avant extraction ;
- test de `node:sqlite` après installation ;
- aucun paquet natif npm ;
- ancienne version Node conservée sous `/opt` lors d’un futur changement.

Cette dépendance non officielle est le principal risque de pérennité. Un Zero 2 W supprime cette contrainte.

## Processus et privilèges

### `homedash.service`

- utilisateur/groupe `homedash` sans shell ;
- code en lecture seule sous `/opt/homedash/current` ;
- écriture uniquement dans `/var/lib/homedash/data` ;
- heap Node limité à 192 Mo ;
- limite `systemd` à 400 Mo ;
- redémarrage sur échec ;
- restrictions kernel, home, privilèges et tâches.

### Nginx

- ports 80/443 côté LAN ;
- redirection HTTP vers HTTPS pour l’interface ;
- terminaison TLS avec une CA locale ;
- proxy WebSocket et HTTP vers `127.0.0.1:4100` ;
- écoute de l’IP LAN sur le port 4100 uniquement pour l’ingestion ESP32 ;
- toutes les autres routes externes sur 4100 sont refusées.

Le serveur Fastify n’écoute jamais directement sur toutes les interfaces.

## Données

SQLite contient pages, instances de widgets, historiques de layout, notes, capteurs, cache externe, paramètres et tablettes. WAL, clés étrangères et délai d’attente sont activés. Les écritures de layout et notes utilisent une révision optimiste.

Chemins :

```text
/var/lib/homedash/data/homedash.db
/var/lib/homedash/data/homedash.db-wal
/var/lib/homedash/data/homedash.db-shm
```

Les mises à jour arrêtent le processus avant la sauvegarde afin de produire une copie cohérente et permettre un rollback de migration.

## Releases atomiques

```text
/opt/homedash/releases/0.2.0
/opt/homedash/releases/0.3.0
/opt/homedash/releases/0.4.0
/opt/homedash/releases/0.4.1
/opt/homedash/releases/0.4.5
/opt/homedash/current -> /opt/homedash/releases/0.4.5
```

L’updater natif télécharge et prépare une nouvelle release sans toucher à l’active. Après sauvegarde, il remplace atomiquement le lien `current`, démarre et sonde la santé. En cas d’échec, il restaure la base et le lien précédent.

Depuis 0.4.0, un agent `systemd` séparé, exécuté avec les privilèges nécessaires, accepte uniquement un manifeste de release natif strict sur un socket Unix protégé par un secret local. Le serveur web ne reçoit aucun droit `sudo` et ne peut demander ni commande arbitraire, ni URL de téléchargement libre. L’interface peut ainsi lancer une release HomeDash publiée, puis suivre son état, sans exposer un shell privilégié.

## HTTPS local

Une CA HomeDash est créée une seule fois sous `/var/lib/homedash/tls`. Elle signe un certificat Nginx contenant :

- `DNS:homedash.local` ;
- `IP:IP_RÉSERVÉE_DU_PI`.

Seul `root-ca.crt` est exporté vers la tablette. La clé `root-ca.key` et la clé serveur restent sur le Pi et dans les sauvegardes chiffrées.

## Contraintes de performance retenues

- une tablette principale ;
- quelques clients navigateur occasionnels ;
- capteurs envoyant au plus quelques mesures par minute ;
- métriques système toutes les 30 secondes ;
- mocks périodiques désactivés en production ;
- pas de navigateur ni de compilation sur le Pi ;
- pas de reconnaissance faciale ;
- pas de traitement d’image sur le serveur.

Une augmentation importante du nombre de clients, widgets temps réel ou intégrations justifie un Zero 2 W ou un Pi plus récent plutôt qu’une complexification du logiciel.

## Frontières de sécurité

- N’exposez aucun port du Pi sur Internet.
- Réservez l’adresse du Pi dans le routeur.
- Utilisez SSH par clé et une Deploy key GitHub en lecture seule.
- Le PAT Releases est limité à `Contents: Read-only` et au seul dépôt.
- Le PIN `0000` n’est envoyé qu’au déverrouillage HTTPS. Il crée une session aléatoire de huit heures conservée dans l’onglet, et l’API limite le déverrouillage à cinq tentatives par minute.
- Un PIN aussi simple protège surtout contre une manipulation accidentelle. HomeDash doit rester strictement sur le LAN et ne jamais être publié sur Internet.
- Isolez idéalement les objets connectés dans un VLAN IoT.
- Le port ESP32 en HTTP transmet un token en clair : autorisez-le seulement depuis ce VLAN ou migrez l’ESP32 vers HTTPS.
- Sauvegardez `/etc/homedash` et `/var/lib/homedash/tls` chiffrés hors du Pi.
