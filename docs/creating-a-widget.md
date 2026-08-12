# Créer un widget

Ce guide décrit la convention de `0.1.x`. Un widget est compilé avec HomeDash : il n’exécute pas de code tiers téléchargé à chaud. Cette contrainte rend le catalogue prévisible et sûr tout en gardant l’ajout d’une fonctionnalité localisé.

Exemple : créer `finance.bitcoin`, qui affiche un prix provenant d’une API publique.

## 1. Décider où vit la donnée

- Donnée purement locale au navigateur, comme l’heure : composant frontend seulement.
- Secret, API externe, cache partagé ou accès système : service + route backend.
- Donnée persistante métier : migration et repository backend, jamais `localStorage` comme source de vérité.
- Flux local fréquent : ingestion REST puis notification WebSocket. N’ajoutez MQTT que si la source l’exige vraiment.

Le prix Bitcoin doit passer par le backend pour centraliser cache, timeout et limite d’appels, même si l’API n’utilise pas de clé.

## 2. Ajouter les contrats

Dans `packages/contracts/src/index.ts`, créez un schéma Zod et exportez son type :

```ts
export const bitcoinPriceSchema = z.object({
  eur: z.number().positive(),
  fetchedAt: z.string().datetime(),
  stale: z.boolean(),
});
export type BitcoinPrice = z.infer<typeof bitcoinPriceSchema>;
```

Ajoutez un test dans `packages/contracts/src/index.test.ts`. Les contrats sont la frontière commune API/React ; ne dupliquez pas manuellement une interface incompatible.

## 3. Créer le service backend

Ajoutez `apps/server/src/services/bitcoin.ts` avec ces règles :

1. `fetch` et `AbortSignal.timeout(8000)` ;
2. validation stricte de la réponse distante avec Zod ;
3. clé cache stable, par exemple `bitcoin:eur` ;
4. TTL raisonnable, par exemple 5 minutes ;
5. si l’appel échoue, retourner le cache expiré avec `stale: true` ;
6. sans cache, lever `AppError(503, 'BITCOIN_UNAVAILABLE', ...)` ;
7. ne jamais loguer de clé/token.

Réutilisez `getCache` et `setCache` de `repositories/dashboard.ts`. Une API tierce change souvent : validez sa réponse avant de la transformer en contrat HomeDash.

Dans `routes/api.ts` :

```ts
app.get('/api/v1/bitcoin/price', async () => getBitcoinPrice());
```

Une lecture non sensible peut rester LAN-only. Une commande, dépense, changement de configuration ou accès privé doit utiliser `preHandler: requireAdmin`.

## 4. Déclarer le manifeste

Dans `apps/server/src/widget-catalog.ts` :

```ts
{
  id: 'finance.bitcoin',
  name: 'Bitcoin',
  description: 'Prix BTC en euros',
  category: 'Finance',
  icon: 'BadgeEuro',
  version: '1.0.0',
  size: {
    default: { w: 3, h: 3 },
    min: { w: 2, h: 2 },
    max: { w: 8, h: 6 },
  },
  configSchema: {
    type: 'object',
    properties: { currency: { type: 'string', enum: ['EUR', 'USD'] } },
  },
  capabilities: ['network'],
  refreshSeconds: 300,
  configSchemaVersion: 1,
}
```

Principes de taille sur la grille 12 colonnes :

- largeur 2–3 : valeur principale uniquement ;
- largeur 4–6 : valeur, variation, mise à jour ;
- largeur 7+ : historique éventuel ;
- hauteur minimale suffisante pour une cible tactile de 44 px et les états erreur/chargement.

Le manifeste est une déclaration, pas un endroit où exécuter du code.

## 5. Créer le composant React

Ajoutez `apps/web/src/widgets/BitcoinWidget.tsx` :

```tsx
export function BitcoinWidget({ instance }: WidgetComponentProps) {
  const query = useQuery({
    queryKey: ['bitcoin', instance.config.currency],
    queryFn: () => api<BitcoinPrice>('/api/v1/bitcoin/price'),
    refetchInterval: 300_000,
  });

  if (!query.data) {
    return (
      <div className="widget-centered">
        <StatusBadge status={query.isError ? 'error' : 'loading'} />
      </div>
    );
  }
  return <div>{/* valeur + StatusBadge stale/ready */}</div>;
}
```

Le composant doit rendre cinq états : loading, ready, stale, error, offline. S’il existe une dernière valeur, préférez `stale` à un grand écran d’erreur. `WidgetErrorBoundary` empêche déjà une exception d’abattre le dashboard entier.

N’importez pas une bibliothèque graphique lourde pour une seule ligne. Respectez `prefers-reduced-motion`, les variables CSS existantes, le contraste et le tactile.

## 6. Enregistrer le composant

Dans `WidgetRenderer.tsx` :

```ts
import { BitcoinWidget } from './BitcoinWidget';

const registry = {
  // ...
  'finance.bitcoin': BitcoinWidget,
};
```

Dans `WidgetCatalog.tsx`, ajoutez l’icône Lucide à la petite table d’icônes autorisées. Évitez `import * as Icons`, qui a déjà multiplié le poids du bundle.

## 7. Ajouter les paramètres

Pour un petit nombre de widgets, ajoutez les champs conditionnels dans `WidgetSettings.tsx` et gardez la configuration JSON compacte. Validez aussi la configuration côté serveur avant une dépendance critique. À mesure que le catalogue grandit, la prochaine refactorisation prévue est un `WidgetDefinition` frontend regroupant composant et formulaire de configuration.

Ne stockez jamais de clé API dans `instance.config` : elle serait lisible par tous les clients via bootstrap. Placez-la dans `/etc/homedash/homedash.env`.

## 8. Ajouter stockage/migration si nécessaire

Ajoutez une entrée numérotée dans `db/migrations.ts`; ne modifiez pas une migration déjà publiée. Exemple `version: 2`. Une migration doit être rejouable une seule fois, fonctionner sur une copie de production et être compatible avec le rollback ou documenter pourquoi elle ne l’est pas.

Pour une configuration simple globale, la table `settings` suffit. Pour un historique volumineux, créez une table dédiée avec index et rétention ; n’entassez pas des séries temporelles illimitées dans JSON.

## 9. Tester

Minimum attendu :

- parsing du contrat ;
- service avec réponse distante valide, timeout et cache stale ;
- route 200/503 et authentification si nécessaire ;
- rendu loading/ready/stale/error ;
- ajout au catalogue ;
- petit/grand widget, mode normal/édition, tactile ;
- build legacy Android.

Puis exécutez :

```powershell
npm run format
npm run lint
npm run typecheck
npm test
npm run build
```

Test manuel : ajouter le widget, configurer, redimensionner, recharger, couper Internet, vérifier le cache et supprimer. Une erreur du nouveau widget ne doit affecter aucun autre.

## 10. Checklist à donner à Codex

Pour une future demande « Ajoute un widget X », joignez ce fichier et précisez : source de données, informations à afficher, paramètres, tailles, fréquence, besoin de secret, comportement hors ligne et priorité mobile/tablette. Demandez explicitement contrats, backend/cache, manifeste, frontend, configuration, tests et documentation.
