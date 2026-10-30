# FUTANI SHOP

Plateforme e-commerce de **FUTANI SHOP**, la boutique officielle de **FUTANI GROUP**, et des services techniques de **FUTANI TECH** (Sénégal) : vente d'équipements informatiques, réseau, électroniques, électriques et de sécurité ; maintenance, réseaux, vidéosurveillance et électricité. Paiement **exclusivement hors ligne** (espèces), livraison à domicile et retrait en boutique.

> Nom technique historique : le dépôt, les images Docker, les bases et les rôles PostgreSQL gardent le préfixe `systelec` (identifiants techniques, inchangés).

> Statut : Phase 9 terminée (administration avancée, voir [rapport](docs/rapports/phase-9.md)). Prochaine étape : Phase 10, stabilisation et mise en service.

## Démarrage local

```bash
pnpm install
cp .env.example .env          # puis .env.test (voir commentaires)
pnpm db:up                    # PostgreSQL dev (5433) ; `docker compose up -d` pour la base de test (5434)
pnpm db:migrate
pnpm db:seed                  # rôles, catalogue §6, services §7 (idempotent)
ALLOW_DEMO_SEED=1 pnpm db:seed:demo   # produits [DÉMO] (jamais en production)
pnpm admin:create             # premier administrateur principal (mot de passe saisi au clavier)
pnpm dev
```

Les images téléversées depuis l'administration (produits, logo, logos des partenaires) sont écrites dans `STORAGE_LOCAL_DIR` (`./storage` par défaut,
hors Git) : en production, ce dossier doit être un volume persistant et sauvegardé.

Le premier administrateur principal gère ensuite les comptes depuis **Administration → Utilisateurs** (rôles,
désactivation), les paramètres (mentions légales, TVA, règles de commande) depuis **Paramètres**, et consulte
le **Journal d'audit**. Les rapports financiers s'exportent en CSV, Excel (.xlsx) et PDF.

Les e-mails (réinitialisation de mot de passe, notifications des commandes, devis, interventions et retours)
partent par SMTP dès que `SMTP_HOST`, `SMTP_PORT` et `SMTP_FROM` sont renseignés (fournisseur de départ : Brevo ;
tout fournisseur SMTP convient). Sans fournisseur, rien n'est envoyé ni simulé, et un lien de réinitialisation
se génère avec `pnpm admin:reset-link <email>` (après vérification de l'identité du demandeur).

Les commandes non confirmées libèrent leur stock après le délai de réservation (48 h par défaut), les
retours sans action après 24 heures ouvrables déclenchent une alerte unique aux administrateurs, et les
vérifications de retour restées sans réponse sont relancées (12 et 24 heures ouvrables) puis escaladées
(48 heures ouvrables) ; les e-mails en échec sont renvoyés (15 min, 1 h, 4 h) : planifier `pnpm orders:expire`
(par exemple toutes les 15 minutes). Heures
ouvrables, jours fériés et délais de relance : **Administration → Paramètres**.

### Tests et validations

- Tests unitaires, sans PostgreSQL : `pnpm exec vitest run --project unit`.
- Tests d'intégration PostgreSQL : `pnpm test:integration:disposable`. Ce lanceur démarre un conteneur
  et une base jetables pour chaque exécution ; Docker doit être installé et accessible à l'utilisateur.
- `db-test` dans `docker-compose.yml` expose PostgreSQL sur le port 5434. Une commande n'utilise ce
  service que si son URL de base le vise explicitement. `pnpm test:integration:disposable` démarre son
  propre conteneur sur un port aléatoire et n'utilise pas `db-test`.
- `pnpm db:test:prepare` exécute `dotenv -e .env.test -- prisma migrate reset --force` : la commande
  réinitialise et efface les données de la base indiquée par `DATABASE_URL` dans `.env.test`. Elle ne
  garantit pas que cette URL vise `db-test` sur le port 5434. Avant de la lancer, vérifiez que l'URL
  désigne une base jetable dont le contenu peut être supprimé.
- Test de migration : `pnpm test:migration`. Il utilise également un conteneur PostgreSQL jetable et
  nécessite Docker.
- Contrôles statiques et build : `pnpm lint`, `pnpm typecheck`, puis `pnpm build`.
- `pnpm test` exécute les projets Vitest configurés, y compris les tests PostgreSQL jetables ; Docker
  est donc requis pour cette commande complète.

Les E2E sont distincts des tests Vitest. `pnpm test:e2e` cible la base persistante `systelec_e2e` et le
stockage `storage-e2e/`. L'adresse du serveur vient de `E2E_DATABASE_URL` ou de `.env.test` ; le nom de
base est fixé à `systelec_e2e`. Ce parcours n'est pas isolé par exécution. Ne lancez pas les E2E tant
que leur isolation par exécution n'a pas été mise en place et vérifiée. N'utilisez jamais la base de
développement (`.env`) ou une base partagée pour les tests PostgreSQL.

Les lanceurs PostgreSQL jetables nettoient leurs conteneurs, volumes secrets et répertoires temporaires
à la fin normale du run et après les erreurs interceptées. Une interruption brutale peut laisser des
ressources. Pour les récupérer, ne considérez que les conteneurs arrêtés et volumes portant l'étiquette
`systelec.migration-test.run`, puis vérifiez que leur nom et leur étiquette correspondent au même
identifiant de run avant de supprimer chaque ressource. Ne supprimez aucun conteneur actif ou ressource
sans cette vérification et n'utilisez pas `docker system prune`. Le contenu du secret n'est pas
nécessaire à ce nettoyage.

> Après une migration ou un `pnpm db:generate`, **redémarrez `pnpm dev`** : en développement, le client
> Prisma est conservé entre les rechargements à chaud et ne connaît pas encore les nouvelles tables
> (erreur du type `Cannot read properties of undefined (reading 'findMany')`).

## Documentation

- [Diagnostic du dépôt](docs/00-diagnostic.md)
- [Architecture](docs/01-architecture.md)
- [Modèle de données](docs/02-modele-donnees.md)
- [Plan par phases et décisions à valider](docs/03-plan-et-decisions.md)
- [Mise en service et exploitation](docs/04-mise-en-service.md) : image Docker, déploiement, sauvegarde et restauration, performance

## Stack

Next.js (App Router) · React · TypeScript strict · Tailwind CSS · PostgreSQL · Prisma · Better Auth · Vitest · Playwright · pnpm · Docker Compose.
