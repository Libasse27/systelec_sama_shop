# Rapport — Phase 10 : décisions du propriétaire (retours, remboursements, livraisons)

**Branche :** `feat/phase-10-retours-livraisons` (depuis `fix/phase-9-decisions`, commit `7ecdedf`) · **Date :** 2026-10-18 · décisions détaillées dans `docs/03-plan-et-decisions.md` (§ 4).

Ce rapport couvre les décisions du propriétaire (première partie) et la stabilisation de production (section « Stabilisation », branche `feat/phase-10-stabilisation`).

## Analyse préalable

- État du dépôt : le correctif post-phase 9 n'était pas commité. Il a été vérifié (lint, typecheck, 380 tests) puis commité sur `fix/phase-9-decisions` (`7ecdedf`, sans push). La phase 10 part de ce commit.
- Les cinq décisions correspondent au « Reste à décider » de la phase 9. Elles sont compatibles avec l'architecture. Deux écarts ont été signalés et appliqués : la décision 3 remplace l'horaire par défaut validé en phase 9 (lundi–samedi, 8 h–18 h) ; la décision 2 rend le déclarant interne facultatif (client invité sans compte).
- Choix du propriétaire avant la mise en œuvre :
  - relances : le client est relancé, puis le personnel ;
  - encaissement par le livreur : oui, limité à ses livraisons ;
  - exception de remboursement : réservée à l'administrateur principal.

## Livré

| Décision | Élément | Fichiers |
|---|---|---|
| 1 | Le remboursement est versé par une autre personne que celle qui a décidé le retour. Contrôle dans le service et en base (trigger `returns_check_update`). Un refus est journalisé (`authz.denied`, règle `return.decider_cannot_refund`). | `returns/service.ts` |
| 1 | Exception : permission `returns.refund_own_decision`, réservée à l'administrateur principal (l'administrateur n'en dispose pas), avec motif obligatoire. Le motif est inscrit sur le retour (`refundExceptionNote`, figé), dans l'historique et au journal d'audit. | `authz/{permissions,roles}.ts`, `/admin/retours/[id]` |
| 2 | Déclaration par le client depuis « Mon compte » ou le lien de suivi : articles, motif, description, jusqu'à 3 photos. Suivi du statut et de la décision ; réponse en ligne aux vérifications qui l'attendent. | `returns/customer.ts`, `app/retours/actions.ts`, `components/returns/customer-returns.tsx` |
| 2 | Accès limité à ses propres commandes (réponse « introuvable » sinon). Le motif d'une décision n'est montré au client qu'en cas de refus, et aucune note interne n'est exposée. | `returns/customer.ts` |
| 2 | Photos : format réel contrôlé (JPEG, PNG, WebP), 2 Mo chacune, 3 par envoi, 9 par retour. Elles sont stockées en privé (`retours/`), jamais servies par `/medias`. Le personnel (`orders.read`) les consulte par une route dédiée, et chaque consultation est journalisée. Le fichier est retiré si l'enregistrement échoue. Contrainte et ajout seul en base. | `storage/return-photos.ts`, `storage/storage.ts`, `/admin/retours/[id]/photos/[photoId]` |
| 2 | Limites anti-abus **atomiques** : 10 envois par heure et par connexion ; une enveloppe commune de 60 par heure sans adresse IP fiable ; 2 demandes du client en cours par commande. Le comptage et l'écriture se font dans une même transaction, après un verrou consultatif propre à la connexion (`pg_advisory_xact_lock`), puis le verrou de la ligne de commande, toujours dans cet ordre (aucun interblocage, aucune reprise nécessaire en lecture validée). Les connexions différentes ne s'attendent pas. Un dépassement est renvoyé comme erreur `RATE_LIMITED` (action serveur : message affiché au client, pas de code HTTP dédié). Les photos ne sont lues qu'après les contrôles d'accès et de limites. Une déclaration en double n'enregistre qu'un retour. | `returns/customer.ts` |
| 2 | Accusé de réception, demande d'informations et décision envoyés au client par e-mail (seulement si le service est configuré). Jamais de remboursement automatique. | `notifications/return-templates.ts` |
| 2 | Validation indépendante étendue : un employé qui déclare en ligne sur sa propre commande n'examine pas ce retour (service et trigger `returns_check_customer_declarer`). | `returns/service.ts`, migration |
| 3 | Jours fériés déduits par le calcul centralisé des heures ouvrables (Dakar). Calendrier administrable, sans jour pré-rempli. Horaires par défaut : **ceux de la phase 9 conservés (lundi–samedi, 8 h – 18 h)** ; la proposition lundi–vendredi, 9 h – 17 h n'est pas approuvée formellement (divergence documentée dans `docs/03`, § 4). | `lib/business-hours.ts`, `settings/schemas.ts`, `/admin/parametres` |
| 4 | Relances des vérifications sans réponse, configurables (12, 24 et 48 heures ouvrables) : relance 1 et 2 au client et au responsable demandeur (aux administrateurs s'il n'est plus joignable), puis escalade aux administrateurs. Chaque palier n'est envoyé qu'une fois, sous verrou, avec un palier croissant en base. Les relances s'arrêtent à la réponse. Aucune annulation. Une tâche lancée en retard envoie seulement le palier atteint. | `returns/reminders.ts`, `scripts/expire-orders.ts` |
| 4 | Notifications internes : encart « Alertes retours » du tableau de bord (escalades, retards de traitement, relances, demandes en ligne à examiner). | `returns/queries.ts`, `reports/dashboard.ts`, `/admin` |
| 5 | Livreur interne relié à un compte ayant le rôle **Livreur** (`COURIER` : `admin.access`, `deliveries.update_own`). Transporteur externe sans compte. Contrainte `couriers_account_check`. | `deliveries/{service,queries}.ts`, `/admin/livraison` |
| 5 | « Mes livraisons » : le livreur voit seulement ses livraisons. Il part, encaisse le solde de sa livraison en cours, marque la livraison effectuée ou signale un incident. Chaque étape est enregistrée à son nom. Contrôle avant la transaction, puis sous verrou (réassignation, fiche désactivée). Aucun accès aux commandes, à la caisse, aux remboursements ni aux rapports. | `payments/service.ts`, `/admin/mes-livraisons` |

Migrations :
- `20261018120000_return_reminder_events` : valeurs d'énumération, dans une migration séparée.
- `20261018120100_phase10_returns_couriers` : colonnes, `return_attachments`, contraintes et triggers. Elle reprend aussi les retours déjà en vérification. Les livreurs existants deviennent des transporteurs externes.

Les deux migrations sont appliquées sur les bases de développement et de test, et rejouées sur une base de test vide.

**Déploiement :**
1. Lancer `pnpm db:deploy`, puis `pnpm db:seed` (rôle Livreur et nouvelles permissions).
2. Relier les livreurs internes à leur compte.
3. Saisir les jours fériés.

## Isolation des tests E2E (correctif d'audit)

Avant ce correctif, les E2E utilisaient `.env`, donc la **base de développement** (`systelec_dev`). Les deux jours fériés et les délais de relance qu'on y trouve viennent de là (voir plus bas). Désormais :

- la base dédiée est `systelec_e2e`, sur le serveur PostgreSQL de test (`db-test`, port 5434). Elle est créée si elle est absente, jamais supprimée ;
- l'URL est vérifiée **avant toute connexion** (`e2e/support/database-guard.ts`) : nom exact, hôte local, différente des bases de développement (`.env`) et d'intégration (`.env.test`), pas en production. La configuration Playwright elle-même refuse de se charger sinon ;
- l'identité est confirmée par le serveur (`SELECT current_database()`) avant les migrations, les données de démonstration et les tests ;
- la préparation (`e2e/prepare-database.ts`) s'exécute dans la commande du serveur web, **avant** la construction, avec la même base et le même dossier de fichiers (`storage-e2e/`) que le serveur testé et les utilitaires des tests. Aucun serveur déjà lancé n'est réutilisé.

Démonstration exécutée :

- `E2E_DATABASE_URL=<base de dev> playwright test --list` est refusé (« la base doit s'appeler systelec_e2e (reçu : systelec_dev) ») ;
- relevé de la base de développement avant et après la suite E2E complète : 769 utilisateurs, 177 commandes, 2 726 lignes d'audit, dernier paramètre modifié à 17:43:56. Le relevé est identique, et aucun fichier n'a été ajouté dans `storage/` ;
- la base `systelec_e2e` contient les commandes des tests.

## Tests réellement exécutés

| Commande | Résultat |
|---|---|
| `pnpm lint` / `pnpm typecheck` | OK |
| `pnpm exec prisma validate` / `git diff --check` | OK |
| `pnpm test` (unitaires et intégration PostgreSQL ; 19 migrations rejouées sur une base de test vide lors d'un passage précédent) | 63 fichiers, 439 tests réussis |
| `pnpm test:e2e` sur la base isolée `systelec_e2e` (construction comprise) | 90 tests réussis (ordinateur et mobile) |
| `prisma migrate diff` / `migrate status` (base de dev ↔ schéma) | aucun écart |
| Contre-épreuve du quota : verrou et recomptage retirés temporairement | les 3 tests de concurrence échouent ; ils passent une fois le code restauré |

Image Docker, sauvegarde et restauration, performance : voir la section « Stabilisation ».

Nouveaux tests :

- **Unitaires** : jours fériés (férié ouvrable sauté, demande un jour férié, vendredi 16 h + 24 h ouvrables avec et sans lundi férié, férié tombant un dimanche, passage à minuit) ; schémas des jours fériés et des relances ; matrice des rôles (Livreur, exception réservée à l'administrateur principal) ; dossiers privés du stockage.
- **Intégration, décision 1** (`refund-separation`) : refus journalisé du décideur ; exception de l'administrateur principal (motif obligatoire, tracé) ; double remboursement concurrent ; contournement SQL refusé ; motif figé.
- **Intégration, quotas concurrents** (`customer-returns`) : 6 demandes simultanées sur une commande donnent exactement 2 acceptées, sans photo orpheline ; 5 demandes simultanées d'une même connexion sur plusieurs commandes du même client ne dépassent jamais la limite horaire ; l'enveloppe sans adresse IP tient sous concurrence ; des connexions différentes passent toutes (pas de blocage excessif).
- **Unitaires, isolation E2E** (`tests/policy/e2e-database-guard.test.ts`) : refus des bases de développement et d'intégration, d'un nom voisin, d'une base distante, de la production, d'une URL absente, invalide ou non PostgreSQL.
- **Intégration, décision 2** (`customer-returns`) : compte et lien invité ; accès d'autrui refusé ; photos invalides refusées avant stockage ; nettoyage des fichiers sur échec ; double envoi ; limites ; hors délai ; suivi et réponse ; confidentialité des notes ; inspection en boutique ; employé déclarant ; enveloppe sans adresse IP ; contrôles en base.
- **Intégration, décision 4** (`verification-reminders`) : paliers ; arrêt à la réponse ; tâche lancée en retard ; inspection ; concurrence ; responsable désactivé ; paramètres et jours fériés ; alertes du tableau de bord ; contrôles en base.
- **Intégration, décision 5** (`couriers`) : fiche du livreur ; parcours complet tracé ; incident ; livraison d'autrui ; réassignation ; fiche désactivée ; moindre privilège.
- **E2E** (`returns-deliveries.spec.ts`) : retour déclaré en ligne avec photo, alerte au tableau de bord, photo inaccessible sans session, vérification et réponse du client, décision puis remboursement par deux personnes ; livreur interne de bout en bout avec refus d'accès aux autres écrans ; paramètres (jours fériés, relances, validations) et dossier privé non servi.

## Revues

Une revue de code et une revue de sécurité ont été menées sur le diff : aucun point CRITICAL ni HIGH. Points corrigés, avec tests :

- **MEDIUM (code)** : la migration échouait sur une base contenant un retour déjà en vérification. Elle reprend désormais ces retours avant les contraintes.
- **MEDIUM (sécurité)** : un employé pouvait déclarer en ligne sur sa propre commande, puis décider ce retour. Il est maintenant refusé dans le service et en base.
- **MEDIUM (sécurité)** : la limite d'envois était inopérante sans adresse IP ; une enveloppe commune s'applique désormais. La limite par commande est revérifiée sous verrou.
- **MEDIUM (sécurité)** : les photos étaient lues avant le contrôle d'accès. Elles ne sont plus lues ni stockées qu'après les contrôles d'accès, de limites et de statut.
- **LOW** :
  - une fiche de livreur désactivée laissait son compte agir ;
  - les consultations de photos n'étaient pas journalisées ;
  - `keyFromMediaUrl` acceptait une clé privée ;
  - le texte de l'escalade était inexact après une tâche lancée en retard.

Non corrigé (risque faible) :

- Les tentatives refusées (jeton faux, validation) ne comptent pas dans la limite par connexion : seules les opérations réussies sont journalisées. La taille des envois reste bornée à 7 Mo par la configuration.
- Photos non ré-encodées (métadonnées EXIF conservées). Elles restent privées.
- Sur la fiche d'un retour déclaré en ligne par un employé, les boutons de décision s'affichent à cet employé, mais le service refuse l'action.
- **Données de test dans la base de développement** (laissées par les passages E2E antérieurs au correctif). *Mise à jour du 2026-10-18 : les paramètres de test (`businessHours`, `returnReminders`, `company`) ont été supprimés avec l'accord du propriétaire, après sauvegarde, avec une entrée d'audit `settings.cleanup` ; les comptes, commandes et photos de test restent.* État initial :
  - paramètres `businessHours` (lundi–vendredi, 9 h – 17 h, jours fériés 2026-04-04 et 2026-12-25) et `returnReminders`. D'après l'audit, ils ont été écrits uniquement par le compte de test « Admin P10 » (`e2e-p10-…@example.sn`). Tant qu'ils restent, ils masquent le défaut de la phase 9 sur la base de développement ;
  - comptes et commandes de test ;
  - 4 photos dans `storage/retours/`.

  Retrait proposé, à valider par le propriétaire, sur la base de développement seulement : supprimer ces deux lignes de `site_settings` (retour aux valeurs par défaut, sans perte de donnée réelle), ou corriger les horaires depuis **Paramètres**, ce qui est audité.

## Historique Git

Commits de la branche `feat/phase-10-retours-livraisons`, au-dessus de `7ecdedf` (inchangé, pointe de `fix/phase-9-decisions`) :

| Commit | Message |
|---|---|
| `172f0d0` | test: isolation des E2E sur une base dédiée vérifiée |
| `5e5c5d8` | feat: heures ouvrables avec jours fériés |
| `c4b4281` | fix: versionner le module de stockage src/server/storage |
| `6ec70f9` | feat: phase 10 retours et livraisons |
| (ce commit) | docs: décisions et rapport de la phase 10 |

**Problème préexistant découvert à la préparation des commits** : la règle `storage/` du `.gitignore`, prévue pour les fichiers téléversés, excluait aussi `src/server/storage/`. Le module de stockage (images, logos) n'avait donc jamais été versionné depuis la phase 5, et un clone du dépôt distant ne compilait pas. `c4b4281` ancre les règles à la racine et ajoute le module dans son état antérieur à la phase 10 ; `6ec70f9` y ajoute les dossiers privés. Conséquence : les branches déjà poussées (phases 5 à 9) et les commits `7ecdedf` et `5e5c5d8` ne compilent pas depuis un clone. Le correctif ne s'applique qu'à partir de `c4b4281`.

Contrôles des commits intermédiaires (arbre de travail séparé, client Prisma régénéré) :
- `5e5c5d8` : tests unitaires réussis (153). Le typecheck échoue, mais uniquement à cause du module de stockage absent (problème ci-dessus) ;
- `c4b4281` : typecheck OK et tests unitaires réussis (159) ;
- `6ec70f9` : arbre identique à celui des contrôles complets (439 tests, 90 E2E).

## Procédure : relier les livreurs internes à leur compte

1. Déployer : `pnpm db:deploy`, puis `pnpm db:seed` (crée le rôle **Livreur** et les permissions `deliveries.update_own` et `returns.refund_own_decision`). Les livreurs existants sont repris comme **transporteurs externes** ; leurs livraisons et leur historique sont conservés.
2. Pour chaque livreur interne : créer ou retrouver son compte individuel (inscription), puis, dans **Utilisateurs**, lui attribuer **uniquement** le rôle **Livreur** (un administrateur).
3. Dans **Livraison et retrait → Livreurs**, ouvrir la fiche du livreur : choisir **Type : Livreur interne (compte)** et son **compte**, puis enregistrer. Le service refuse un compte inactif, hors du personnel, sans le rôle Livreur, ou déjà relié à une autre fiche. L'opération est auditée (`courier.update`).
4. Contrôler : le livreur, connecté, voit « Mes livraisons » et seulement ses livraisons. Les écrans Commandes, Encaissements et Retours lui sont refusés. Le journal d'audit trace ses départs, encaissements et livraisons à son nom.
5. Un livreur qui quitte l'entreprise : désactiver sa fiche (son compte ne peut plus agir sur ses livraisons) et son compte utilisateur.

## Stabilisation

**Branche :** `feat/phase-10-stabilisation` (depuis `feat/phase-10-retours-livraisons`, `dbf8564`). Guide d'exploitation : `docs/04-mise-en-service.md`. Toutes les vérifications ci-dessous ont été exécutées sur ce poste (8 cœurs, 7 Go), dans des projets Docker et des bases **jetables** : pile de production `sama-prodtest`, bases `systelec_smoke`, `systelec_e2e`. La base de développement n'a pas été touchée.

### Livré

| Chantier | Élément | Fichiers |
|---|---|---|
| Image | Construction en plusieurs étapes, image de base épinglée par empreinte. Cible `app` : serveur `standalone`, utilisateur non-root (uid 1001), code en lecture seule, sonde de santé, npm et corepack retirés, paquets Alpine mis à jour (329 Mo). Cible `tools` : migrations, données de base, administrateur, tâche planifiée. Aucun secret dans l'image, droits des sources normalisés (indépendants de l'hôte). | `Dockerfile`, `.dockerignore`, `next.config.ts` |
| Déploiement | `docker-compose.prod.yml` : base sans port publié ; application en lecture seule, sans capacité Linux, écoutant seulement en local ; services `migrate` (propriétaire) et `tasks` (rôle restreint). Modèle de configuration fourni. | `docker-compose.prod.yml`, `.env.production.example` |
| Base | Rôle PostgreSQL restreint de l'application : lecture et écriture, sans vidage de table, sans droits sur le schéma, sans accès à l'historique des migrations ; droits automatiques sur les tables futures. | `scripts/ops/app-role.sql` |
| Sauvegarde | Sauvegarde (dump PostgreSQL et fichiers, empreintes SHA-256, contrôle de lisibilité), restauration vers une base et un dossier neufs (aucun écrasement), comparaison table par table. | `scripts/ops/{backup,restore,verify-restore}.sh` |
| Performance | Volume de test (garde-fou par nom de base), scénario k6 avec seuils d'acceptation. Correctif issu de la mesure : réserve de connexions (connexions inactives conservées 5 min, attente bornée à 10 s, taille configurable `DATABASE_POOL_MAX`), `UV_THREADPOOL_SIZE=16`. | `scripts/perf/*`, `src/server/db/client.ts`, `src/lib/env.ts` |
| CI | Tâche `image` : construction des deux cibles et analyse Trivy (vulnérabilités et secrets) bloquante au niveau élevé ou critique. | `.github/workflows/ci.yml` |
| Dépôt | `/sauvegardes/` et `*.dump` ignorés (un dossier de sauvegarde de la base de développement s'y trouvait, non suivi) ; modèle `.env.production.example` versionnable. | `.gitignore` |

### Vérifications réellement exécutées

| Vérification | Résultat |
|---|---|
| Construction des cibles `app` et `tools` sans base de données | OK (toutes les pages rendues à la demande, aucune donnée figée) |
| Image `app` en production (`systelec_smoke`) | santé `ok`, `healthy` ; en-têtes CSP avec nonce, HSTS, `X-Frame-Options`, `nosniff`, `Referrer-Policy`, `Permissions-Policy` ; uid 1001 ; code en lecture seule ; photos privées en 404 |
| Pile `docker-compose.prod.yml` complète (projet jetable) | migrations (propriétaire), rôle restreint, données de base, application `healthy` (racine en lecture seule, `cap_drop: ALL`), tâche planifiée OK, base sans port publié |
| Rôle restreint | application, tâche planifiée et données de base OK ; migrations refusées (voulu) ; vidage du journal d'audit refusé ; suppression dans le journal bloquée par son trigger ; création, modification et suppression de tables refusées ; historique des migrations inaccessible ; table créée ensuite accordée automatiquement, sans vidage possible |
| Exercice sauvegarde et restauration | sauvegarde (51 tables, 19 migrations, empreintes) ; restauration dans une base neuve ; **contenu identique (51 tables, 312 lignes, MD5 par table)** ; fichier témoin restauré ; écrasement refusé (base existante, base en service) ; application démarrée sur la base restaurée (santé `ok`) ; triggers actifs dans la copie ; contre-épreuve : une ligne ajoutée est détectée (code de sortie 1) |
| `shellcheck` 0.10 (scripts d'exploitation) | aucun avertissement |
| Test de charge k6, 5 000 produits, 30 utilisateurs, 2 min 15 s | **avant correctif** : 4 échecs, maximum 56 s (résolution DNS du service `db` à chaque reconnexion) ; **après** : 9 224 requêtes, 0 échec, 68 requêtes/s, 95e centile de 360 à 579 ms selon la page, maximum 693 ms. Tous les seuils sont tenus. |
| Trivy (image `app`) | avant : 8 vulnérabilités élevées (npm de l'image de base) et 1 moyenne (zlib) ; **après : aucune vulnérabilité**, aucun secret ; Dockerfile sans erreur de configuration |
| `pnpm audit` | 3 alertes élevées et 1 moyenne, dans les outils seulement : `mysql2` et `deepmerge-ts` via la ligne de commande Prisma (versions épinglées par Prisma, absentes de l'image `app`), `braces` via ESLint |
| Lint, typecheck, `prisma validate`, `git diff --check` | OK |
| `pnpm test` | 63 fichiers, 440 tests réussis |
| `pnpm test:e2e` (base isolée) | 90 tests réussis ; base de développement inchangée |

Non exécuté : reverse proxy TLS avec un vrai domaine ; recopie des fichiers restaurés dans le volume en service et bascule `POSTGRES_DB` (étapes 4 et 5 de la restauration d'incident, documentées) ; copie des sauvegardes hors serveur (outil à choisir) ; charge des écrans d'administration (connexion requise) ; tâche CI `image` (*exécutée depuis : verte sur les PR #1 et #2 et sur `main`*).

### Risques résiduels

- `no-new-privileges` n'a pas pu être activé : sur ce poste, l'option empêche tout démarrage de conteneur, même pour les images officielles (interaction noyau, AppArmor et Docker). Elle est documentée, à tester puis activer sur le serveur cible.
- Dépendances d'outillage signalées par `pnpm audit` (voir ci-dessus) : à suivre avec les mises à jour de Prisma et d'ESLint.
- Le test de charge porte sur les pages publiques, avec un seul processus applicatif sur une machine partagée ; les écrans d'administration n'ont pas été mesurés.
- Pas de copie automatique hors serveur ni de rotation automatique : volontairement laissées à l'outil choisi à l'installation.
- L'image `tools` est volumineuse (environ 2,3 Go, dépendances de développement incluses) : acceptable pour un usage ponctuel.

## Reste à décider ou à faire

- **Stabilisation réalisée et vérifiée** sur poste (section ci-dessus). Avant la mise en production réelle : installation sur le serveur cible selon `docs/04-mise-en-service.md` (TLS, sauvegarde copiée hors serveur, exercice de restauration sur le serveur, test `no-new-privileges`), puis recette par le propriétaire.
- ~~Trancher la divergence d'horaires~~ : tranché, horaires de la phase 9 conservés (`docs/03`, décision 3).
- Retrait des données de test de la base de développement (voir ci-dessus).
- Envoi SMS ou WhatsApp des notifications : aucun fournisseur n'est configuré (D11).
- *Ajout du 2026-10-19* : l'adaptateur e-mail n'existait pas (contrairement à ce qu'indiquait D11). Il est livré par la branche `feat/adaptateur-email` (SMTP générique, Brevo comme fournisseur de départ). Hébergement confirmé : serveur Docker en Europe (`docs/03`, D10).
- Accès du client aux photos qu'il a envoyées (non proposé aujourd'hui).
