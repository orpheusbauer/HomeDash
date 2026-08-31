# HomeDash

HomeDash est un dashboard domestique local-first destiné à un Raspberry Pi et à une tablette Android murale. Le Raspberry Pi héberge l’interface, l’API Fastify, SQLite, les intégrations et les mises à jour. L’application Kotlin transforme la tablette en client kiosque et réalise la détection de présence localement, sans enregistrer ni transmettre d’image.

## État du projet

La version `0.2.0` fournit déjà :

- une grille tactile responsive avec déplacement, redimensionnement, ajout, configuration et suppression de widgets ;
- des pages persistantes avec historique et annulation de la dernière disposition ;
- les widgets horloge, notes autosauvegardées, météo actuelle, prévisions, capteurs, réseau, système et Google Calendar ;
- météo Open-Meteo mise en cache, Calendar OAuth 2.0 en lecture/écriture, capteurs HTTP et capteurs simulés ;
- WebSocket pour les changements de dashboard, métriques et capteurs ;
- SQLite local, migrations, sauvegardes cohérentes et cache hors ligne ;
- authentification locale des opérations administratives et association à usage unique des tablettes ;
- application Android 10+ murale, APK signée, démarrage au boot, sortie simple vers Android, orientations portrait/paysage, télémétrie et détection locale de visage comme signal de présence — aucune reconnaissance ;
- déploiement natif ARMv6 sans Docker, Nginx HTTPS local, `systemd`, releases précompilées, sauvegarde, health check et rollback ;
- CI GitHub, tests TypeScript, archive native et Release Android signée.

Les limites matérielles qui doivent encore être validées sur la tablette qunyiCO Y10 sont suivies dans [remaining-work.md](docs/remaining-work.md).

## Démarrage local

Prérequis de développement : Node.js 24 LTS et npm 11+. Le Raspberry Pi Zero utilise séparément un runtime Node 22 ARMv6 verrouillé ; il ne compile jamais le projet.

```powershell
Copy-Item .env.example .env
npm install
npm run dev
```

Ouvrez `http://localhost:5173`. Le code PIN administrateur demandé est `0000`. Après sa validation, le serveur crée une session administrateur aléatoire et temporaire pour l’onglet courant.

Contrôles complets :

```powershell
npm run format:check
npm run lint
npm run typecheck
npm test
npm run build
```

## Documentation

- [Installation complète du Raspberry Pi](docs/installation-raspberry-pi.md)
- [Passage définitif en production](docs/production-deployment.md)
- [Préparation et installation de la tablette](docs/android-kiosk.md)
- [Google Calendar OAuth](docs/google-calendar.md)
- [Capteurs HTTP et ESP32](docs/sensors.md)
- [Mises à jour et releases](docs/updates.md)
- [Sauvegarde et restauration](docs/backup-and-restore.md)
- [Créer un widget](docs/creating-a-widget.md)
- [Architecture et sécurité](docs/architecture.md)
- [Développement et commandes](docs/development.md)
- [Travail restant et ordre conseillé](docs/remaining-work.md)

## Structure

```text
apps/web/             React/Vite et catalogue des widgets
apps/server/          Fastify, SQLite, services et API
apps/android/         conteneur kiosque Kotlin pour Android 10+
packages/contracts/   schémas Zod et types partagés
deployment/           installation native Pi Zero, Nginx, systemd et ancien chemin Docker
examples/             exemple ESP32/DHT22
scripts/              OAuth, secrets et diagnostic
docs/                 guides opératoires
```

## Licence et secrets

Aucune licence n’est encore choisie. Ajoutez un fichier `LICENSE` avant de rendre le dépôt public si vous souhaitez définir explicitement les droits de réutilisation. Les `.env`, clés, certificats privés, identifiants OAuth et tokens sont ignorés par Git ; vérifiez malgré tout `git diff --cached` avant chaque push.
