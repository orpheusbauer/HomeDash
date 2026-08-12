# Sauvegarde et restauration

Les données et la version active (`release.env`) sont sous `/var/lib/homedash/data`. La configuration secrète est `/etc/homedash/homedash.env`.

## Sauvegarde manuelle depuis HomeDash

Paramètres > Sauvegardes > **Créer une sauvegarde** exécute `VACUUM INTO`, donc produit une base SQLite cohérente même lorsque l’application tourne. Les fichiers sont dans `/var/lib/homedash/data/backups`.

## Sauvegarde complète vers un autre ordinateur

Sur le Pi :

```bash
sudo systemctl stop homedash
sudo tar -C / -czf /tmp/homedash-backup-$(date +%Y%m%d-%H%M%S).tar.gz \
  var/lib/homedash/data \
  etc/homedash/homedash.env \
  etc/homedash/updater-token
sudo systemctl start homedash
sudo chown votre-utilisateur:votre-utilisateur /tmp/homedash-backup-*.tar.gz
```

Copiez l’archive avec `scp`, vérifiez qu’elle s’ouvre, puis supprimez la copie `/tmp`. Stockez-la chiffrée : elle contient des tokens Google, administrateur, capteurs et updater. Ne l’envoyez pas dans GitHub.

Au minimum, programmez une copie hebdomadaire vers un NAS ou le PC. Une future tâche systemd pourra automatiser la rétention ; `0.1.0` évite de supprimer automatiquement des sauvegardes sans politique décidée.

## Vérifier une base

Sur une copie, jamais sur l’unique original :

```bash
sqlite3 copie-homedash.db 'PRAGMA integrity_check;'
```

La réponse doit être `ok`.

## Restaurer une base sur le même Pi

1. Choisissez le fichier exact et notez sa date.
2. Arrêtez HomeDash.
3. Conservez la base actuelle sous un autre nom.
4. Copiez la sauvegarde.
5. Corrigez propriétaire et permissions.
6. Redémarrez et testez.

```bash
sudo systemctl stop homedash
sudo cp /var/lib/homedash/data/homedash.db /var/lib/homedash/data/homedash.db.before-restore
sudo cp /var/lib/homedash/data/backups/homedash-DATE.db /var/lib/homedash/data/homedash.db
sudo chown homedash-updater:homedash /var/lib/homedash/data/homedash.db
sudo chmod 0660 /var/lib/homedash/data/homedash.db
sudo systemctl start homedash
curl -fsS http://127.0.0.1:4100/health/ready
```

Les fichiers `-wal` et `-shm` ne doivent pas être recopiés depuis une sauvegarde incohérente. Avec le service arrêté, supprimez uniquement ceux qui correspondent à la base remplacée si SQLite les a laissés ; conservez-les d’abord dans un dossier de secours si vous avez un doute.

## Restaurer sur un Raspberry Pi neuf

1. réinstallez OS, Docker, Node et le même tag HomeDash ;
2. ne démarrez pas encore le stack ;
3. restaurez `/etc/homedash` avec mode 0600/0640 ;
4. restaurez `/var/lib/homedash/data` ;
5. restaurez `release.env` ou choisissez le tag connu ;
6. relancez `install-services.sh` ;
7. démarrez les services et vérifiez la santé ;
8. si l’autorité Caddy a changé, réinstallez sa nouvelle CA sur la tablette ;
9. les tablettes gardent leur token si la base restaurée le contient, sinon réassociez-les.
