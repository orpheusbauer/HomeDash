# Préparer un dépôt HomeDash public

Le dernier état du projet utilise des variables ou des exemples neutres pour le dépôt GitHub, le chemin Windows, l’utilisateur SSH, l’adresse du Pi et la localisation météo. Cela ne rend pas automatiquement l’**historique** d’un ancien dépôt privé publiable.

## 1. Vérifier l’état courant

Depuis la racine du projet :

```powershell
npm run audit:public
git status --short
git diff --cached --check
git ls-files | Select-String -Pattern '\.(env|key|pem|jks|keystore|db|sqlite|apk)$'
```

Pour rechercher vos propres anciens identifiants sans les enregistrer dans le projet :

```powershell
$env:HOMEDASH_PRIVATE_MARKERS = "VOTRE_LOGIN,VOTRE_EMAIL,VOTRE_ANCIENNE_IP"
npm run audit:public
Remove-Item Env:HOMEDASH_PRIVATE_MARKERS
```

Le script affiche uniquement le fichier et la catégorie du problème, jamais la valeur détectée. Il bloque aussi la CI si une clé privée, un token connu, un chemin de profil Windows, une IP privée littérale ou un fichier local sensible est ajouté au dernier état.

## 2. Vérifier GitHub

Avant de changer la visibilité :

1. activez **Settings > Security > Secret scanning** et **Push protection** si GitHub les propose ;
2. contrôlez **Settings > Secrets and variables > Actions** : ces secrets restent séparés du code et peuvent rester configurés ;
3. contrôlez les Issues, discussions, captures, artifacts et anciennes Releases ;
4. vérifiez qu’aucune archive de sauvegarde, APK privée, base ou certificat privé n’a été jointe manuellement ;
5. révoquez immédiatement tout secret qui aurait déjà été committé, même si le commit est ensuite supprimé.

## 3. Ne pas oublier l’historique Git

Un dépôt rendu public publie tous ses commits et tags. Les anciens commits HomeDash peuvent encore contenir un chemin de profil Windows, un nom d’utilisateur, une IP privée ou un ancien propriétaire GitHub. La suppression dans le dernier commit ne les retire pas de l’historique.

L’audit réalisé avant `0.3.0` confirme ce cas : plusieurs commits et tags existants contiennent ces anciens marqueurs personnels, et l’identité d’auteur Git utilise une adresse autre que `users.noreply.github.com`. Aucun motif de clé privée ou de token GitHub/Google n’a été détecté par la recherche ciblée, mais cela ne constitue pas une preuve cryptographique d’absence de secret. **Ne rendez donc pas le dépôt historique actuel public tel quel.**

Deux stratégies sont possibles :

- **recommandée : nouveau dépôt public avec un historique neuf** ;
- réécriture de tout l’historique avec `git filter-repo`, suivie d’un force-push coordonné et d’une recréation des tags.

La réécriture est destructive pour les clones et les tags. Elle ne doit pas être lancée sans décision explicite du propriétaire. Pour un premier passage en open source, exportez plutôt l’état audité dans un nouveau dossier, initialisez un nouveau dépôt et poussez-le vers un dépôt GitHub vide :

```powershell
$Source = "C:\chemin\vers\HomeDash"
$Export = "C:\chemin\vers\HomeDash-public"
$Archive = Join-Path $env:TEMP "homedash-public.zip"

Set-Location $Source
npm run audit:public
git archive --format=zip --output=$Archive HEAD
Expand-Archive -Path $Archive -DestinationPath $Export
Set-Location $Export
git init -b main
git add .
git commit -m "Initial public release"
git remote add origin https://github.com/VOTRE_COMPTE_GITHUB/HomeDash.git
git push -u origin main
```

Créez le dépôt GitHub cible vide avant le dernier bloc. Ne copiez pas le dossier `.git`, `node_modules`, `.env`, `data` ou un répertoire de sauvegarde dans l’export.

## 4. Choisir une licence

Un dépôt public sans `LICENSE` peut être lu, mais il ne donne pas clairement le droit de réutiliser ou modifier le code. Choisissez explicitement une licence avant d’annoncer le projet : MIT pour une réutilisation très permissive, Apache-2.0 pour une clause de brevet explicite, ou GPL-3.0 pour imposer le partage des versions dérivées distribuées. Cette décision appartient au propriétaire du projet et n’est pas automatisée.

## 5. Vérification finale

- CI verte, y compris `audit:public` ;
- aucune donnée réelle dans les exemples ;
- aucune ancienne Release ou pièce jointe sensible ;
- historique neuf ou historique ancien explicitement audité/réécrit ;
- `SECURITY.md` présent ;
- licence choisie ;
- keystore Android sauvegardé hors Git ;
- dépôt configuré dans `HOMEDASH_GITHUB_REPOSITORY` pour chaque installation.
