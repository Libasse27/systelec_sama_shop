# SYSTELEC SAMA-SHOP

Plateforme e-commerce et de services techniques de **SYSTELEC** (Sénégal) : vente d'équipements informatiques, réseau, électroniques, électriques et de sécurité ; maintenance, réseaux, vidéosurveillance et électricité. Paiement **exclusivement hors ligne** (espèces), livraison à domicile et retrait en boutique.

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

Sans fournisseur e-mail configuré, un lien de réinitialisation de mot de passe se génère avec
`pnpm admin:reset-link <email>` (après vérification de l'identité du demandeur).

Les commandes non confirmées libèrent leur stock après le délai de réservation (48 h par défaut), les
retours sans action après 24 heures ouvrables déclenchent une alerte unique aux administrateurs, et les
vérifications de retour restées sans réponse sont relancées (12 et 24 heures ouvrables) puis escaladées
(48 heures ouvrables) : planifier `pnpm orders:expire` (par exemple toutes les 15 minutes). Heures
ouvrables, jours fériés et délais de relance : **Administration → Paramètres**.

Vérifications : `pnpm lint && pnpm typecheck && pnpm test && pnpm build && pnpm test:e2e`.

Les tests d'intégration et E2E utilisent le PostgreSQL de test (`docker compose up -d db-test`, port 5434) :
`systelec_test` pour l'intégration, `systelec_e2e` (créée au besoin) pour les E2E. Les E2E vérifient
l'identité de leur base avant toute écriture et s'arrêtent en cas de doute ; ils ne touchent jamais la base
de développement (`.env`) et téléversent dans `storage-e2e/`.

> Après une migration ou un `pnpm db:generate`, **redémarrez `pnpm dev`** : en développement, le client
> Prisma est conservé entre les rechargements à chaud et ne connaît pas encore les nouvelles tables
> (erreur du type `Cannot read properties of undefined (reading 'findMany')`).

## Documentation

- [Diagnostic du dépôt](docs/00-diagnostic.md)
- [Architecture](docs/01-architecture.md)
- [Modèle de données](docs/02-modele-donnees.md)
- [Plan par phases et décisions à valider](docs/03-plan-et-decisions.md)

## Stack

Next.js (App Router) · React · TypeScript strict · Tailwind CSS · PostgreSQL · Prisma · Better Auth · Vitest · Playwright · pnpm · Docker Compose.
