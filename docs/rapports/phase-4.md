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

## Revue de code et de sécurité

Aucun point CRITICAL ni HIGH. La revue n'a trouvé ni injection SQL, ni XSS, ni fuite du prix d'achat. Corrigé dans un commit séparé, avec des tests :

- **M1, M2** : variante affichée = variante par défaut si elle est active, sinon la première active. La règle est la même dans la liste, la fiche, le sitemap et les accessoires compatibles. Un produit sans variante active n'apparaît plus nulle part.
- **M3, partiel** : l'image n'est calculée qu'après la pagination.
- **M4** : l'octet NUL est retiré de la recherche, et les slugs invalides mènent à une 404 sans requête en base.
- **M5** : les coordonnées de l'entreprise sont lues une fois par requête. Une valeur invalide en base fait afficher les valeurs par défaut, avec une entrée dans le journal, au lieu de rendre le site indisponible.
- **M6** : la démo exige `ALLOW_DEMO_SEED=1` en plus du refus en production.
- **LOW** :
  - L1 : clé `objet` vérifiée par `Object.hasOwn` ;
  - L2 : lien WhatsApp seulement si le numéro contient des chiffres ;
  - L4 : `/recherche` en noindex seul, sans `Disallow` ;
  - L5 : niveaux de titres corrigés, pictogramme masqué aux lecteurs d'écran, image principale chargée en priorité ;
  - L6 : ordre déterministe des services mis en avant ;
  - L7 : clés React uniques.

Reporté, à décider :

- **M3, suite** : la recherche n'est ni indexée (`pg_trgm`) ni limitée en débit. C'est sans risque à petit volume ; à traiter avant d'ouvrir un gros catalogue, et au plus tard en phase 10.
- **M7, décision métier** : les 41 prestations de base sont publiées (« Sur devis ») avec une description générique. Faut-il les créer masquées jusqu'à leur relecture ?

## Points ouverts

- **Images produits** : téléversement en phase 5. Un pictogramme s'affiche en attendant.
- **Bouton « Ajouter au panier »** : en phase 6. La fiche invite à contacter la boutique.
- **Formulaires de demande de devis et de réservation** : en phase 8. Les boutons mènent à la page Contact, qui précise la prestation demandée.
- **`unaccent`** : l'extension doit être autorisée sur le PostgreSQL de production. Elle est créée par la migration et demande les droits adéquats.
- **Performance de la recherche** : `ILIKE` sans index trigramme, ce qui suffit pour quelques milliers de produits. Ajouter `pg_trgm` si le catalogue grossit.
