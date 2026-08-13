# Travail restant après l’adaptation Raspberry Pi Zero

Le logiciel et le déploiement natif sont prêts à être testés. Les points suivants dépendent encore du vrai Pi Zero, de la tablette qunyiCO Y10 et des comptes externes.

## Priorité 1 — valider la chaîne ARMv6 réelle

1. Pousser les changements ARMv6 sur `main`.
2. Attendre la CI verte, y compris le smoke test de l’archive native.
3. Créer le tag `v0.1.1` et vérifier les trois assets de release.
4. Installer Raspberry Pi OS Lite 32 bits et confirmer `armv6l`/`32`.
5. Cloner avec une Deploy key en lecture seule.
6. Installer la release native selon [installation-raspberry-pi.md](installation-raspberry-pi.md).
7. Confirmer sur le matériel que Node ARMv6 et `node:sqlite` démarrent sans `Illegal instruction`.
8. Laisser le Pi fonctionner sept jours.

Mesures à relever : temps de démarrage, RSS Node, CPU au repos, température, espace microSD, erreurs OOM, temps d’une mise à jour et stabilité Wi-Fi.

Critères : aucun crash, health check stable, reconnexion après coupure réseau, layout persistant, sauvegarde hors Pi et consommation mémoire acceptable.

## Priorité 2 — tester une vraie mise à jour et son rollback

- Publier une `v0.1.1` de test.
- L’installer avec `sudo homedash-update-native v0.1.1`.
- Vérifier la sauvegarde `pre-0.1.1-*` et le lien `current`.
- Publier volontairement une release de test qui échoue au health check sur une branche/tag dédié.
- Confirmer le retour automatique au code et à la base précédents.
- Tester une restauration complète sur une seconde carte microSD si possible.

## Priorité 3 — stabiliser Android sur la Y10

À mesurer et adapter : fréquence CameraX/ML Kit, distance, faible lumière, permission caméra après boot, comportement de `lockNow`, réveil, politique batterie de la ROM et température en charge permanente.

Si la présence est instable :

1. garder l’écran très sombre au lieu de le verrouiller ;
2. réduire l’analyse à 1–2 images/s ;
3. ajouter un capteur PIR/mmWave via ESP32 ;
4. utiliser la caméra seulement lorsque l’écran est actif.

Ajouter ensuite des tests Android instrumentés et une page diagnostic dédiée.

## Priorité 4 — sécurité de release

- Créer un keystore Android hors Git et produire une APK release signée.
- Ajouter une attestation/signature de l’archive native en plus du SHA-256.
- Tester la rotation et l’expiration du PAT GitHub en lecture seule.
- Ajouter une rotation des tokens tablette.
- Limiter le port ESP32 HTTP à un VLAN IoT ou passer l’exemple à HTTPS.
- Conserver SSH par clé uniquement et n’ouvrir aucun port Internet.
- Étudier un agent natif minimal avant d’autoriser une mise à jour depuis l’interface.

## Priorité 5 — qualité et performances Zero

- Ajouter des tests API sur le CRUD widgets/Calendar avec Google mocké.
- Tester les migrations depuis chaque version de base publiée.
- Ajouter Playwright au workflow pour édition, notes et persistance.
- Ajouter une politique `stale/offline` temporelle aux capteurs.
- Ajouter une rétention configurable des sauvegardes, sans supprimer la dernière copie saine.
- Mesurer le coût des widgets météo/réseau/système sur un cœur ARMv6.
- Si RSS ou latence dépassent les limites, profiler avant de retirer des fonctions.

## Priorité 6 — ergonomie et extensions

- Formulaire Calendar journées entières et choix de calendrier.
- Page Paramètres dédiée.
- Export/import JSON de la disposition.
- Plusieurs notes créables.
- Écran hors ligne dédié dans l’APK.
- Tests accessibilité sur la vraie dalle.
- Après stabilisation : humidité, qualité de l’air, historique court, Todo/courses et Home Assistant optionnel.

## Définition de terminé pour 0.1.1 sur Zero

- CI web/server, archive native et Android vertes ;
- release native et SHA-256 disponibles ;
- Node 22 ARMv6 vérifié sur le Pi ;
- Pi et Nginx redémarrent seuls ;
- tablette redémarre en kiosque et se reconnecte en HTTPS ;
- notes/layout/pages persistent ;
- météo/cache, capteurs, système et réseau fonctionnent ;
- présence validée ou alternative matérielle choisie ;
- backup complet copié hors Pi ;
- mise à jour et rollback réellement testés.
