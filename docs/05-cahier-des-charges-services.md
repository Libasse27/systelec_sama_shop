# Cahier des charges : page Services FUTANI TECH

| | |
|---|---|
| **Version** | 1.0, 5 novembre 2026 |
| **Statut** | Phases 1 et 2 développées et testées en local, non publiées (voir `docs/rapports/services-phases-1-2.md`) ; phases suivantes non commencées |
| **Sources** | Proposition du propriétaire, analyse de cinq agents, vérification dans le code |

## 1. Objectif

Faire de `/services` une vitrine commerciale de FUTANI TECH, qui sépare clairement :

- **ce que nous faisons** : le catalogue de prestations ;
- **ce que nous avons fait** : des réalisations réelles et autorisées.

Le premier but de la page reste de conduire le visiteur vers une demande de devis, y compris sur mobile et avec une connexion lente.

**Répartition des marques :**

- **FUTANI SHOP** : commerce en ligne, produits et commandes ;
- **FUTANI TECH** : prestations informatiques, réseaux, vidéosurveillance, électricité et développement web.

## 2. Décisions

### Validées par le propriétaire

| N° | Décision |
|---|---|
| V1 | Les services sont présentés par **FUTANI TECH**, via `BRAND.tech` (`src/lib/brand.ts`). |
| V2 | Chaque famille a une **vraie page dédiée**, et non une modale. |

### Retenues dans ce cahier, à confirmer à sa validation

| N° | Décision | Motif |
|---|---|---|
| R1 | La palette actuelle est conservée : le bouton principal reste bleu. Le rouge n'est pas ajouté aux actions. | Aucun rouge n'existe dans `src/app/globals.css`. |
| R2 | Seules des photos réelles, autorisées et vérifiées sont publiées. Aucune publication automatique. | Protection des clients. |
| R3 | `/services` affiche les 5 familles. Les 42 prestations sont listées sur les pages de famille. | Page mobile aujourd'hui d'environ 6 000 px. |
| R4 | Une modale ne sera envisagée qu'en aperçu complémentaire, jamais à la place d'une page. | Référencement, partage et bouton Retour. |
| R5 | Les vidéos et les témoignages sont reportés. | Stockage inadapté ; source réelle et consentement requis. |

La proposition reste non contractuelle sur ces points tant qu'ils ne sont pas confirmés. Les décisions validées seront ensuite reportées dans `docs/03-plan-et-decisions.md`.

## 3. Existant à préserver

| Élément | État vérifié | Exigence |
|---|---|---|
| Prestations | 42 fiches `/services/[slug]`, avec métadonnées et JSON-LD `Service` | Identifiants, slugs et URL inchangés |
| Familles | 5, en base : voir le tableau ci-dessous | Lues depuis la base, jamais écrites en dur |
| Devis | `/devis/demande?service=<slug>`, sans catégorie | Parcours inchangé |
| Relations | `QuoteRequest` et les interventions référencent `Service` (`onDelete: SetNull`) | Aucune rupture |
| Sitemap | `/services` et chaque fiche | Conservés et complétés |
| Accueil | Section services avec `featuredServices` | Inchangée |
| Accueil (révision du 2026-11-07) | Section « Services techniques » retirée de l'accueil de FUTANI SHOP à la demande du propriétaire ; fonction `featuredServices` supprimée | Accès aux services par le navbar FUTANI TECH (lien « Services » de la boutique) et le lien « Services techniques » du pied de page |
| Emblème du navbar | Dépasse de 28 px, clics traversants, marge sous le header | Aucun retour en arrière |

| Slug en base | Nom affiché | Prestations |
|---|---|---|
| `maintenance-informatique` | Maintenance informatique | 12 |
| `reseaux-informatiques` | Réseaux informatiques | 9 |
| `videosurveillance` | Vidéosurveillance | 10 |
| `electricite` | Électricité | 10 |
| `developpement-web` | Développement web | 1 |

## 4. Exigences générales

- **Base de données :** migrations additives uniquement. Aucune réinitialisation, aucune donnée inventée.
- **Rendu :** composants serveur par défaut. Tout le catalogue fonctionne sans JavaScript.
- **Interface :** jetons de `globals.css`, icônes `BrandIcon` et non des emojis, fichiers en kebab-case.
- **Accessibilité :** WCAG 2.2 AA, cibles tactiles visées à 44 px sur mobile, respect de `prefers-reduced-motion`.
- **Performance :** aucune vidéo de fond ; image principale statique, dimensionnée et optimisée ; chargement différé des médias.
- **Texte :** aucune promesse invérifiable, aucun chiffre, avis ou client inventé. Les pôles futurs de `brand.ts` restent présentés comme « à venir ».
- **Git :** une branche par phase (décision D14), après commit du travail en cours sur le navbar.

## 5. Phases 1 et 2 : page Services et pages de famille

**Aucune migration.** Ces deux phases sont livrées **ensemble** : les cartes de `/services` pointent vers les pages de famille, qui doivent exister dès la mise en ligne.

### 5.1 `/services`

1. **Introduction :** titre « FUTANI TECH — Nos solutions informatiques et techniques », logo FUTANI TECH, texte court, boutons « Demander un devis » (`/devis/demande`) et « Découvrir nos services » (ancre vers les familles). L'image statique reste facultative tant qu'aucun visuel réel n'est fourni.
2. **Familles :** 5 cartes alimentées par `listServiceGroups`, dans l'ordre de la base. Chaque carte affiche une icône, le nom, la description et le libellé « Découvrir les prestations ».
3. **Appel à l'action final :** demander un devis, nous contacter, moyens de règlement.

Une famille inactive ou sans prestation active n'est pas affichée. Chaque carte est un **seul lien** vers sa page : aucun bouton imbriqué dans le lien.

| Famille | Icône |
|---|---|
| Maintenance informatique | `public/icones/services/maintenance-informatique.png` |
| Réseaux informatiques | `public/icones/services/reseaux-informatiques.png` |
| Vidéosurveillance | `public/icones/services/videosurveillance.png` |
| Électricité | `public/icones/services/electricite.png` |
| Développement web | `public/icones/services/developpement-web.png` |

Une icône par slug, avec une icône par défaut pour une famille sans icône propre, suffit : aucune colonne en base.

### 5.2 `/services/categorie/[slug]`

Nouvelle route. Le segment statique `categorie` n'entre pas en conflit avec `/services/[slug]`. Le slug de prestation `categorie` devient réservé.

Contenu :

- fil d'Ariane `Accueil / Services / <Famille>` ;
- titre et description de la famille ;
- liste de ses prestations, chacune avec son nom, son prix affiché, un lien vers sa fiche et un lien direct **« Demander un devis »** vers `/devis/demande?service=<slug>` ;
- moyens de règlement et lien « Nous contacter ».

Le lien direct garde le parcours à **deux clics** : carte de famille, puis devis.

Comportement :

- famille inconnue ou inactive : page 404 ;
- métadonnées propres : titre, description et URL canonique ;
- ajout au sitemap ;
- sur la fiche d'une prestation, le nom de la famille devient un lien vers sa page.

### 5.3 Marque et référencement

- Titre de `/services` et des pages de famille au nom de FUTANI TECH : titre absolu, sans le suffixe `| FUTANI SHOP`.
- Le JSON-LD garde `provider` FUTANI TECH et `parentOrganization` FUTANI GROUP.
- Aucun balisage `Review` ou `AggregateRating` auto-publié.

### 5.4 Critères d'acceptation

- [x] Les 5 familles s'affichent, avec Développement web.
- [x] Chaque page de famille répond 200 et liste exactement ses prestations actives.
- [x] Les 42 fiches sont liées dans le HTML serveur des pages de famille, sans JavaScript.
- [x] Une prestation reste accessible et son devis se préremplit.
- [x] Un slug de famille inconnu renvoie 404.
- [x] Le sitemap contient `/services`, les 5 familles et les 42 fiches.
- [x] Aucun débordement horizontal de 320 à 1920 px ; l'emblème ne recouvre pas le contenu au repos.
- [ ] Navigation au clavier complète et focus visible.

Vérification locale uniquement : CI en attente ; navigation au clavier partiellement couverte (seuls quelques liens sont testés).

## 6. Phase 3 : administration du catalogue

**Prérequis, à traiter dans cette phase :** `seedServices` crée les services par slug avec `skipDuplicates`, et `db:seed` se relance en exploitation. Un service renommé dans son slug ou supprimé serait recréé.

Exigences :

- nouvelle entrée de menu **FUTANI TECH** et écrans `/admin/services` ;
- familles : nom, description, position, statut actif ;
- prestations : nom, descriptions, mode de prix, prix, durée, zones, conditions, position, mise en avant, statut actif ;
- **slugs immuables** après création ;
- **désactivation au lieu de suppression** pour tout service référencé par un devis ou une intervention ;
- chaque écriture passe par `assertPermission` et `recordAudit`, dans la transaction ;
- validation par schéma et messages d'erreur en français.

### Critères d'acceptation

- [ ] Une modification apparaît sur le site sans déploiement.
- [ ] Un service désactivé disparaît du public, et les anciens devis restent intacts.
- [ ] Relancer `db:seed` ne recrée ni ne réactive un service modifié ou désactivé.
- [ ] Un utilisateur sans permission est refusé côté serveur, et pas seulement dans l'interface.

## 7. Phases 4 à 6 : réalisations en photos

### 7.1 Modèle de données (phase 4, migration additive)

```prisma
model ServiceProject {
  id               String    @id @default(cuid())
  categoryId       String
  category         ServiceCategory @relation(fields: [categoryId], references: [id], onDelete: Restrict)
  title            String
  slug             String    @unique
  shortDescription String
  description      String?
  completedAt      DateTime? @db.Date
  isPublished      Boolean   @default(false)
  position         Int       @default(0)
  // Traçabilité de la vérification, jamais affichée au public.
  consentReference String?
  consentAt        DateTime? @db.Date
  reviewedAt       DateTime? @db.Timestamptz(3)
  reviewedById     String?
  media            ServiceProjectMedia[]
  createdAt        DateTime  @default(now()) @db.Timestamptz(3)
  updatedAt        DateTime  @updatedAt @db.Timestamptz(3)

  @@index([isPublished, categoryId, position])
  @@map("service_projects")
}

model ServiceProjectMedia {
  id        String @id @default(cuid())
  projectId String
  project   ServiceProject @relation(fields: [projectId], references: [id], onDelete: Cascade)
  key       String
  thumbKey  String
  alt       String
  position  Int    @default(0)

  @@index([projectId, position])
  @@map("service_project_media")
}
```

Ce modèle est indicatif et sera ajusté aux conventions du schéma lors de la phase 4. La photo en position 0 sert de couverture. `consentReference` est une référence interne : ni nom de client ni adresse.

### 7.2 Traitement et service des photos (phase 5)

Le stockage reste le **disque local** : S3 n'est pas nécessaire pour des photos et reste hors périmètre.

| Sujet | Exigence |
|---|---|
| Types | JPEG, PNG, WebP, vérifiés sur le contenu réel ; SVG et HTML refusés |
| Traitement | `sharp` en dépendance directe : redressement, suppression des métadonnées, WebP d'environ 1600 px, vignette d'environ 480 px |
| Original | Non conservé |
| Limites | 5 Mo par photo, 12 par projet, verrou de la fiche pendant le contrôle du plafond, dimensions maximales contrôlées avant traitement |
| Envoi | Une photo à la fois : le corps est plafonné à 7 Mo (Server Actions) et 8 Mo (Caddy) |
| Brouillons | Fichiers **inaccessibles au public** : hors de `/medias` public, servis par une route qui contrôle le statut |
| Retrait | Le cache « immuable d'un an » de `/medias` n'est pas réutilisé : un projet masqué doit cesser d'être servi rapidement |
| Volume | Plafond global et alerte de disque, à chiffrer avant la production |

À valider dès le début de la phase : `sharp` dans l'image Docker `standalone`, et les vraies photos de téléphone, dont le format HEIC, aujourd'hui refusé.

### 7.3 Règles de publication

Une réalisation ne peut passer à `isPublished` que si **toutes** ces conditions sont réunies :

1. au moins une photo, avec un texte alternatif sans nom de client ;
2. un accord écrit du client, daté et référencé, avec son périmètre (photos, durée, droit de retrait) ;
3. une vérification humaine confirmant :
   - visages, plaques, écrans, enseignes et adresses floutés ou absents ;
   - aucun numéro de série ni mot de passe visible ;
   - **vidéosurveillance :** aucune image issue des caméras, aucun plan, et aucune vue permettant de déduire l'implantation ou les angles morts ;
   - **électricité :** aucun tableau ou local technique permettant d'identifier le site.

Cette vérification est tracée (auteur et date) dans le journal d'audit. Le serveur la contrôle, et pas seulement le formulaire. Un bouton « Masquer » retire la réalisation immédiatement, sans la supprimer.

À défaut de client autorisé, privilégier du matériel neuf avant pose ou des installations de démonstration, **présentés comme tels**.

### 7.4 Galerie publique (phase 6)

- Section « Nos réalisations » sur `/services` : une sélection courte (6 à 8 projets), triée par position.
- Page complète `/services/realisations`, paginée, avec des filtres en **liens** (`?categorie=<slug>`), rendus côté serveur.
- Filtres : « Toutes les réalisations », puis uniquement les familles ayant des projets publiés. Un paramètre inconnu est ignoré.
- Fiche `/services/realisations/[slug]` : photos, description, famille et lien de devis.
- **Section masquée tant qu'aucun projet n'est publié** : ni texte de remplacement, ni fausses cartes.
- Au sitemap : uniquement les projets publiés ayant un vrai texte.

### 7.5 Critères d'acceptation

- [ ] Publication refusée côté serveur si une condition manque.
- [ ] Une image de brouillon n'est pas accessible sans permission.
- [ ] Une photo publiée ne contient plus de métadonnées GPS, vérifié par un test sur un fichier réel.
- [ ] Un projet masqué disparaît des listes, de sa fiche et du sitemap.
- [ ] Aucune section vide n'apparaît sans projet publié.
- [ ] Les filtres fonctionnent sans JavaScript et sont utilisables au clavier.

## 8. Phase 7 : visionneuse

Amélioration progressive : la fiche reste complète sans JavaScript.

- `<dialog>` natif avec `showModal()`, nom accessible, Échap et retour du focus ;
- boutons précédent et suivant visibles, flèches du clavier, compteur annoncé (« 3 sur 12 ») ;
- balayage doublé de boutons, zoom du navigateur non bloqué ;
- défilement de la page bloqué derrière ;
- presque plein écran sur mobile.

## 9. Phase 8 : vidéos

**Ne démarre qu'après une décision dédiée (Q5).** L'auto-hébergement est impossible aujourd'hui : clés limitées aux images, lecture intégrale en mémoire, ni flux ni `Range`, envois plafonnés.

Option à étudier en priorité, **YouTube non répertorié** :

- identifiant validé, jamais d'URL libre ;
- vignette locale, iframe `youtube-nocookie` chargée **uniquement au clic** ;
- `frame-src` ciblé dans la CSP (`src/proxy.ts`), sans joker ;
- mention dans la politique de confidentialité ;
- mêmes règles de consentement que pour les photos, et sous-titres ou description textuelle.

## 10. Phase 9 et hors périmètre

**Phase 9, ultérieure : témoignages.** Autorisation écrite, texte brut, administrateur seul à la saisie, 3 témoignages statiques au maximum, sans carrousel ni balisage d'avis. La décision D8 ne vise que les avis produits : une décision propre aux prestations sera nécessaire.

**Hors périmètre de ce cahier :**

- pilote S3 ;
- photos avant/après ;
- section « derniers projets » séparée, car la galerie triée la remplace ;
- préremplissage du devis par famille, qui demanderait de modifier `quotes/schemas.ts` et `requests.ts` ;
- vidéo de fond ;
- icônes et images de famille administrables.

## 11. Récapitulatif des phases

| Phase | Contenu | Migration | Priorité |
|---|---|---|---|
| 1 et 2 | Page `/services` et 5 pages de famille | Non | Très haute |
| 3 | Administration des familles et prestations | À confirmer | Haute |
| 4 | Modèle des réalisations | Oui, additive | Haute |
| 5 | Gestion sécurisée des photos et règles de publication | Possible | Haute |
| 6 | Galerie publique | Non | Haute, si des photos autorisées existent |
| 7 | Visionneuse | Non | Moyenne |
| 8 | Vidéos | Oui, additive | Moyenne, après décision |
| 9 | Témoignages | Oui, additive | Ultérieure |

Chaque phase est testée et validée avant la suivante.

## 12. Tests et contrôle qualité

**À chaque phase :** `tsc`, ESLint, tests unitaires et d'intégration concernés, tests E2E ciblés. Les migrations et le traitement des fichiers passent aussi par une revue de sécurité.

**Tests existants à adapter en phases 1 et 2**, car ils supposent les prestations listées sur `/services` :

- `e2e/storefront.spec.ts` : « une prestation mène à la demande de devis du service » ;
- `e2e/services.spec.ts` : parcours du service de développement web ;
- `e2e/header-click-through.spec.ts` : les tests qui utilisent la grille de cartes, à reporter sur une page dont le contenu passe bien sous l'emblème.

Ils seront **réécrits sur le nouveau parcours, sans perdre leur intention** : prestation accessible, puis devis prérempli.

**Nouveaux tests minimaux :**

- `/services` : 5 familles, sans dépendre d'un nombre écrit en dur quand c'est évitable ;
- page de famille : prestations, 404, métadonnées, devis direct, et HTML serveur contenant les liens ;
- sitemap ;
- réalisations : publication refusée, brouillon privé, masquage, métadonnées retirées ;
- responsive à 320, 390, 820, 1024, 1280 et 1920 px.

**Point connu :** la suite E2E complète a donné 17 échecs avec 4 workers et un serveur de dev actif, et aucun sur les fichiers concernés avec 1 worker. La cause probable est la surcharge, sans preuve définitive. Un passage complet de référence est à faire avant la phase 1.

**Avant toute fusion :** rapport conjoint Git/CI et sécurité. Commit, push et fusion restent des autorisations séparées.

## 13. Questions ouvertes

| N° | Question | Bloque | Recommandation |
|---|---|---|---|
| Q1 | Le nom affiché est-il « Électricité » (base) ou « Installations électriques » (proposition) ? | Phase 1 | Garder « Électricité », plus large : il inclut aussi le dépannage et la maintenance |
| Q2 | Qui fournit l'icône Électricité, dans le style des pictogrammes `public/icones` ? | Phase 1 | **Résolue :** icônes des 5 familles fournies par le propriétaire le 2026-11-06 |
| Q3 | Une image réelle est-elle disponible pour l'introduction ? | Non | Introduction sans image tant qu'il n'y en a pas |
| Q4 | Des photos réelles publiables existent-elles, avec l'accord des clients ? | Phase 6 | Sinon, faire les phases 1 à 3 et attendre pour la suite |
| Q5 | YouTube est-il acceptable pour les vidéos ? | Phase 8 | Oui, sauf pour les chantiers de clients sensibles |
| Q6 | Quelle permission pour publier : `content.manage` ou une nouvelle ? | Phase 5 | `content.manage` avec vérification tracée, sauf si l'équipe grandit |
| Q7 | Validation juridique : loi sénégalaise n° 2008-12 et CDP, droit à l'image, modèle d'autorisation client | Publication | Faire valider par un juriste ; ce cahier ne constitue pas un avis juridique |
| Q8 | Plafond de disque et sauvegarde des photos | Production | À chiffrer, aucun serveur de production n'existant encore |

## 14. Définition de terminé

Une phase est terminée lorsque :

1. ses critères d'acceptation sont vérifiés ;
2. les contrôles de la section 12 sont passés, résultats à l'appui ;
3. le responsive et le clavier sont vérifiés dans un navigateur ;
4. un rapport `docs/rapports/` indique ce qui a été livré, testé et laissé de côté ;
5. le propriétaire a validé la phase.
