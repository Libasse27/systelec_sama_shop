# SYSTELEC SAMA-SHOP

Plateforme e-commerce et de services techniques de **SYSTELEC** (Sénégal) : vente d'équipements informatiques, réseau, électroniques, électriques et de sécurité ; maintenance, réseaux, vidéosurveillance et électricité. Paiement **exclusivement hors ligne** (espèces), livraison à domicile et retrait en boutique.

> Statut : Phase 2 terminée (socle technique, voir [rapport](docs/rapports/phase-2.md)). Prochaine étape : Phase 3, authentification et permissions.

## Démarrage local

```bash
pnpm install
cp .env.example .env          # puis .env.test (voir commentaires)
pnpm db:up                    # PostgreSQL dev (5433) ; `docker compose up -d` pour la base de test (5434)
pnpm db:migrate
pnpm dev
```

Vérifications : `pnpm lint && pnpm typecheck && pnpm test && pnpm build && pnpm test:e2e`.

## Documentation

- [Diagnostic du dépôt](docs/00-diagnostic.md)
- [Architecture](docs/01-architecture.md)
- [Modèle de données](docs/02-modele-donnees.md)
- [Plan par phases et décisions à valider](docs/03-plan-et-decisions.md)

## Stack

Next.js (App Router) · React · TypeScript strict · Tailwind CSS · PostgreSQL · Prisma · Better Auth · Vitest · Playwright · pnpm · Docker Compose.
