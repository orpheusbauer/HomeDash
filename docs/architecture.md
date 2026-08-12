# Architecture et décisions

## Flux général

```text
PC de développement -> GitHub Actions -> GHCR + GitHub Release
                                            |
                                            v
Tablette Android <---- HTTPS/WebSocket ---- Raspberry Pi
        |                                   |-- Fastify/API
        |                                   |-- React statique
        |                                   |-- SQLite + cache
        |                                   `-- agent de mise à jour isolé
        `-- caméra/présence locale
```

Le Raspberry Pi est la source de vérité. La tablette est remplaçable et ne conserve que l’adresse du serveur, son identifiant et son token propre.

## Choix principaux

- **React + TypeScript + Vite** : interface composable, compilation légère et compatibilité avec le WebView Chrome d’Android 10 via le bundle legacy.
- **GridStack** : interactions tactiles de grille matures sans réimplémenter drag/resize.
- **Fastify** : API compacte, validation et plugins de sécurité explicites.
- **`node:sqlite`** : aucune compilation native sur le Raspberry Pi, une seule base locale et transactions simples. Drizzle décrit le schéma, les migrations SQL restent explicites.
- **REST + WebSocket** : REST pour les commandes et données ; un seul canal WebSocket pour invalider ou pousser les valeurs. MQTT n’est pas obligatoire pour le MVP.
- **Open-Meteo** : pas de clé côté client ni d’abonnement ; cache serveur et retour de la dernière valeur en cas de coupure.
- **Docker Compose + images par digest** : installation reproductible. Le serveur n’accède jamais au socket Docker.
- **Agent de mise à jour systemd** : seul ce petit processus peut appeler Docker. Il accepte uniquement une image GHCR autorisée et un digest SHA-256 issu d’une release.
- **Kotlin/WebView** : le web porte toute l’interface ; le natif reste limité au kiosque, boot, écran, caméra et télémétrie.

## Modèle de widget

Un `WidgetManifest` décrit identifiant, version, icône, catégorie, tailles, schéma de configuration, permissions et stratégie de rafraîchissement. Une `WidgetInstance` relie ce manifeste à une page, une position et une configuration JSON. Le registre visuel est dans `WidgetRenderer.tsx`, le catalogue serveur dans `widget-catalog.ts`.

Le MVP utilise un registre compilé, volontairement plus simple et plus sûr qu’un chargement dynamique de code. Ajouter un widget touche le catalogue et le registre, pas le moteur de pages, de grille ou de persistance.

## Données et résilience

SQLite contient pages, instances, historiques de layout, notes, capteurs, cache externe, paramètres et tablettes. Le journal WAL, les clés étrangères et un délai d’attente de verrou sont activés. Les écritures de layout et de notes utilisent une révision optimiste : une tablette ancienne ne peut pas écraser silencieusement une valeur plus récente.

La météo et Calendar rendent les dernières données en cache avec l’état `stale` lorsque l’accès Internet échoue. Le service worker conserve l’enveloppe applicative ; les fonctions locales continuent sur le LAN.

## Frontières de sécurité

- Les lectures quotidiennes sont accessibles sur le LAN ; pages, widgets, Calendar en écriture, appareils, backups et mises à jour exigent `X-HomeDash-Admin`.
- L’ingestion capteur utilise un jeton distinct `X-HomeDash-Sensor`.
- Chaque tablette reçoit après un code unique de six chiffres un jeton aléatoire affiché une seule fois, stocké haché côté serveur.
- Le token administrateur reste en mémoire/sessionStorage du navigateur et n’est jamais injecté dans le bundle.
- Helmet, limites de corps, rate limiting, Zod et requêtes SQLite paramétrées limitent les entrées malformées.
- Caddy termine TLS. L’API n’est publiée que sur `127.0.0.1:4100` sur l’hôte.
- Le conteneur applicatif est non-root, read-only, sans capabilities. L’agent privilégié est séparé et authentifié par socket Unix + token fichier.

Le LAN ne doit pas être considéré comme parfaitement sûr : isolez les objets connectés dans un VLAN si possible, n’exposez ni 4100 ni le socket Docker, et ne redirigez pas 80/443 depuis Internet.

## API résumée

Toutes les routes sont sous `/api/v1` :

- `bootstrap`, `pages`, `widgets`, `notes` : dashboard ;
- `weather`, `calendar`, `system`, `network`, `sensors` : données ;
- `devices/pairing`, `devices/pair`, `devices/:id/telemetry` : tablette ;
- `backups`, `updates/check`, `updates/install`, `updates/status` : exploitation ;
- `realtime` : WebSocket ;
- `/health/live` et `/health/ready` : supervision.
