# Sécurité

HomeDash est conçu pour un réseau local privé. N’exposez pas directement Nginx, Node.js, le port capteur ou SSH sur Internet.

## Signaler une vulnérabilité

N’ouvrez pas d’issue publique contenant une vulnérabilité exploitable, un token, une clé, une adresse domestique ou des données d’un système installé. Utilisez l’onglet **Security** du dépôt GitHub puis **Report a vulnerability** afin de créer un avis de sécurité privé. Si cette fonction n’est pas activée, demandez au mainteneur d’ouvrir un canal privé sans publier les détails techniques.

Indiquez la version, le composant concerné, l’impact, les étapes minimales de reproduction et une proposition de correction si vous en avez une. Remplacez toutes les valeurs sensibles par des exemples.

## Secrets à ne jamais publier

- `.env` et `/etc/homedash/homedash.env` ;
- keystore Android, mots de passe et valeur Base64 du keystore ;
- `root-ca.key`, clés SSH et sauvegardes ;
- tokens GitHub, Google OAuth, capteurs et tablettes ;
- base SQLite et journaux contenant des données domestiques.

Les certificats publics `.crt` peuvent être partagés avec les appareils du foyer, mais ils ne doivent pas être confondus avec leurs clés privées.
