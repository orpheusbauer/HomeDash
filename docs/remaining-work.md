# Travail restant après le socle 0.1.0

Le dépôt contient un MVP très avancé, mais les points dépendant du matériel et des comptes externes ne peuvent pas être déclarés terminés sans votre Raspberry Pi, la qunyiCO Y10 et votre compte Google.

## Priorité 1 — faire passer la CI et installer le matériel

1. Poussez `main` sans tag et corrigez toute différence du runner Linux.
2. Téléchargez l’APK CI et testez le mode simple sur la Y10.
3. Créez `v0.1.0`, rendez l’image GHCR lisible par le Pi et installez le stack.
4. Exécutez toute la checklist Pi puis tablette.
5. Laissez fonctionner 7 jours avant Device Owner définitif.

Critères : aucun crash, reconnexion après coupures, layout persistant, base sauvegardée, consommation acceptable.

## Priorité 2 — stabiliser Android sur la Y10

À mesurer et adapter : fréquence CameraX/ML Kit, distance et faible lumière, permission caméra après boot, comportement exact de `lockNow`, réveil par wake lock, politique batterie constructeur, température en charge permanente. Android ne garantit pas qu’une caméra puisse réveiller indéfiniment un appareil profondément endormi sur toutes les ROM.

Si le service est instable :

1. garder l’écran très sombre plutôt que réellement verrouillé ;
2. réduire l’analyse à 1–2 images/s ;
3. ajouter un PIR mmWave/ESP32 local, plus fiable et moins énergivore ;
4. utiliser la caméra uniquement lorsque l’écran est déjà actif.

Ajoutez des tests instrumentés Android, une page diagnostic (permission, dernière frame, dernière présence, raison du wake) et une préférence pour désactiver/ajuster le timeout.

## Priorité 3 — sécurité de release

- Créer un keystore Android release hors Git et configurer les secrets Actions.
- Remplacer l’APK debug attachée aux releases par une APK release signée.
- Signer `homedash-release.json`/image avec cosign et vérifier la signature dans l’agent.
- Ajouter une rotation périodique des tokens tablette.
- Ajouter une temporisation/échec progressif sur le token administrateur au-delà du rate limit général.
- Décider d’un modèle LAN : VLAN IoT, pare-feu `DOCKER-USER`, accès SSH par clé uniquement.

## Priorité 4 — qualité et tests manquants

- Étendre les tests `app.inject()` au CRUD widgets/Calendar avec Google mocké, aux migrations depuis chaque version et à l’updater avec faux binaire Docker.
- Ajouter Playwright aux workflows pour mode édition, page, note et persistance.
- Tester l’image multiarch sur un vrai Pi arm64.
- Ajouter une stratégie `stale/offline` temporelle aux capteurs.
- Ajouter rétention configurable des backups et test automatique de restauration.

## Priorité 5 — ergonomie produit

- Formulaire Calendar journées entières, choix du calendrier et couleurs.
- Page Paramètres dédiée plutôt qu’une longue modale ; suppression appareils, statut/progression updater en direct.
- Export/import JSON de la disposition.
- Plusieurs notes créables depuis l’UI.
- Meilleure mise en cache service worker des réponses locales et écran offline dédié dans l’APK.
- Accessibilité : test lecteur d’écran, contraste, focus et tailles sur la vraie dalle.

## Priorité 6 — extensions

Quand le MVP matériel est stable : humidité et qualité de l’air, MQTT/Mosquitto si le nombre de capteurs le justifie, historique court avec agrégation, Todo/courses, transports, Home Assistant optionnel. Chaque ajout doit suivre [creating-a-widget.md](creating-a-widget.md).

## Définition de terminé pour 0.1.0

- CI web/server et Android verte ;
- release et image arm64 disponibles ;
- Pi redémarre sans intervention ;
- tablette redémarre en kiosque et se reconnecte ;
- notes/layout/pages persistent ;
- météo/cache, capteurs mock/HTTP, système/réseau fonctionnent ;
- Calendar CRUD validé avec votre compte ;
- présence validée ou limite documentée avec alternative choisie ;
- backup copié hors Pi et restauration testée ;
- mise à jour vers une `0.1.1` de test puis rollback défectueux validés.
