# Tablette Android — installation murale de production

Ce guide cible la qunyiCO Y10 sous Android 10. À partir de HomeDash `0.2.0`, l’application n’est plus un lanceur Android verrouillé : la barre système reste disponible, le bouton Retour quitte HomeDash et un bouton **Android** est visible dans la barre supérieure. La tablette reste donc utilisable normalement.

HomeDash conserve en parallèle les fonctions murales utiles : icône dédiée, ouverture automatique après redémarrage, écran maintenu actif pendant l’affichage, reconnexion au Pi et détection locale de présence. La caméra s’arrête lorsque vous quittez l’application. L’extinction réelle après absence est une option distincte, désactivée par défaut et expliquée à la section 8.

## 1. Préparer une signature Android durable — une seule fois

Ne publiez plus une APK debug comme version de production. Chaque mise à jour doit être signée avec le même keystore, sinon Android refusera de remplacer l’application installée.

Sur le PC, ouvrez PowerShell et créez un dossier sauvegardé hors du dépôt :

```powershell
$keyDirectory = Join-Path $env:USERPROFILE "Documents\HomeDash-secrets"
New-Item -ItemType Directory -Force -Path $keyDirectory

keytool -genkeypair -v `
  -keystore (Join-Path $keyDirectory "homedash-release.jks") `
  -storetype JKS `
  -alias homedash `
  -keyalg RSA `
  -keysize 4096 `
  -validity 10000
```

Choisissez deux mots de passe longs et uniques : celui du keystore et celui de la clé. Conservez dans un gestionnaire de mots de passe :

- le mot de passe du keystore ;
- l’alias `homedash` ;
- le mot de passe de la clé ;
- une copie de `homedash-release.jks` sur deux supports chiffrés distincts.

La perte du keystore empêcherait toute mise à jour de l’APK déjà installée. Ne placez jamais ce fichier dans Git, OneDrive public, une capture d’écran ou la microSD du Pi.

Convertissez le keystore en Base64 et copiez le résultat dans le presse-papiers :

```powershell
$keyPath = Join-Path $keyDirectory "homedash-release.jks"
$base64 = [Convert]::ToBase64String([IO.File]::ReadAllBytes($keyPath))
Set-Clipboard $base64
```

Dans GitHub, ouvrez le dépôt puis **Settings > Secrets and variables > Actions > New repository secret**. Créez exactement ces quatre secrets :

| Secret GitHub                        | Valeur                           |
| ------------------------------------ | -------------------------------- |
| `HOMEDASH_ANDROID_KEYSTORE_BASE64`   | contenu Base64 du presse-papiers |
| `HOMEDASH_ANDROID_KEYSTORE_PASSWORD` | mot de passe du keystore         |
| `HOMEDASH_ANDROID_KEY_ALIAS`         | `homedash`                       |
| `HOMEDASH_ANDROID_KEY_PASSWORD`      | mot de passe de la clé           |

Le workflow Release s’arrête volontairement si un secret manque. Il publie ensuite une APK signée et son SHA-256.

## 2. Publier la version de production

Depuis le PC, après une CI verte :

```powershell
git tag -a v0.2.0 -m "HomeDash 0.2.0 - tablette murale de production"
git push origin v0.2.0
```

Dans GitHub, ouvrez **Actions > Release** et attendez le vert. Dans **Releases > v0.2.0**, vérifiez la présence de :

```text
homedash-kiosk-0.2.0.apk
homedash-kiosk-0.2.0.apk.sha256
```

L’artifact `homedash-kiosk-debug` du workflow CI reste destiné au développement. Ne l’installez pas sur la tablette murale finale.

## 3. Faire la transition depuis l’ancienne APK

Cette étape est unique. Les anciennes Releases utilisaient une signature debug ; la nouvelle APK signée ne pourra généralement pas les remplacer directement.

1. Notez l’URL `https://192.168.1.124`.
2. Dans HomeDash, ouvrez **Paramètres > Tablettes** et révoquez l’ancienne association après avoir préparé un nouveau code.
3. Sur Android, ouvrez **Paramètres > Applications > HomeDash > Désinstaller**.
4. Si **Désinstaller** est grisé, ouvrez **Paramètres > Sécurité > Applications d’administration de l’appareil** et désactivez HomeDash.
5. Si l’ancienne installation était réellement Device Owner et reste impossible à retirer, sauvegardez les données utiles de la tablette puis effectuez une réinitialisation usine. C’est la dernière transition nécessitant une opération lourde ; la version `0.2.0` n’utilise plus Device Owner.

La désinstallation efface l’association locale de la tablette, mais ne supprime aucune page, note ou disposition stockée sur le Raspberry Pi.

## 4. Installer l’APK sans relier la tablette au PC

Sur la tablette :

1. ouvrez Chrome ;
2. connectez-vous à GitHub si le dépôt est privé ;
3. ouvrez la Release `v0.2.0` ;
4. téléchargez `homedash-kiosk-0.2.0.apk` ;
5. si Android le demande, autorisez temporairement **Installer des applications inconnues** pour Chrome ou l’application Fichiers ;
6. ouvrez le téléchargement et choisissez **Installer** ;
7. après installation, retirez l’autorisation d’installation inconnue à Chrome ;
8. ouvrez HomeDash depuis sa nouvelle icône verte.

Cette procédure ne nécessite ni câble USB, ni ADB, ni Android Studio. Pour une mise à jour future, téléchargez la nouvelle APK signée et touchez **Mettre à jour** : données et association seront conservées.

## 5. Installer le certificat HTTPS du Pi

Si ce n’est pas déjà fait, copiez le fichier public `/var/lib/homedash/tls/root-ca.crt` sur la tablette. Sous Android 10 :

1. **Paramètres > Sécurité > Chiffrement et identifiants** ;
2. **Installer un certificat > Certificat d’autorité de certification** ;
3. sélectionnez `homedash-root-ca.crt` ;
4. testez `https://192.168.1.124` dans Chrome ;
5. poursuivez uniquement si aucune alerte TLS n’apparaît.

N’installez jamais `root-ca.key` sur la tablette : cette clé privée doit rester sur le Pi et dans les sauvegardes chiffrées.

## 6. Première ouverture et association

Dans l’écran de configuration HomeDash :

1. saisissez `https://192.168.1.124` ;
2. choisissez **Paysage** ou **Portrait** ;
3. dans HomeDash sur un navigateur déjà connecté au Pi, ouvrez **Paramètres**, saisissez le PIN `0000`, puis **Tablettes > Associer une tablette** ;
4. recopiez le code à six chiffres ;
5. nommez l’appareil `Tablette entrée` ;
6. touchez **Enregistrer et ouvrir HomeDash** ;
7. acceptez la permission caméra ;
8. acceptez les notifications si la ROM les demande.

Le code d’association expire après dix minutes et ne fonctionne qu’une fois. Il n’est plus nécessaire lors des ouvertures suivantes.

## 7. Choisir portrait ou paysage depuis le dashboard

Sur la tablette :

1. ouvrez l’icône engrenage ;
2. saisissez le PIN `0000` ;
3. ouvrez la section **Affichage tablette** ;
4. touchez **Paysage** ou **Portrait**.

Android tourne immédiatement l’activité. HomeDash applique automatiquement :

- 12 colonnes en grand paysage ;
- 6 colonnes en portrait de tablette ;
- une seule colonne sur un écran très étroit ;
- une barre supérieure sur deux rangées en portrait ;
- des cartes, marges, titres et onglets adaptés à la largeur disponible.

La transformation responsive n’écrase pas la disposition 12 colonnes enregistrée tant que le mode édition n’est pas activé.

## 8. Facultatif : éteindre l’écran après 90 secondes d’absence

Une application Android ordinaire ne peut pas éteindre réellement l’écran. HomeDash peut demander l’autorisation Android standard **Administrateur de l’appareil** afin d’appeler uniquement le verrouillage de l’écran après 90 secondes sans visage détecté.

Cette option :

- est désactivée par défaut ;
- n’est pas le mode **Device Owner** ;
- n’active ni `lock task`, ni plein écran forcé, ni remplacement du lanceur ;
- ne masque jamais Accueil, Retour ou le bouton **Android** ;
- ne fonctionne que lorsque HomeDash est ouvert ; la caméra et le service s’arrêtent dès que vous quittez l’application.

Pour l’activer :

1. ouvrez **Paramètres HomeDash > Affichage tablette > Adresse du serveur et association** ;
2. touchez **Activer l’extinction après 90 secondes** ;
3. lisez l’écran Android puis accordez l’autorisation à HomeDash ;
4. revenez au dashboard et testez l’extinction puis le réveil par présence.

Si la tablette possède un verrouillage sécurisé, Android peut afficher l’écran de verrouillage après le réveil. HomeDash ne contourne pas cette sécurité. Dans ce cas, désactivez l’option si la saisie du code est gênante et utilisez plutôt un délai d’écran Android, une luminosité faible ou, ultérieurement, un capteur PIR/mmWave externe.

Pour la désactiver, revenez au même écran et touchez **Désactiver l’extinction après 90 secondes**. HomeDash désactive alors la fonction et retire sa propre autorisation d’administration. Si la ROM ne la retire pas, faites-le dans **Paramètres Android > Sécurité > Applications d’administration de l’appareil**.

## 9. Entrer et sortir de HomeDash au quotidien

Pour ouvrir HomeDash :

- touchez l’icône **HomeDash** sur l’écran d’accueil ;
- après un redémarrage complet, l’application tente de s’ouvrir automatiquement.

Pour revenir à Android :

- touchez **Android** en haut à droite du dashboard ; ou
- touchez le bouton Android **Retour** ; ou
- utilisez le bouton rond **Accueil** de la barre système.

HomeDash ne démarre plus `lock task`, ne masque plus la barre de navigation et ne remplace plus le lanceur du constructeur. Lorsque vous quittez l’application, le service de présence et la caméra sont arrêtés. Lorsque vous rouvrez HomeDash, le service redémarre.

Pour changer l’URL ou refaire l’association, ouvrez **Paramètres > Affichage tablette > Adresse du serveur et association**.

## 10. Autoriser un démarrage fiable après reboot

Le récepteur de boot est déjà inclus dans l’APK. Les ROMs de tablettes peuvent néanmoins bloquer les lancements automatiques. Dans les paramètres de la Y10 :

1. **Applications > HomeDash > Batterie > Sans restriction** ;
2. activez **Démarrage automatique** si ce menu existe ;
3. autorisez l’activité en arrière-plan ;
4. conservez le Wi-Fi actif en veille ;
5. désactivez l’économiseur de batterie pour HomeDash ;
6. redémarrez physiquement la tablette et attendez deux minutes sans la toucher.

Si la ROM refuse malgré tout d’afficher une application au boot, HomeDash reste accessible en une pression grâce à son icône. Ne remettez pas HomeDash comme lanceur par défaut : cela ferait disparaître à nouveau l’accès normal à Android.

Après un redémarrage, Android exige toujours un premier déverrouillage si la tablette possède un code système. Aucune application ne doit contourner cette étape.

## 11. Montage mural et alimentation

Avant le montage définitif :

1. testez la tablette posée à son emplacement pendant 48 heures ;
2. vérifiez que le support ne masque ni caméra, ni ventilation, ni boutons ;
3. utilisez un câble et une alimentation stables ;
4. gardez une luminosité modérée ;
5. vérifiez la température et l’état physique de la batterie chaque semaine le premier mois ;
6. si la batterie chauffe, gonfle ou reste constamment à 100 %, débranchez immédiatement et mettez en place une prise intelligente ou un cycle de charge adapté.

Ne collez pas définitivement la tablette avant d’avoir validé le bouton **Android**, le redémarrage automatique et les deux orientations.

## 12. Mise à jour future sans ordinateur branché à la tablette

Pour chaque nouvelle version :

1. développez et poussez depuis le PC ;
2. attendez la CI verte ;
3. créez un nouveau tag ;
4. attendez la Release signée ;
5. ouvrez cette Release depuis Chrome sur la tablette ;
6. téléchargez la nouvelle APK ;
7. touchez **Mettre à jour** ;
8. ouvrez HomeDash et vérifiez la version dans Paramètres.

N’effacez jamais le keystore et ne changez pas les quatre secrets GitHub sans mettre leurs nouvelles valeurs en cohérence avec le même fichier de clé.

## 13. Recette de validation avant mise au mur

Validez chaque point :

- icône HomeDash visible et ouverture en une pression ;
- bouton rond Accueil visible ;
- bouton Retour quitte l’application ;
- bouton **Android** quitte l’application ;
- caméra arrêtée après la sortie ;
- réouverture et reconnexion sans nouveau code ;
- passage paysage/portrait depuis Paramètres ;
- onglets et cartes lisibles dans les deux orientations ;
- si l’extinction après absence est activée : extinction, réveil et retrait de l’autorisation testés ;
- redémarrage tablette et ouverture automatique ;
- redémarrage Pi et reconnexion automatique ;
- coupure Internet avec LAN actif : dashboard local toujours disponible ;
- coupure puis retour Wi-Fi sans réinstaller l’APK ;
- fonctionnement continu pendant au moins 48 heures.

## 14. Dépannage

- **L’APK refuse la mise à jour** : l’ancienne APK n’a pas la même signature. Désinstallez-la une seule fois, puis installez la version signée.
- **HomeDash ne démarre pas après reboot** : autorisez démarrage automatique et batterie sans restriction dans la ROM.
- **Écran blanc** : testez l’URL dans Chrome et mettez Android System WebView/Chrome à jour.
- **Erreur de certificat** : réinstallez `root-ca.crt`, vérifiez l’heure et utilisez exactement `https://192.168.1.124`.
- **Orientation inchangée** : vérifiez que vous utilisez bien l’APK `0.2.0`, pas le site dans Chrome.
- **Caméra inactive après retour** : rouvrez HomeDash et contrôlez la permission caméra dans les paramètres Android.
- **L’écran ne s’éteint pas après absence** : activez l’option native, vérifiez l’autorisation Administrateur de l’appareil et testez la caméra en lumière réelle.
- **Un code Android apparaît au réveil** : c’est le verrouillage système normal. Désactivez l’extinction automatique si ce comportement ne vous convient pas.
- **Besoin de modifier le serveur** : Paramètres HomeDash > Affichage tablette > Adresse du serveur et association.
