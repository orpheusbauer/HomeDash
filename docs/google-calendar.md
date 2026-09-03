# Relier son Google Calendar personnel à HomeDash

## Ce qu’il faut savoir avant de commencer

Pour afficher automatiquement un agenda privé même lorsque personne ne touche la tablette, Google impose OAuth 2.0. Il n’existe donc pas de véritable connexion permanente « seulement avec l’adresse Gmail » sans identifiant OAuth et sans autorisation renouvelable.

HomeDash masque toutefois presque toute cette mécanique : vous vous connectez une seule fois dans le navigateur du PC, le script prépare l’autorisation, puis le Raspberry Pi renouvelle seul les accès. Aucun mot de passe Google, secret ou token n’est envoyé au navigateur du dashboard ni stocké dans l’APK.

Pour un usage personnel, vous n’avez besoin ni d’une entreprise, ni d’un nom de domaine, ni d’un logo, ni d’une validation payante. Google autorise les applications personnelles de moins de 100 utilisateurs à continuer sans vérification ; un avertissement « application non validée » peut simplement apparaître lors de l’unique connexion.

Le réglage recommandé est **En production mais non vérifiée** : il évite l’expiration des autorisations de test au bout de sept jours. Ne demandez pas de vérification à Google.

## 1. Préparer Google Cloud une seule fois

Effectuez cette partie sur le PC avec le compte Gmail dont vous voulez afficher l’agenda.

1. Ouvrez [Google Cloud Console](https://console.cloud.google.com/) et créez un projet nommé, par exemple, `HomeDash Maison`.
2. Vérifiez que ce projet est sélectionné dans la barre supérieure.
3. Ouvrez **API et services > Bibliothèque**, recherchez **Google Calendar API**, puis cliquez sur **Activer**.
4. Ouvrez **Google Auth Platform**. Si Google affiche **Commencer**, lancez l’assistant.
5. Dans **Branding**, indiquez seulement :
   - nom de l’application : `HomeDash Maison` ;
   - adresse d’assistance : votre propre adresse Gmail ;
   - adresse de contact développeur : la même adresse.
6. Ne renseignez ni logo, ni page d’accueil, ni politique de confidentialité, ni domaine autorisé. Ces éléments servent à une application publique soumise à vérification, pas à votre dashboard personnel.
7. Dans **Audience**, choisissez **Externe** si vous utilisez un compte Gmail personnel. Un compte Google Workspace appartenant à votre organisation peut proposer **Interne**.
8. Si l’état est **Test**, ajoutez votre adresse Gmail dans **Utilisateurs tests** pour pouvoir effectuer la première connexion.
9. Dans **Accès aux données**, ajoutez uniquement :
   - `https://www.googleapis.com/auth/calendar.events` pour lire et modifier les événements ;
   - `https://www.googleapis.com/auth/calendar.calendarlist.readonly` pour lire la liste de vos agendas.
10. Revenez dans **Audience** et cliquez sur **Publier l’application**, puis confirmez. L’état doit devenir **En production**. Ne cliquez pas sur **Soumettre pour validation**.

Cette publication ne met rien sur un magasin et ne rend pas HomeDash public. Elle supprime seulement la durée de sept jours propre au mode Test. L’écran d’autorisation restera éventuellement marqué « non validé », ce qui est normal pour cet usage personnel.

## 2. Créer le client HomeDash

1. Dans **Google Auth Platform > Clients**, cliquez sur **Créer un client**.
2. Choisissez le type **Application de bureau**. N’utilisez pas **Application Web** ou **Android**.
3. Donnez-lui le nom `HomeDash sur mon PC`.
4. Cliquez sur **Créer**, puis sur **Télécharger le JSON**.
5. Placez ce fichier dans un dossier privé hors du dépôt, par exemple :

```text
C:\Secrets\homedash-client-secret.json
```

Le type « Application de bureau » est important : il autorise le retour local sur `127.0.0.1`, sans domaine, certificat public ou URI de redirection à déclarer manuellement.

## 3. Se connecter à Gmail avec le helper HomeDash

Dans PowerShell, placez-vous à la racine du projet HomeDash puis exécutez :

```powershell
node scripts/google-oauth-helper.mjs C:\Secrets\homedash-client-secret.json
```

Le navigateur s’ouvre sur Google :

1. choisissez votre compte Gmail ;
2. si Google affiche « Google n’a pas validé cette application », ouvrez **Paramètres avancés**, puis **Accéder à HomeDash Maison** ;
3. vérifiez que les autorisations concernent les événements et la liste des agendas ;
4. cliquez sur **Continuer** ou **Autoriser** ;
5. revenez dans PowerShell lorsque la page indique que l’autorisation a été reçue.

Le script utilise PKCE, vérifie l’état anti-CSRF, écoute uniquement sur `127.0.0.1` et ferme aussitôt son petit serveur local. Vous n’avez aucun access token à créer, renouveler ou recopier à la main.

PowerShell affiche trois lignes `GOOGLE_OAUTH_*`. Elles sont sensibles : ne les placez jamais dans Git, une issue GitHub, une capture d’écran ou un chat public.

## 4. Enregistrer la connexion sur le Raspberry Pi

Ouvrez une session SSH vers le Pi, puis éditez le fichier privé de HomeDash :

```bash
sudoedit /etc/homedash/homedash.env
```

Ajoutez à la fin les trois lignes exactement telles que le helper les a affichées :

```dotenv
GOOGLE_OAUTH_CLIENT_ID=....apps.googleusercontent.com
GOOGLE_OAUTH_CLIENT_SECRET=...
GOOGLE_OAUTH_REFRESH_TOKEN=1//...
```

Enregistrez, puis appliquez la configuration :

```bash
sudo systemctl restart homedash
sudo systemctl is-active homedash
sudo journalctl -u homedash --since '2 minutes ago' --no-pager
```

Le résultat attendu est `active` et aucun message `CALENDAR_AUTH_FAILED` dans le journal.

## 5. Ajouter le widget sur la tablette

1. Ouvrez **HomeDash > Paramètres** et déverrouillez avec le PIN administrateur.
2. Dans **Google Calendar**, vérifiez l’état **Connecté**.
3. Fermez les paramètres et passez en mode **Modifier**.
4. Touchez **Widget**, puis ajoutez **Google Calendar**.
5. Laissez l’identifiant `primary` pour afficher l’agenda principal.
6. Terminez le mode édition.

Les prochains événements apparaissent dans le widget. Le cache de lecture dure cinq minutes. En cas de coupure Internet, HomeDash peut afficher la dernière copie connue avec l’indication « Données en cache ».

Depuis la version **0.4.6**, l’agenda regroupe les événements des 14 prochains jours par jour de la semaine, avec des repères « Aujourd’hui » et « Demain ». Chaque événement affiche ses horaires de début et de fin et son lieu lorsqu’il est renseigné. Touchez **Description** pour lire les détails. Les événements sur toute la journée ou sur plusieurs jours indiquent leur période ; faites défiler le widget pour voir la suite de l’agenda.

## 6. Vérifier la lecture et l’écriture

1. Créez un événement de test dans Google Calendar et attendez au plus cinq minutes, ou rechargez HomeDash.
2. Vérifiez qu’il apparaît dans le widget.
3. Passez en mode **Modifier**, puis touchez **Événement** dans le widget.
4. Créez un second événement, changez son titre, puis supprimez-le.
5. Vérifiez ces trois opérations dans Google Calendar sur le Web.

La création, la modification et la suppression exigent Internet et un mode administrateur déverrouillé. Le widget en consultation reste en lecture seule.

## 7. Utiliser plusieurs agendas

Le widget utilise `primary` par défaut. Pour un agenda secondaire :

1. ouvrez Google Calendar sur le Web ;
2. dans **Paramètres de mes agendas > Intégrer l’agenda**, copiez l’**ID de l’agenda** ;
3. dans HomeDash, passez en mode **Modifier**, ouvrez les réglages du widget Calendar et saisissez les IDs séparés par des virgules ;
4. touchez **Enregistrer**, puis terminez le mode édition. Les espaces autour des IDs et les doublons sont retirés à l’enregistrement. Un champ vide rétablit `primary`.

Exemple :

```text
primary, agenda-famille@group.calendar.google.com
```

Les événements de tous les agendas sélectionnés sont réunis dans la même liste chronologique. Le nom et la couleur de l’agenda permettent de les distinguer lorsque Google les fournit ; sinon, son identifiant reste visible.

Ne copiez pas l’adresse iCal privée : HomeDash attend un ID d’agenda Google, pas une URL ICS.

## 8. Résoudre les erreurs courantes

- **`redirect_uri_mismatch`** : recréez le client en type **Application de bureau**. Ne configurez aucune URL manuellement.
- **`access_denied` ou accès bloqué** : vérifiez que votre compte figure parmi les utilisateurs tests, puis avancez par **Paramètres avancés** sur l’écran non validé.
- **La connexion cesse après sept jours** : le projet est resté en mode **Test**. Passez-le **En production**, révoquez l’ancien accès et relancez le helper.
- **Le helper affiche `ABSENT_REVOQUEZ_L_ACCES_ET_REESSAYEZ`** : retirez d’abord HomeDash des connexions tierces du compte Google, puis relancez le helper. Google ne renvoie pas toujours un nouveau refresh token après une autorisation déjà accordée.
- **`CALENDAR_AUTH_FAILED`** : vérifiez les trois lignes dans `/etc/homedash/homedash.env`, sans guillemets ni espace parasite, puis relancez le service.
- **`insufficientPermissions`** : révoquez l’accès et recommencez après avoir ajouté les deux scopes indiqués dans **Accès aux données**.
- **Un agenda partagé est visible mais non modifiable** : le compte doit avoir le droit Google `writer` ou `owner` sur cet agenda.
- **Les heures sont décalées** : vérifiez le fuseau `Europe/Paris` sur le Pi, la tablette et dans Google Calendar.

## 9. Révoquer complètement l’accès

1. Ouvrez **Compte Google > Sécurité > Connexions aux applications et services tiers** et retirez `HomeDash Maison`.
2. Supprimez les trois lignes `GOOGLE_OAUTH_*` de `/etc/homedash/homedash.env`.
3. Redémarrez HomeDash avec `sudo systemctl restart homedash`.
4. Supprimez le JSON téléchargé du PC si vous ne comptez plus reconnecter le calendrier.

Après révocation, le widget ne peut plus lire ni modifier aucun événement.

## Références officielles Google

- [Cas personnels dispensés de vérification OAuth](https://support.google.com/cloud/answer/13464323)
- [Créer un client OAuth de type application de bureau](https://developers.google.com/workspace/calendar/api/quickstart/nodejs)
- [Scopes Google Calendar](https://developers.google.com/workspace/calendar/api/auth)
- [Durée de sept jours des refresh tokens en mode Test](https://developers.google.com/identity/protocols/oauth2)
