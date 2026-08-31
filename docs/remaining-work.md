# Travail restant après HomeDash 0.2.0

Le développement prévu pour la première installation murale est terminé. Le reste n’est plus une liste de fonctions indispensables à coder, mais une recette de validation sur le vrai Pi Zero, la qunyiCO Y10 et le réseau domestique.

La procédure active est [production-deployment.md](production-deployment.md).

## Obligatoire avant de déclarer l’installation terminée

1. créer le keystore Android et ses quatre secrets GitHub ;
2. obtenir une CI et une Release `v0.2.0` vertes ;
3. installer l’archive native sur le Pi Zero réel ;
4. confirmer `armv6l`, 32 bits et le fonctionnement de `node:sqlite` ;
5. remplacer une dernière fois l’ancienne APK debug par l’APK signée ;
6. vérifier ouverture, sortie Android, portrait et paysage ;
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
- lisibilité des cartes et onglets dans les deux orientations.

## Si la présence est instable

Dans cet ordre :

1. vérifier permission caméra et batterie sans restriction ;
2. dégager physiquement la caméra du support ;
3. réduire la fréquence d’analyse à 1–2 images/s ;
4. désactiver l’extinction automatique et garder l’écran très sombre si le verrouillage Android gêne ;
5. utiliser un capteur PIR/mmWave via ESP32.

## Améliorations facultatives après stabilisation

- tests Android instrumentés sur la vraie Y10 ;
- proxy local contrôlé pour télécharger l’APK depuis le Pi ;
- rotation des tokens tablette ;
- signature cryptographique de l’archive native en plus du SHA-256 ;
- migration de l’ESP32 vers HTTPS ;
- export/import JSON de la disposition ;
- calendrier journées entières ;
- plusieurs notes ;
- capteurs humidité, qualité de l’air et présence externe ;
- intégration Home Assistant optionnelle.

## Définition de terminé pour 0.2.0

- release native et APK signée disponibles ;
- aucun câble ADB nécessaire au quotidien ;
- Pi, Nginx et tablette redémarrent seuls ;
- bouton Accueil, Retour et bouton **Android** fonctionnels ;
- paysage et portrait validés ;
- notes, pages et dispositions persistantes ;
- météo, capteurs, système et réseau fonctionnels ;
- 48 heures sans crash ni chauffe anormale ;
- sauvegarde chiffrée copiée hors Pi ;
- mise à jour et rollback réellement testés.
