# SYSTELEC SAMA-SHOP

Plateforme e-commerce et de services techniques de **SYSTELEC** (Sénégal) : vente d'équipements informatiques, réseau, électroniques, électriques et de sécurité ; maintenance, réseaux, vidéosurveillance et électricité. Paiement **exclusivement hors ligne** (espèces), livraison à domicile et retrait en boutique.

> Statut : Phase 4 terminée (boutique publique, voir [rapport](docs/rapports/phase-4.md)). Prochaine étape : Phase 5, produits et stocks.

## Démarrage local

```bash
pnpm install
cp .env.example .env          # puis .env.test (voir commentaires)
pnpm db:up                    # PostgreSQL dev (5433) ; `docker compose up -d` pour la base de test (5434)
pnpm db:migrate
pnpm db:seed                  # rôles, catalogue §6, services §7 (idempotent)
pnpm db:seed:demo             # produits [DÉMO] (jamais en production)
pnpm admin:create             # premier administrateur principal (mot de passe saisi au clavier)
pnpm dev
```

Sans fournisseur e-mail configuré, un lien de réinitialisation de mot de passe se génère avec
`pnpm admin:reset-link <email>` (après vérification de l'identité du demandeur).

Vérifications : `pnpm lint && pnpm typecheck && pnpm test && pnpm build && pnpm test:e2e`.

## Documentation

- [Diagnostic du dépôt](docs/00-diagnostic.md)
- [Architecture](docs/01-architecture.md)
- [Modèle de données](docs/02-modele-donnees.md)
- [Plan par phases et décisions à valider](docs/03-plan-et-decisions.md)

## Stack

Next.js (App Router) · React · TypeScript strict · Tailwind CSS · PostgreSQL · Prisma · Better Auth · Vitest · Playwright · pnpm · Docker Compose.
