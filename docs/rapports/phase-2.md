# Rapport de phase 2 — Socle technique

**Branche :** `feat/phase-2-socle` · **Date :** 2026-10-13

## Livré

| Élément | Fichiers |
|---|---|
| Next.js 16 (App Router), TypeScript strict, Tailwind 4, jetons de marque | `next.config.ts`, `tsconfig.json`, `src/app/*`, `src/app/globals.css` |
| Base shadcn/ui (composants ajoutés à la demande en phase 4) | `components.json`, `src/lib/utils.ts` |
| PostgreSQL 17 via Docker Compose (dev : 5433, test : 5434 en tmpfs) | `docker-compose.yml` |
| Prisma 7 + migration initiale versionnée | `prisma/schema.prisma`, `prisma/migrations/20261013203908_init/` |
| Journal d'audit append-only (trigger PostgreSQL refusant UPDATE/DELETE), masquage des secrets | `src/server/audit/*`, migration initiale |
| Paramètres administrables validés par Zod, avec audit avant/après | `src/server/modules/settings/*` |
| Numérotation métier transactionnelle | `src/server/modules/sequences/service.ts` |
| Configuration validée au démarrage | `src/lib/env.ts`, `.env.example` |
| Montants en FCFA entiers, dates UTC affichées en Africa/Dakar | `src/lib/money.ts`, `src/lib/dates.ts` |
| Sonde de santé sans détail interne | `src/app/api/health/route.ts` |
| Tests : Vitest (unitaires + intégration PostgreSQL), Playwright (bureau + mobile) | `vitest.config.ts`, `playwright.config.ts`, `tests/`, `e2e/` |
| Garde-fou « aucun paiement électronique » | `tests/policy/no-electronic-payment.test.ts` |
| CI GitHub Actions : lint, typecheck, tests, build, E2E | `.github/workflows/ci.yml` |

## Tests réellement exécutés

| Commande | Résultat |
|---|---|
| `pnpm lint` | OK |
| `pnpm typecheck` | OK |
| `pnpm test` | 10 fichiers, 29 tests réussis (dont intégration PostgreSQL) |
| `pnpm build` | OK |
| `pnpm test:e2e` | 6 tests réussis (3 × bureau, 3 × mobile) |

Critère §20 n° 28 (build) : satisfait.

## Corrections apportées en fin de phase

- **Lockfile incohérent** : `package.json` épinglait `lucide-react@1.55.0`, mais le lockfile contenait 1.56.0, publiée depuis moins de 24 h et donc rejetée par la politique `minimumReleaseAge`. Le lockfile a été régénéré.
- **Erreur de typage** dans `updateSetting` (`z.flattenError` sur une union de schémas) : corrigée.
- **Migration initiale absente** : créée, avec le trigger append-only du journal d'audit.
- **Setup des tests d'intégration** : `prisma migrate reset --force` (destructif) a été remplacé par `prisma migrate deploy`. Les tables restent vidées entre les tests par `TRUNCATE`. Pour repartir d'une base vierge : `pnpm db:test:prepare`.

## Revue de code (agent code-reviewer)

Verdict : approuvé, aucun point CRITICAL ni HIGH. Les points corrigés ont chacun un test écrit avant le correctif :

- **M1** : un paramètre stocké invalide lève désormais une `AppError("INTERNAL")`. L'admin peut toujours l'écraser, et la valeur brute est auditée en « avant ». Les mises à jour d'une même clé sont sérialisées par `pg_advisory_xact_lock`.
- **M3** : en-têtes `Content-Security-Policy` de base et `Strict-Transport-Security` ajoutés. Les URL du logo et des réseaux sociaux sont limitées à http(s), ce qui bloque `javascript:` et `data:`.
- **M4** : `DATABASE_URL` doit être une URL PostgreSQL. En production, `APP_URL` est obligatoire, en https et sans slash final.
- **L2** : `roundFcfa` ne renvoie plus `-0`.

Reportés :

- **M2**, audit contournable par `TRUNCATE` ou `DROP TRIGGER` : à traiter en phase 10, avec un rôle de migration propriétaire distinct d'un rôle applicatif limité à `INSERT`/`SELECT` sur `audit_logs`.
- **L1**, liste de masquage de l'audit à affiner : en phase 3, avec les données d'authentification.
- **L3** et **L5** à **L7** : mineurs, notés pour les phases concernées.
- **L4**, double build en CI : accepté pour l'instant.

## Points ouverts

- En production, le rôle PostgreSQL applicatif ne doit pas disposer du privilège `TRUNCATE` sur `audit_logs`, ni être propriétaire des tables (M2, phase 10).
- La CSP sera complétée par `script-src` avec nonces en phase 3.
- Décisions D1 à D14 (`docs/03-plan-et-decisions.md`) : les recommandations sont appliquées par défaut tant qu'aucune autre décision n'est donnée.

## Phase suivante

Phase 3 — Authentification et permissions : inscription, connexion, réinitialisation, 10 rôles, garde serveur, commande CLI de création du premier super-admin, audit des connexions.
