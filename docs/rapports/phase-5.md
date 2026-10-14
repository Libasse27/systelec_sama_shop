# Rapport de phase 5 — Produits et stocks

**Branche :** `feat/phase-5-produits-stocks` · **Date :** 2026-10-14

## Livré

| Élément | Fichiers |
|---|---|
| Journal de stock **immuable** : chaque mouvement enregistre sa quantité signée et le stock qui en résulte. Un trigger PostgreSQL interdit `UPDATE` et `DELETE`, et des contraintes `CHECK` imposent une quantité non nulle, réservé ≤ physique et un motif obligatoire | migration `*_stock_movements`, `prisma/schema.prisma` |
| Entrées, sorties et inventaires motivés et audités. La ligne de stock est verrouillée (`SELECT … FOR UPDATE`), le physique ne descend jamais sous le réservé, et un inventaire enregistre l'écart constaté | `src/server/modules/inventory/service.ts` |
| Seuils d'alerte par version, liste des alertes et état du stock paginé avec recherche | `inventory/{service,queries}.ts` |
| Administration du catalogue : catégories (pas de boucle dans l'arborescence, suppression réservée aux catégories vides), produits (création en brouillon, publication si au moins une version est active, archivage sous permission dédiée), versions (SKU unique, version par défaut forcément active) | `catalog/admin-{categories,products,schemas}.ts` |
| **Prix et promotions** : prix TTC entier en FCFA ; promotion par prix barré, qui doit être supérieur au prix de vente (vérifié côté serveur et en base) ; prix d'achat interne | `admin-schemas.ts` |
| **Images** : type réel vérifié sur les octets (JPEG, PNG, WebP ; SVG et HTML refusés), 5 Mo et 12 images par produit au maximum, nom de fichier aléatoire, ordre modifiable, description obligatoire pour l'accessibilité. Stockage local avec clés validées contre la remontée de dossier, servi par `/medias/…` avec une CSP `sandbox` | `catalog/admin-images.ts`, `src/server/storage/*`, `src/app/medias/[...key]/route.ts` |
| **Export CSV** : une ligne par version, séparateur « ; » et BOM pour Excel, cellules-formules neutralisées. Le prix d'achat n'est exporté qu'à qui peut modifier les produits | `src/lib/csv.ts`, `catalog/csv-transfer.ts` |
| **Import CSV** en deux temps : un aperçu sans écriture, puis l'application en **tout ou rien** sur l'état courant. Il met à jour les prix, les seuils et les quantités comptées des versions existantes, sans créer ni supprimer de produit. Les droits sont vérifiés selon les colonnes réellement modifiées, et les comptages passent par des mouvements d'inventaire du journal | `catalog/csv-import-plan.ts`, `csv-transfer.ts` |
| Back-office `/admin` : menu limité aux permissions, tableau de bord (produits par statut, alertes de stock), produits (liste, création, fiche, versions, images, statut), catégories, stock (état, fiche par version, journal), import/export | `src/app/admin/**`, `src/components/admin/**` |
| Validation commune : messages Zod en français, erreurs rattachées à chaque champ, y compris dans les formulaires imbriqués | `src/server/validation.ts` |

## Tests réellement exécutés

| Commande | Résultat |
|---|---|
| `pnpm lint` / `pnpm typecheck` | OK |
| `pnpm test` | 32 fichiers, 183 tests réussis (dont intégration PostgreSQL) |
| `pnpm build` | OK |
| `pnpm test:e2e` | 58 tests réussis (bureau et mobile) ; le parcours d'administration a été répété 3 fois sans échec |

Critères §20 :

- **n° 4, administration des produits** :
  - création, modification, versions, publication et archivage, avec les droits par rôle ;
  - parcours E2E complet : catégorie, produit, image, publication, réception de stock, puis vérification sur la boutique.
- **n° 5, catégories** : arborescence sans boucle, identifiant d'URL unique, suppression protégée.
- **n° 6, stock** :
  - mouvements motivés et refus de passer sous le réservé ;
  - journal immuable, vérifié en base ;
  - inventaire par écart, alertes ;
  - import tout ou rien.

## Défauts trouvés par les tests et corrigés

- **Création d'une famille principale impossible** : le formulaire envoie un parent vide (`""`), que le schéma refusait. Corrigé, avec un test unitaire.
- **Message de publication invisible** : il disparaissait aussitôt, car le bouton « Publier » est remplacé par « Repasser en brouillon ». Les changements de statut passent désormais par un seul formulaire, qui reste affiché.
- **Envoi avant hydratation** : un formulaire envoyé avant l'hydratation de la page partait en GET natif, avec les valeurs dans l'URL. Les boutons d'envoi restent désactivés jusqu'à l'hydratation.
- **E2E et base de développement** : les tests E2E publiaient des produits dans la catégorie de démonstration « Informatique ». Le parcours crée maintenant sa propre catégorie, puis la masque en fin de test.

## Revue de code et de sécurité

Deux revues : qualité du code et sécurité. Aucun point CRITICAL ni HIGH. La sécurité confirme :

- aucune injection SQL ;
- aucune remontée de dossier dans le stockage ;
- aucun XSS par fichier image ;
- des permissions revérifiées par chaque service, y compris pour les arguments liés (`.bind`), qui peuvent être falsifiés ;
- aucune fuite du prix d'achat vers la boutique.

Corrigé, avec des tests :

- **Sécurité, MEDIUM** : l'aperçu d'import permettait à un gestionnaire de stock de **deviner les prix d'achat**. Une valeur `prix_achat` juste donnait « inchangé », une valeur fausse un refus. Remplir cette colonne exige désormais `products.update`, que la valeur change ou non.
- **Code, MEDIUM** :
  - courses entre administrateurs sur « version par défaut » et « désactiver » : le produit est désormais verrouillé (`FOR UPDATE`) dans toutes les opérations sur ses versions et son statut. Un test lance les deux opérations en parallèle ;
  - le désarchivage exige maintenant la permission d'archivage, et le refus reste inscrit au journal d'audit.
- **LOW** :
  - ordre stable du journal de stock (départage par `id`) ;
  - image supprimée pendant un réordonnancement : renvoie « introuvable » ;
  - seuil d'alerte sur une version inconnue : renvoie « introuvable » au lieu d'une erreur générique ;
  - changements de catégorie parente sérialisés (pas de boucle possible) ;
  - audit d'import plus détaillé, avec un indicateur de troncature ;
  - prix d'achat ignoré à la création pour qui ne peut pas le relire.

Non retenu : exiger du stock ou une image pour publier. Un produit publié sans stock s'affiche « Épuisé », comme prévu en phase 4. Les images servies par `/medias` sont publiques, y compris pour les brouillons, mais leur URL est aléatoire et l'image est supprimée avec sa fiche.

## Choix et points ouverts

- **Promotions = prix barré par version.** Les promotions à règles (pourcentage, période, code, portée catégorie, entité `Promotion` du modèle de données) touchent au calcul du total de commande côté serveur. Elles sont reportées en **phase 6** (panier et commandes), où elles seront appliquées et testées avec les totaux.
- **L'import ne crée pas de produits.** La fiche (descriptions, catégorie, images) se crée dans l'interface ; l'import sert aux mises à jour en masse et aux inventaires.
- **Stockage S3** : seul le stockage sur disque local est fourni. `STORAGE_DRIVER=s3` échoue avec un message clair. En production, le dossier `storage/` doit être un volume sauvegardé (phase 10).
- **Images** : elles ne sont ni redimensionnées ni recompressées. À ajouter si le poids des pages le justifie (par exemple `sharp`).
- **Mouvements `RESERVE`, `RELEASE`, `SALE`, `RETURN`** : prévus dans le journal, ils seront utilisés par les commandes en phase 6.
