# Rapport — Services FUTANI TECH, phases 1 et 2

**Branche :** `feat/services-phase-1-familles` · **Date :** 2026-11-06 · **Référence :** `docs/05-cahier-des-charges-services.md`, §5

**État :** développé et testé ; commit autorisé par le propriétaire le 2026-11-06, sans push. Validation de la phase (§14, point 5) : `/services` et les 5 pages de famille validées visuellement par le propriétaire, confirmation du 2026-11-06.

## État de publication

- Commits non poussés (aucun push).
- Aucune exécution de CI sur ces commits.
- Tests E2E exécutés avec 1 worker seulement ; le passage en parallèle n'est pas validé.

## Livré

| Élément | Fichiers |
|---|---|
| `/services` : présentation FUTANI TECH, 5 cartes de famille (un seul lien par carte), appel à l'action final, titre absolu | `src/app/services/page.tsx`, `src/components/services/service-family-card.tsx`, `src/components/services/service-call-to-action.tsx` |
| `/services/categorie/[slug]` : fil d'Ariane, métadonnées, prestations avec fiche et devis direct prérempli, 404 pour une famille inconnue, inactive ou vide | `src/app/services/categorie/[slug]/page.tsx`, `getServiceGroup` dans `src/server/modules/services/queries.ts` |
| Fiche de prestation : le nom de la famille devient un lien vers sa page | `src/app/services/[slug]/page.tsx` |
| Sitemap : ajout des pages de famille | `src/app/sitemap.ts` |
| Adresses et styles de boutons partagés | `src/lib/service-paths.ts`, `src/components/services/service-action-styles.ts` |

Icônes : les 5 familles utilisent les images fournies par le propriétaire (`services-futani/icone-*`), en copies allégées dans `public/icones/services/<slug>.png`, sans colonne en base. Une famille sans icône propre utilise le pictogramme par défaut `innovation`.

## Tests réellement exécutés (code final)

| Contrôle | Résultat |
|---|---|
| TypeScript (`tsc --noEmit`) | 0 erreur |
| ESLint (`eslint .`) | 0 erreur |
| Vitest, projets `unit` et `integration` | 840 réussis sur 840 (84 fichiers) |
| Playwright complet, 1 worker | 241 réussis, 0 échec, 81 ignorés (référence : 201 / 0 / 81) |

Le projet Vitest `migration` n'a pas été exécuté : aucune migration n'a été ajoutée.

Les 40 tests supplémentaires : 38 dans `e2e/service-families.spec.ts` et 2 pour la nouvelle adresse du contrôle responsive de `e2e/storefront.spec.ts`.

### Échec intermittent à surveiller

`e2e/announcements-display.spec.ts:317` (« une annonce qui expire disparaît sans rechargement de la page ») a échoué une fois sur le code final : l'annonce était toujours présente après le délai. Les 2 tests suivants du fichier, exécuté en série, n'ont donc pas tourné (238 réussis, 1 échec, 2 non exécutés, 81 ignorés).

Sur le même code, le test a ensuite réussi 4 fois sur 4 seul, puis dans une suite complète. La trace de l'échec a été écrasée par le rejeu : **la cause n'est pas établie**. Le bandeau n'a pas été modifié, mais le test navigue vers `/services`. Un lien avec cette phase n'est donc pas formellement exclu.

Hypothèse d'analyse statique, non démontrée : `src/components/layout/announcement-refresh.tsx` appelle `router.refresh()` une seule fois, sans nouvelle tentative. Un rafraîchissement perdu ou échoué pendant une navigation pourrait laisser affichée l'annonce expirée. Le fuseau horaire et le cache serveur sont écartés. Un lien avec cette phase est jugé peu probable, sans être exclu.

## Tests adaptés

| Fichier | Adaptation |
|---|---|
| `e2e/storefront.spec.ts`, `e2e/services.spec.ts` | Le parcours passe par la page de famille avant la prestation |
| `e2e/header-click-through.spec.ts` | Le test Maj+Tab utilise une page de famille (12 prestations, 2 liens par carte, donc 6 tabulations) |
| `e2e/footer.spec.ts` | Le saut d'ancre vise `#familles`, avec une fenêtre basse de 500 px |

## Revue de code

Revue indépendante : aucun problème critique ou élevé. Points mineurs traités : viewport en double dans un test, prop `quoteHref` inutilisée, hauteur tactile du lien de famille sur la fiche.

Non traités : le lien de fiche d'une prestation n'a pas de hauteur minimale imposée ; le slug réservé `categorie` n'est protégé que par un test, à garder aussi côté serveur quand l'administration du catalogue existera.

## Revue avant push

Deux revues en lecture seule : Git/CI et sécurité. La revue sécurité n'a relevé aucun problème bloquant. La revue Git/CI conclut « prêt avec réserves », sans point bloquant.

## Laissé de côté

- Phases suivantes du cahier des charges, dont l'administration du catalogue.
- Image de présentation : aucune image réelle disponible, aucune image fictive ajoutée.

## Décisions du propriétaire

- Les 42 prestations ne sont plus listées directement sur `/services`, mais sur les pages de famille.
- La protection serveur du slug `categorie` est reportée à l'administration du catalogue.
- L'échec intermittent du bandeau d'annonces sera analysé séparément.
- `AGENTS.md`, généré par `next dev`, n'est pas committé.
