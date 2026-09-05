# Travail restant après HomeDash 0.4.8

Le développement prévu pour la première installation murale est terminé. Le reste n’est plus une liste de fonctions indispensables à coder, mais une recette de validation sur le vrai Pi Zero, la qunyiCO Y10 et le réseau domestique.

La procédure active est [production-deployment.md](production-deployment.md).

## Obligatoire avant de déclarer l’installation terminée

1. vérifier la présence du keystore et des quatre secrets GitHub existants, sans changer la signature ;
2. obtenir une CI et une Release `v0.4.8` vertes ;
3. installer l’archive native sur le Pi Zero réel ;
4. confirmer `armv6l`, 32 bits et le fonctionnement de `node:sqlite` ;
5. mettre à jour l’APK signée vers 0.4.8 (versionCode 15), sans désinstallation ;
6. vérifier ouverture, sortie Android par geste, portrait et paysage ;
7. laisser Pi et tablette fonctionner 48 heures ;
8. créer une sauvegarde et la copier hors du Pi ;
9. tester une mise à jour et un rollback réels ;
10. conserver le keystore sur deux supports chiffrés.

## Mesures matérielles à relever

### Raspberry Pi Zero

- temps de démarrage après coupure électrique ;
- mémoire Node au repos et lors d’une mise à jour ;
- CPU au repos ;
- erreurs OOM ;
- stabilité Wi-Fi ;
- espace libre microSD ;
- temps de `npm ci` pendant une release.

### Tablette

- température après 2 h, 24 h et 48 h ;
- comportement de la batterie en charge permanente ;
- ouverture automatique après reboot ;
- reconnexion après coupure Wi-Fi et redémarrage du Pi ;
- fiabilité de CameraX/ML Kit dans la lumière réelle de l’entrée ;
- si l’option est utilisée : extinction après 90 secondes, réveil et comportement du verrouillage Android ;
- lisibilité des cartes et onglets dans les deux orientations ;
- heure et date centrées sans chevauchement, crayon seul et absence de bloc « Votre espace » ;
- agenda compact avec couleurs conservées ; localisation/date météo sur la ligne du titre ;
- actualisation effective de la météo et de Google Calendar après une heure, y compris après un passage de la WebView en arrière-plan ;
- lune affichée pendant une heure nocturne dégagée et soleil affiché pendant une heure diurne dégagée ;
- mise à jour depuis l’ancienne APK sans écran blanc ni perte d’association, orientation ou brouillon ;
- récupération après redémarrage du Pi, puis après coupure Wi-Fi ;
- configuration avec le nom exact en `.local` et avec l’IP réservée.

## Si la présence est instable

Dans cet ordre :

1. vérifier permission caméra et batterie sans restriction ;
2. dégager physiquement la caméra du support ;
3. réduire la fréquence d’analyse à 1–2 images/s ;
4. désactiver l’extinction automatique et garder l’écran très sombre si le verrouillage Android gêne ;
5. utiliser un capteur PIR/mmWave via ESP32.

## Améliorations facultatives après stabilisation

- tests Android instrumentés sur la vraie Y10 ;
- rotation des tokens tablette ;
- signature cryptographique de l’archive native en plus du SHA-256 ;
- migration de l’ESP32 vers HTTPS ;
- export/import JSON de la disposition ;
- plusieurs notes ;
- capteurs humidité, qualité de l’air et présence externe ;
- intégration Home Assistant optionnelle.

## Définition de terminé pour 0.4.8

- release native et APK signée disponibles ;
- aucun câble ADB nécessaire au quotidien ;
- Pi, Nginx et tablette redémarrent seuls ;
- boutons système Accueil et Retour accessibles par geste ;
- récupération native accessible si l’interface ne démarre pas ;
- paysage et portrait validés ;
- notes, pages et dispositions persistantes ;
- météo, capteurs, système et réseau fonctionnels ;
- 48 heures sans crash ni chauffe anormale ;
- sauvegarde chiffrée copiée hors Pi ;
- mise à jour et rollback réellement testés.
