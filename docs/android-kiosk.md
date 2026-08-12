# Tablette Android : installation kiosque pas à pas

La cible initiale est la qunyiCO Y10 sous Android 10. Les libellés de menus peuvent différer légèrement selon sa ROM. L’application charge HomeDash en WebView, transmet batterie/charge/présence et traite les images de caméra entièrement en mémoire sur la tablette. Elle ne réalise aucune reconnaissance d’identité et n’enregistre ni ne transmet d’image.

## 1. Choisir le niveau de kiosque

Deux modes sont possibles :

1. **Mode simple** : APK installé, HomeDash choisi comme application d’accueil, plein écran. Facile à retirer, mais l’utilisateur peut encore atteindre certains écrans Android.
2. **Device Owner recommandé** : vrai `lock task mode`, démarrage plus fiable et droit de verrouiller l’écran. Il faut une tablette réinitialisée, sans compte ni autre utilisateur. Retirer ce mode peut nécessiter une nouvelle réinitialisation.

Commencez par le mode simple pour valider caméra, WebView et réseau. Passez ensuite au Device Owner.

## 2. Préparer Android

1. Chargez la tablette à plus de 50 % et notez tout ce qui doit être sauvegardé.
2. Réglages > À propos de la tablette > touchez sept fois **Numéro de build**.
3. Réglages > Système > Options pour les développeurs > activez **Débogage USB**.
4. Branchez la tablette au PC avec un câble USB de données et acceptez l’empreinte RSA.
5. Installez les Android SDK Platform Tools sur le PC puis vérifiez :

```powershell
adb devices
```

La ligne doit finir par `device`, pas `unauthorized`. Android 10 ne dispose pas du nouveau jumelage ADB Wi-Fi d’Android 11 ; utilisez d’abord USB.

## 3. Obtenir l’APK

Option la plus simple :

1. ouvrez le dépôt sur GitHub, puis **Actions** ;
2. dans la colonne de gauche, choisissez **CI** ;
3. ouvrez l’exécution correspondant au dernier commit de `main` — il faut ouvrir le run lui-même, pas seulement rester sur la liste ;
4. sur l’onglet **Summary**, descendez tout en bas jusqu’à la section **Artifacts** ;
5. cliquez sur **homedash-kiosk-debug** pour télécharger une archive ZIP ;
6. décompressez le ZIP : il contient `app-debug.apk`.

L’artifact peut exister même si le run global est rouge, à condition que le job **android** soit vert et que l’étape **Upload artifact** ait réussi. S’il n’y a aucune section **Artifacts**, ouvrez le job **android** et vérifiez cette étape. L’APK debug convient à une installation domestique initiale mais pas à une distribution publique.

Construction locale si Android Studio/SDK et JDK 17 sont installés :

```powershell
gradle -p apps/android assembleDebug
```

L’APK se trouve dans `apps/android/app/build/outputs/apk/debug/app-debug.apk`. Le dépôt n’inclut volontairement pas de keystore. Pour une APK release durable, créez et sauvegardez hors Git un keystore, puis ajoutez la signature au workflow avant la 1.0.0.

## 4. Installer le certificat HTTPS du Raspberry Pi

Copiez `homedash-caddy-root.crt` sur la tablette. Sur Android 10 :

1. Réglages > Sécurité > Chiffrement et identifiants ;
2. **Installer un certificat** > **Certificat d’autorité de certification** ;
3. confirmez l’avertissement ;
4. choisissez `homedash-caddy-root.crt` ;
5. si Android l’exige, définissez un verrouillage local (un simple PIN conservé dans votre gestionnaire de mots de passe).

L’application autorise explicitement les CA utilisateur dans `network_security_config.xml`. Le build debug permet aussi HTTP pour le tout premier diagnostic LAN ; le build release le refuse. Testez l’URL dans Chrome : aucune alerte TLS ne doit rester. Ne contournez pas les erreurs SSL dans le code du WebView.

## 5. Installer et tester en mode simple

```powershell
adb install -r .\app-debug.apk
adb shell am start -n io.homedash.kiosk/.MainActivity
```

Sur la tablette :

1. autorisez la caméra ;
2. saisissez `https://homedash.home.arpa` ou l’adresse Caddy choisie ;
3. sur HomeDash depuis le PC, ouvrez Paramètres > déverrouillez > Tablettes > **Associer une tablette** ;
4. saisissez le code à six chiffres dans l’application et nommez l’appareil ;
5. touchez **Associer et ouvrir** ;
6. vérifiez que le dashboard apparaît et que la tablette est listée avec sa batterie dans Paramètres.

Le code expire après dix minutes et n’est utilisable qu’une fois. Le token rendu à la tablette ne peut pas administrer HomeDash.

Pour revenir à l’écran de configuration, appuyez cinq fois rapidement sur **Volume bas**. Cette porte de maintenance suppose un accès physique à l’appareil.

## 6. Valider la détection de présence avant le kiosque dur

Posez la tablette à son emplacement définitif puis vérifiez pendant au moins une journée :

- une notification permanente **HomeDash actif** est visible ;
- la caméra frontale n’est pas masquée par le support mural ;
- un visage dans le champ réveille l’écran ;
- aucune image n’apparaît dans le stockage ou sur le réseau ;
- après environ 90 secondes sans visage, l’écran se verrouille si Device Admin/Owner est actif ;
- une pièce sombre ou un visage très de côté peut ne pas être détecté ;
- le service ne chauffe pas anormalement la tablette.

Le détecteur ML Kit est configuré en mode rapide sur des images 320×240, une seule analyse à la fois. C’est une **détection de visage comme proxy de présence**, pas une reconnaissance faciale. Si cette stratégie est trop coûteuse sur la Y10, la prochaine optimisation est d’analyser une image toutes les 500–1000 ms ou d’utiliser un capteur PIR externe via ESP32.

Limite Android réelle : une caméra est une permission « while in use ». Le service est démarré pendant que l’activité kiosque est visible et reste au premier plan. Les versions Android récentes restreignent le démarrage d’un service caméra depuis l’arrière-plan ; Device Owner fait partie des exemptions documentées. La ROM de la Y10 peut néanmoins tuer le service. Il faut donc valider le matériel et ne pas promettre un réveil 100 % fiable tant que ce test n’est pas fait.

## 7. Désactiver les optimisations constructeur

Dans les réglages de la tablette :

1. Applications > HomeDash > Batterie > **Sans restriction** / **Ne pas optimiser** ;
2. autorisez le démarrage automatique s’il existe un menu constructeur ;
3. Wi-Fi > préférences > conserver le Wi-Fi actif en veille ;
4. désactivez la rotation automatique et gardez le paysage ;
5. désactivez économiseur de batterie, écran de veille publicitaire et mises en veille forcées ;
6. gardez luminosité modérée et adaptative si elle fonctionne correctement ;
7. si la batterie gonfle ou chauffe en charge permanente, arrêtez l’installation et utilisez une prise intelligente avec cycles de charge ou une alimentation adaptée.

## 8. Passer en Device Owner

Cette opération est destructive si la tablette contient déjà des données. La procédure Android exige qu’il n’existe aucun compte, profil professionnel ni utilisateur secondaire.

1. Réinitialisez la tablette aux paramètres d’usine.
2. Pendant l’assistant initial, ne configurez aucun compte Google. Connectez seulement le Wi-Fi si nécessaire.
3. Réactivez les options développeur et le débogage USB.
4. Réinstallez l’APK :

```powershell
adb install .\app-debug.apk
adb shell dpm set-device-owner io.homedash.kiosk/.KioskDeviceAdminReceiver
```

La commande doit répondre `Success: Device owner set`. Sinon, lisez le message : un compte ou un utilisateur existe souvent encore. Ne tentez pas de contourner cette vérification.

5. Lancez l’application :

```powershell
adb shell am start -n io.homedash.kiosk/.MainActivity
```

6. Associez-la de nouveau : la réinitialisation a effacé le token précédent. Révoquez l’ancien appareil dans HomeDash avec l’icône corbeille.
7. Appuyez sur Home et choisissez HomeDash **Toujours** si Android le demande.
8. Redémarrez : HomeDash doit revenir sans intervention et entrer en lock task.

La commande suit le modèle de provisioning d’appareil entièrement géré de la [documentation Android Enterprise](https://developer.android.com/work/guide). Le lock task autorisé par le Device Owner est décrit dans la [documentation Android dédiée](https://developer.android.com/work/dpc/dedicated-devices/lock-task-mode).

## 9. Tests d’acceptation sur la tablette

Effectuez chaque test et notez le résultat :

1. redémarrage du Pi pendant que la tablette reste allumée : reconnexion automatique ;
2. redémarrage tablette : lancement automatique ;
3. coupure Internet mais LAN actif : notes, pages et édition fonctionnent ;
4. coupure Wi-Fi : message hors ligne, puis retour sans relancer l’APK ;
5. déplacement/redimensionnement au doigt et persistance après reload ;
6. orientation verrouillée paysage ;
7. écran éteint après absence puis réveil à 0,5 m, 1 m et 2 m ;
8. pièce claire, sombre, contre-jour et plusieurs personnes ;
9. utilisation continue 24 h puis 7 jours : RAM, température, reconnexions ;
10. mise à jour HomeDash : écran temporairement hors ligne puis retour sur la nouvelle version.

## 10. Retour arrière et dépannage

- Afficher les logs : `adb logcat | Select-String -Pattern 'HomeDash|CameraX|AndroidRuntime'` sous PowerShell.
- WebView blanc : mettez Android System WebView/Chrome à jour si possible, puis testez l’URL dans Chrome.
- `NET::ERR_CERT_AUTHORITY_INVALID` : la CA Caddy n’est pas installée ou le nom demandé ne correspond pas au certificat.
- Caméra refusée : Réglages > Applications > HomeDash > Autorisations > Caméra.
- Service tué : retirez l’optimisation batterie et vérifiez la notification permanente.
- Association refusée : régénérez un code et vérifiez l’heure du Pi/tablette.
- Pour remplacer l’URL sans effacer l’application : cinq pressions Volume bas.
- Pour désinstaller un appareil Device Owner, prévoyez une réinitialisation usine. Ne lancez pas cette étape sans avoir sauvegardé ce qui doit l’être.
