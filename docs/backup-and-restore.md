# Sauvegarde et restauration — installation native Pi Zero

Le code peut être retéléchargé depuis GitHub. Les éléments irremplaçables sont la base SQLite, la configuration secrète, le token GitHub du Pi et la clé privée de l’autorité locale.

## Fichiers à protéger

```text
/var/lib/homedash/data/
/var/lib/homedash/tls/
/etc/homedash/tls/
/etc/homedash/homedash.env
/etc/homedash/github-token
```

`/var/lib/homedash/tls/root-ca.key` permet de signer des certificats reconnus par la tablette : traitez-la comme un secret. L’archive contient aussi le PIN administrateur et les tokens capteurs, Google et GitHub.

Le clone `/opt/homedash/repository` et les releases sous `/opt/homedash/releases` sont reproductibles et ne sont pas indispensables dans la sauvegarde de données.

## Sauvegarde cohérente manuelle

Arrêtez brièvement HomeDash pour fermer SQLite et consolider WAL :

```bash
sudo systemctl stop homedash
sudo tar -C / -czf "/tmp/homedash-backup-$(date -u +%Y%m%dT%H%M%SZ).tar.gz" \
  var/lib/homedash/data \
  var/lib/homedash/tls \
  etc/homedash/tls \
  etc/homedash/homedash.env \
  etc/homedash/github-token
sudo systemctl start homedash
curl --fail http://127.0.0.1:4100/health/ready
```

Repérez le nom créé :

```bash
sudo ls -lh /tmp/homedash-backup-*.tar.gz
```

Pour permettre à votre utilisateur de le récupérer :

```bash
BACKUP_FILE="$(sudo ls -1t /tmp/homedash-backup-*.tar.gz | head -n 1)"
sudo chown "$USER:$USER" "$BACKUP_FILE"
chmod 0600 "$BACKUP_FILE"
echo "$BACKUP_FILE"
```

Depuis le PC :

```powershell
scp votre-utilisateur@192.168.1.124:/tmp/homedash-backup-AAAAmmjjTHHMMSSZ.tar.gz .
```

Ouvrez l’archive sur le PC pour vérifier qu’elle n’est pas corrompue, puis supprimez la copie temporaire du Pi :

```bash
rm /tmp/homedash-backup-AAAAmmjjTHHMMSSZ.tar.gz
```

Conservez au moins deux copies chiffrées sur des supports différents. Ne placez jamais l’archive dans GitHub.

## Sauvegardes automatiques avant mise à jour

`homedash-update-native` arrête le service et crée automatiquement :

```text
/var/lib/homedash/data/backups/pre-X.Y.Z-AAAAmmjjTHHMMSSZ.tar.gz
```

Ces archives ne contiennent que les données applicatives. Elles ne remplacent pas une sauvegarde externe incluant `/etc/homedash` et `/var/lib/homedash/tls`.

Liste et espace utilisé :

```bash
sudo ls -lh /var/lib/homedash/data/backups
sudo du -sh /var/lib/homedash/data/backups
df -h /
```

## Restaurer uniquement SQLite après une mise à jour ratée

Choisissez l’archive immédiatement antérieure à la version problématique :

```bash
sudo systemctl stop homedash
sudo cp -a /var/lib/homedash/data/homedash.db "/tmp/homedash.db.before-restore" 2>/dev/null || true
sudo rm -f /var/lib/homedash/data/homedash.db \
  /var/lib/homedash/data/homedash.db-shm \
  /var/lib/homedash/data/homedash.db-wal
sudo tar -xzf /var/lib/homedash/data/backups/pre-0.2.0-AAAAmmjjTHHMMSSZ.tar.gz \
  -C /var/lib/homedash/data
sudo chown -R homedash:homedash /var/lib/homedash/data
sudo systemctl start homedash
curl --fail http://127.0.0.1:4100/health/ready
```

Ne restaurez pas une base ancienne sous un code exigeant une migration plus récente sans avoir aussi choisi la release correspondante.

## Revenir au code précédent

```bash
sudo systemctl stop homedash
sudo ln -sfn /opt/homedash/releases/0.1.1 /opt/homedash/current
sudo systemctl start homedash
readlink -f /opt/homedash/current
curl --fail http://127.0.0.1:4100/health/ready
```

Si le schéma a changé, restaurez ensuite la sauvegarde SQLite correspondante comme ci-dessus.

## Restaurer tout HomeDash sur une nouvelle carte microSD

1. Installez Raspberry Pi OS Lite 32 bits et réservez la même IP.
2. Suivez les étapes d’accès Git et clone du [guide d’installation](installation-raspberry-pi.md).
3. Installez la même release que celle indiquée par votre sauvegarde.
4. Copiez l’archive de sauvegarde sur le Pi, par exemple `/tmp/restore.tar.gz`.
5. Arrêtez les services :

```bash
sudo systemctl stop homedash nginx
```

6. Conservez les fichiers fraîchement générés en secours :

```bash
sudo tar -C / -czf /tmp/fresh-install-secrets.tar.gz \
  var/lib/homedash/data var/lib/homedash/tls etc/homedash
```

7. Inspectez l’archive avant extraction :

```bash
tar -tzf /tmp/restore.tar.gz
```

Les chemins doivent commencer uniquement par `var/lib/homedash/` ou `etc/homedash/`. Aucun chemin ne doit commencer par `/` ni contenir `..`.

8. Extrayez et rétablissez les permissions :

```bash
sudo tar -C / -xzf /tmp/restore.tar.gz
sudo chown -R homedash:homedash /var/lib/homedash/data
sudo chown root:homedash /etc/homedash/homedash.env /etc/homedash/github-token
sudo chmod 0640 /etc/homedash/homedash.env /etc/homedash/github-token
sudo chown root:www-data /etc/homedash/tls/homedash.key /etc/homedash/tls/homedash.crt
sudo chmod 0640 /etc/homedash/tls/homedash.key
```

9. Testez puis redémarrez :

```bash
sudo nginx -t
sudo systemctl start nginx homedash
curl --fail http://127.0.0.1:4100/health/ready
curl --fail --cacert /var/lib/homedash/tls/root-ca.crt https://192.168.1.124/health/ready
```

10. Vérifiez les notes, appareils, tokens capteurs et Google Calendar.

Si la même CA et le même nom/IP ont été restaurés, la tablette conserve sa confiance HTTPS. Si la base restaurée contient aussi les appareils, leur association peut rester valable ; sinon réassociez-les.

## Après perte ou vol d’une sauvegarde

Considérez comme compromis :

- le code PIN administrateur ;
- le token d’ingestion capteur ;
- le token GitHub ;
- les identifiants Google OAuth ;
- la clé de l’autorité locale.

Révoquez/renouvelez ces éléments. Pour remplacer la CA, régénérez-la, recréez le certificat Nginx et installez la nouvelle racine sur chaque appareil.
