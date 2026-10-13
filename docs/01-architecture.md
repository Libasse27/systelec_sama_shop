# Architecture proposée

## 1. Principe : monolithe modulaire Next.js

Une seule application Next.js (App Router) contenant la boutique publique, l'espace client, le back-office `/admin` et les API (Route Handlers + Server Actions). Les règles métier vivent **côté serveur** dans des modules par domaine, jamais dans les composants navigateur.

Un backend séparé n'est pas justifié aujourd'hui ; la séparation en modules permet de l'extraire plus tard si nécessaire.

```
Navigateur ──► Next.js (RSC / Server Actions / Route Handlers)
                 │
                 ├── auth        (session, identité)
                 ├── authz       (permissions, policies)
                 ├── modules/*   (services métier + validation Zod)
                 │      └── repositories (Prisma)
                 ├── audit       (journal append-only)
                 ├── notifications (adaptateurs e-mail/SMS, désactivés par défaut)
                 └── storage     (adaptateur fichiers : disque local / S3-compatible)
                 │
                 ▼
            PostgreSQL (Prisma, migrations versionnées)
```

## 2. Stack retenue (décisions techniques réversibles)

| Besoin | Choix | Raison |
|---|---|---|
| Framework | Next.js (App Router), React, TypeScript `strict` | Imposé |
| Styles / UI | Tailwind CSS + composants shadcn/ui (Radix) | Accessibles, clavier, code possédé par le projet |
| Base | PostgreSQL 17 (Docker) | Imposé |
| ORM | Prisma + migrations versionnées | Imposé (préféré) ; SQL brut pour verrous `FOR UPDATE` et contraintes `CHECK` |
| Validation | Zod (partagée formulaires ↔ serveur) | Une seule source de vérité |
| Authentification | Better Auth (e-mail + mot de passe, sessions en base, adaptateur Prisma) | Sessions en base révocables, hachage robuste, limitation de tentatives, réinitialisation |
| Autorisation | RBAC maison (Role / Permission / UserRole) vérifiée dans chaque service | Exigence de permissions granulaires |
| Tests unitaires / intégration | Vitest + base PostgreSQL de test réelle (Docker) | Les transactions et contraintes doivent être testées sur PostgreSQL, pas sur un mock |
| Tests E2E | Playwright (mobile + desktop) | Parcours critiques, responsive |
| Exports | CSV natif, Excel (`exceljs`), PDF (`@react-pdf/renderer`) | Bons, reçus, rapports |
| E-mail | Adaptateur SMTP (`nodemailer`), inactif sans configuration | Pas de clé inventée, pas d'envoi simulé |
| Paquets | pnpm (version figée via corepack) | |
| CI | GitHub Actions : lint, typecheck, tests, build | |

## 3. Arborescence cible

```
src/
  app/
    (shop)/            accueil, catalogue, catégories, produit, services, panier, commande, pages CMS
    (account)/compte/  espace client
    admin/             back-office (layout + garde de permission)
    api/               Route Handlers (exports, uploads)
    sitemap.ts robots.ts not-found.tsx
  server/
    auth/              config Better Auth, getSession()
    authz/             permissions.ts, requirePermission(), policies
    audit/             audit.log()
    db/                client Prisma, helpers transactionnels
    modules/
      catalog/ inventory/ cart/ orders/ payments/ deliveries/
      services/ quotes/ interventions/ customers/ reports/
      settings/ content/ notifications/ users/
        <module>/ service.ts  repository.ts  schemas.ts  *.test.ts
    storage/
  components/          ui/ (shadcn) + composants métier
  lib/                 money.ts (FCFA), dates (Africa/Dakar), utilitaires
prisma/
  schema.prisma  migrations/  seed/ (base.ts = rôles/permissions ; demo.ts = démo, séparé)
tests/e2e/
docs/
```

## 4. Règles transverses

- **Argent** : entiers en FCFA (le XOF n'a pas de sous-unité). Aucun flottant. Remises en pourcentage arrondies à l'entier le plus proche, demi vers le haut, règle centralisée dans `lib/money.ts`.
- **Fuseau** : stockage UTC, affichage `Africa/Dakar`.
- **Total de commande** : toujours recalculé côté serveur = Σ(prix catalogue × qté) + frais de livraison − remises autorisées. Les prix sont figés dans `OrderItem`.
- **Idempotence** : chaque soumission de commande porte une clé d'idempotence (contrainte unique) pour empêcher les doublons.
- **Stock** : réservation et décrément dans une transaction avec verrouillage de ligne ; chaque variation produit un `StockMovement`.
- **Paiement** : aucune passerelle, aucun champ bancaire. L'enum des méthodes ne contient que des moyens physiques (`CASH`). Un test automatisé vérifie l'absence de dépendances et de routes de paiement électronique.
- **Encaissements** : immuables. Correction = annulation + contre-écriture liée. Le statut de paiement est recalculé à partir des encaissements valides.
- **Autorisation** : vérifiée dans le service (pas seulement dans l'UI ou le middleware). Les requêtes client sont toujours restreintes au `customerId` de la session.
- **Audit** : table append-only, protégée par un trigger PostgreSQL interdisant `UPDATE`/`DELETE`. Aucun secret ni mot de passe journalisé.
- **Données sensibles** : prix d'achat, marges et notes internes exclus des DTO publics par des sélecteurs Prisma explicites (jamais d'objet complet renvoyé au client).
