# Développement

## Prérequis

- Node.js 24 LTS ;
- npm 11+ ;
- Git ;
- pour Android : JDK 17, Android SDK API 35 et Gradle 8.10.2 ;
- Docker Desktop facultatif pour tester l’image.

## Installation

```powershell
git clone https://github.com/orpheusbauer/HomeDash.git
Set-Location HomeDash
Copy-Item .env.example .env
npm ci
npm run dev
```

Le web écoute sur 5173, l’API sur 4100. Vite proxyfie `/api`. La base de développement est `data/homedash.db` et est ignorée.

## Variables

- `HOMEDASH_ADMIN_TOKEN` : opérations administratives ; minimum 12 caractères.
- `HOMEDASH_SENSOR_INGEST_TOKEN` : capteurs HTTP, distinct.
- `HOMEDASH_DATABASE_PATH` : fichier SQLite.
- `HOMEDASH_TIMEZONE` : fuseau IANA.
- `HOMEDASH_PUBLIC_URL` : origine web autorisée en développement.
- `GOOGLE_OAUTH_*` : intégration Calendar côté serveur.
- `HOMEDASH_GITHUB_REPOSITORY` : releases à consulter.
- `HOMEDASH_UPDATER_SOCKET` et `*_TOKEN_FILE` : agent du Pi.

N’utilisez pas les valeurs de développement en production. `.env` est ignoré ; `.env.example` ne doit contenir que des exemples.

## Commandes

```powershell
npm run dev
npm run format
npm run format:check
npm run lint
npm run typecheck
npm test
npm run build
npm run db:migrate
npm run db:seed
node scripts/verify-installation.mjs http://127.0.0.1:4100
```

## Base et migrations

`node:sqlite` est utilisé pour éviter les modules natifs sur ARM. La migration démarre avant la préparation des repositories. Pour tester une migration, copiez une base réelle anonymisée, changez `HOMEDASH_DATABASE_PATH`, lancez migrate puis l’application. Ne testez pas sur l’unique base du Pi.

## Tests navigateur

Construisez et démarrez le serveur production :

```powershell
npm run build
$env:NODE_ENV='development'
npm run start
```

Vérifiez au minimum 1280×800 paysage et 800×1280, navigation clavier, mode édition tactile via émulation, modales, hors ligne et erreurs par widget.

## Android

```powershell
gradle -p apps/android assembleDebug
adb install -r apps/android/app/build/outputs/apk/debug/app-debug.apk
adb shell am start -n io.homedash.kiosk/.MainActivity
adb logcat
```

Le build Android est aussi exécuté par GitHub Actions, car le poste actuel peut ne pas disposer du SDK.

## Conventions

- TypeScript strict et validation Zod aux frontières.
- Requêtes SQLite paramétrées ; les noms de fichiers SQL sont produits uniquement par le serveur.
- Pas de secrets ou de commandes shell provenant du frontend.
- Un widget gère ses états sans faire planter les autres.
- Une migration publiée n’est jamais réécrite.
- Dépendances ajoutées seulement si elles réduisent réellement le code ou le risque.
