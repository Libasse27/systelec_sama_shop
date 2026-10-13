# Rapport de phase 4 — Boutique publique

**Branche :** `feat/phase-4-boutique` · **Date :** 2026-10-13

## Livré

| Élément | Fichiers |
|---|---|
| Modèle catalogue : catégories arborescentes, marques, produits, variantes, stock, images, compatibilités ; services ; pages CMS ; FAQ | `prisma/schema.prisma`, migration `*_catalog_content` |
| Contraintes en base : prix ≥ 0, prix barré > prix, réservé ≤ stock, tarif obligatoire sauf « sur devis », une seule variante par défaut | migration `*_catalog_content` |
| Données de base réelles : arborescence §6 (6 familles, 72 sous-catégories), 41 prestations §7 « sur devis », 5 pages légales en brouillon (aucun texte inventé) | `src/server/modules/catalog/{taxonomy,seed}.ts`, `pnpm db:seed` |
| Démonstration séparée : 13 produits « [DÉMO] » à marques fictives, FAQ ; refusée en production (D5) | `src/server/modules/catalog/demo.ts`, `pnpm db:seed:demo` |
| Recherche : nom, SKU, marque, modèle, catégorie ; plusieurs mots ; insensible aux accents (`unaccent`) ; jokers SQL échappés | `src/server/modules/catalog/queries.ts`, migration `*_unaccent` |
| Filtres (prix, disponibilité, marque), tri (pertinence, prix, nouveautés), pagination ; paramètres d'URL robustes | `listing-params.ts`, `components/catalog/product-listing.tsx` |
| Disponibilité réelle calculée depuis le stock (« Épuisé », « Plus que N ») | `src/lib/labels.ts` |
| DTO publics explicites : le prix d'achat n'est jamais lu pour la boutique | `queries.ts` |
| Pages : accueil, catégories, recherche, fiche produit, services, fiche service (devis, réservation, contact), pages CMS, FAQ, contact | `src/app/**` |
| En-tête avec recherche et menu catalogue sans JavaScript, pied de page, lien d'évitement | `components/layout/*` |
| SEO : métadonnées, canoniques, `sitemap.xml`, `robots.txt` (rien d'indexé hors production), JSON-LD (Product, BreadcrumbList, Service, FAQPage, Store), aucun avis inventé, recherche en `noindex` | `src/app/{sitemap,robots}.ts`, `components/seo/json-ld.tsx` |

## Tests réellement exécutés

| Commande | Résultat |
|---|---|
| `pnpm lint` / `pnpm typecheck` | OK |
| `pnpm test` | 21 fichiers, 127 tests réussis (dont intégration PostgreSQL) |
| `pnpm build` | OK |
| `pnpm test:e2e` | 52 tests réussis (bureau et mobile) |
| `pnpm db:seed` et `pnpm db:seed:demo` (2 fois chacun) | idempotents |

Critères §20 :

- **n° 27, affichage responsive** : aucun débordement horizontal sur 7 pages clés, en mobile (Pixel 7) et sur ordinateur.
- **Fuite de données internes** : aucun `costPrice` dans les DTO ni dans le HTML (intégration et E2E).
- **Brouillons et catégories désactivées** : invisibles, y compris quand c'est le parent qui est désactivé.

## Défaut trouvé par les tests et corrigé

- Un champ de prix laissé vide dans le formulaire de filtres (`max=`) était converti en 0 FCFA, et la liste devenait vide. Un champ vide signifie maintenant « pas de borne », avec un test unitaire de non-régression.

## Points ouverts

- **Images produits** : téléversement en phase 5. Un pictogramme s'affiche en attendant.
- **Bouton « Ajouter au panier »** : en phase 6. La fiche invite à contacter la boutique.
- **Formulaires de demande de devis et de réservation** : en phase 8. Les boutons mènent à la page Contact, qui précise la prestation demandée.
- **`unaccent`** : l'extension doit être autorisée sur le PostgreSQL de production. Elle est créée par la migration et demande les droits adéquats.
- **Performance de la recherche** : `ILIKE` sans index trigramme, ce qui suffit pour quelques milliers de produits. Ajouter `pg_trgm` si le catalogue grossit.
