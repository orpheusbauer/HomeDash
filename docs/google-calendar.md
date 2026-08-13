# Configurer Google Calendar

HomeDash utilise OAuth 2.0 côté serveur avec un refresh token. Aucun secret ni token Google n’atteint le navigateur ou l’APK. L’interface sait lister les événements et, en mode édition administrateur, en créer, modifier et supprimer.

## 1. Créer le projet Google

1. Ouvrez [Google Cloud Console](https://console.cloud.google.com/).
2. Créez un projet, par exemple `HomeDash Maison`.
3. APIs et services > Bibliothèque > activez **Google Calendar API**.
4. APIs et services > Écran de consentement OAuth.
5. Choisissez **Externe** pour un compte Gmail personnel.
6. Renseignez nom et email de contact ; n’ajoutez pas de domaine inutile.
7. Ajoutez votre propre adresse Google comme utilisateur de test.
8. Dans Accès aux données/scopes, autorisez `https://www.googleapis.com/auth/calendar` puisque HomeDash fait du CRUD.
9. Identifiants > Créer des identifiants > ID client OAuth > **Application de bureau**.
10. Téléchargez le JSON dans un dossier privé hors dépôt, par exemple `C:\Secrets\homedash-client-secret.json`.

Un projet OAuth externe laissé en mode **Testing** peut émettre des refresh tokens expirant après sept jours. Pour un usage durable, publiez l’application en production selon les options proposées par Google ; comme vous êtes le seul utilisateur, gardez la liste d’utilisateurs/scopes minimale. Google peut faire évoluer son écran de configuration.

## 2. Produire le refresh token sur le PC

Depuis le dépôt :

```powershell
node scripts/google-oauth-helper.mjs C:\Secrets\homedash-client-secret.json
```

Le script :

1. génère PKCE et un état anti-CSRF ;
2. ouvre le consentement Google dans le navigateur système ;
3. écoute uniquement sur `127.0.0.1` avec un port aléatoire ;
4. échange le code ;
5. affiche les trois variables à copier.

Cette approche suit le flux Google pour [applications de bureau avec PKCE](https://developers.google.com/identity/protocols/oauth2/native-app). N’envoyez jamais les lignes produites dans un chat public, une issue ou Git.

## 3. Configurer le Pi

```bash
sudoedit /etc/homedash/homedash.env
```

Ajoutez :

```dotenv
GOOGLE_OAUTH_CLIENT_ID=....apps.googleusercontent.com
GOOGLE_OAUTH_CLIENT_SECRET=...
GOOGLE_OAUTH_REFRESH_TOKEN=1//...
```

Puis :

```bash
sudo systemctl restart homedash
sudo journalctl -u homedash --since '2 minutes ago' --no-pager
```

Dans Paramètres, Google Calendar doit être indiqué comme configuré. Ajoutez ensuite le widget **Calendrier**. Par défaut il lit `primary`. Dans la configuration du widget, saisissez plusieurs IDs séparés par des virgules si nécessaire.

## 4. Tester lecture et écriture

1. Vérifiez qu’un événement existant apparaît.
2. Passez en mode Modifier.
3. Dans le widget Calendar, touchez **Événement**.
4. Créez un événement test dans 15 minutes.
5. Modifiez son titre.
6. Supprimez-le.
7. Vérifiez chaque opération dans Google Calendar web.

Le cache de lecture dure cinq minutes. Une coupure Internet affiche les dernières données connues comme périmées. Les écritures exigent Internet et le token administrateur.

## 5. Problèmes courants

- `redirect_uri_mismatch` : utilisez bien un client **Application de bureau**, pas Web.
- Pas de `refresh_token` : retirez HomeDash des accès tiers du compte puis relancez ; le helper demande déjà `prompt=consent` et `access_type=offline`.
- Token invalide après sept jours : le projet OAuth est probablement encore en mode Testing.
- `insufficientPermissions` : le scope accordé était lecture seule ; révoquez et recommencez avec le scope `calendar`.
- Calendrier partagé non modifiable : vérifiez les droits `writer/owner` dans Google.
- Heure décalée : vérifiez `Europe/Paris` sur Pi, tablette et calendrier Google.

Pour révoquer : Compte Google > Sécurité > Connexions aux applications tierces, retirez HomeDash, effacez les trois variables puis redémarrez.
