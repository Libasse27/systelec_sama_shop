# Plan de développement et décisions

## 1. Plan par phases (nouveau projet, dépôt vierge)

| Phase | Contenu | Livrable vérifiable | Tests clés (§20) |
|---|---|---|---|
| 0 | Audit | `docs/00` à `03` | — |
| 1 | Conception | Architecture, modèle, règles, critères d'acceptation (ce dossier) | — |
| 2 | Socle | Next.js + TS strict + Tailwind + shadcn, Prisma + PostgreSQL Docker, migrations, `.env.example`, config validée par Zod, Vitest/Playwright, CI GitHub Actions | 28 (build) |
| 3 | Auth & permissions | Inscription/connexion/déconnexion/réinitialisation, 10 rôles + permissions, garde serveur, commande CLI de création du premier super-admin (mot de passe saisi, jamais prédéfini), audit des connexions | 1, 2, 3, 24 |
| 4 | Boutique publique | Accueil, catalogue, catégories, recherche/filtres/tri/pagination, fiches produits & services, pages CMS, SEO (métadonnées, sitemap, robots, JSON-LD), 404, mobile d'abord | 27 |
| 5 | Produits & stocks | Admin catalogue, images, variantes, prix, promotions, stock (entrées/sorties/corrections motivées), alertes, inventaire, import/export CSV | 4, 5, 6 |
| 6 | Panier & commandes | Panier, checkout invité/compte, livraison/retrait, zones & frais, total serveur, idempotence, réservation stock, historique, notifications (persistées) | 7–14, 17, 25 |
| 7 | Encaissements | Enregistrement espèces, partiel si activé, reçus PDF, soldes, annulation par contre-écriture, contrôle d'accès | 15, 16, 26 |
| 8 | Services techniques | Demandes de devis, devis détaillés, acceptation, interventions, planning, techniciens, rapports, pièces, facturation, encaissement après prestation | 19, 20, 21 |
| 9 | Admin avancée | Tableau de bord, utilisateurs/rôles, livraisons, retours, rapports financiers, exports PDF/CSV/Excel, contenu, paramètres, consultation audit | 18, 22, 23 |
| 10 | Stabilisation | E2E complets, revue sécurité, performance, Dockerfile prod, sauvegarde/restauration testées, guides, procédure de mise en service | tous |

Chaque phase se termine par : tests réellement exécutés, revue de code, rapport de phase (`docs/rapports/phase-N.md`), mise à jour de la liste des tâches.

## 2. Décisions nécessitant votre approbation

Les choix techniques réversibles (bibliothèques, structure) sont documentés dans `01-architecture.md`. Les points ci-dessous relèvent du propriétaire. La **recommandation** sera appliquée par défaut, sous forme de paramètre modifiable, si aucune autre décision n'est donnée.

### Commerciales

| # | Question | Recommandation |
|---|---|---|
| D1 | Commande en tant qu'invité autorisée ? | Oui (téléphone obligatoire), paramétrable |
| D2 | Paiement partiel en espèces activé au lancement ? | Non (désactivé, activable par l'admin) |
| D3 | Politique de réservation du stock | Réservé dès la création de la commande ; libéré à l'annulation ou après 48 h sans confirmation (durée paramétrable) |
| D4 | Point de retrait : adresse, horaires, téléphone ? Espèces au retrait ? | Option masquée tant que l'adresse n'est pas renseignée ; espèces au retrait autorisées |
| D5 | Zones de livraison, frais, seuils de gratuité, délais | À fournir par SYSTELEC. En attendant : données de démo marquées « DÉMO », jamais chargées en production |
| D6 | TVA (18 % au Sénégal) : prix TTC ? TVA détaillée sur factures ? | Prix saisis et affichés TTC ; détail TVA désactivé tant que non validé avec votre comptable |
| D7 | Mentions légales des factures/reçus (NINEA, RCCM, raison sociale) | À fournir ; champs administrables |
| D8 | Avis clients | Désactivés au lancement ; plus tard, achats vérifiés et modérés uniquement |

### Sécurité / données / infrastructure

| # | Question | Recommandation |
|---|---|---|
| D9 | Identifiant de connexion client : e-mail ou téléphone ? | E-mail + mot de passe au lancement ; téléphone (OTP SMS) plus tard, nécessite un fournisseur SMS |
| D10 | Hébergement cible | VPS (Docker Compose : app + PostgreSQL + sauvegardes automatiques). Alternative : Vercel + PostgreSQL managé (stockage fichiers externe obligatoire). **Confirmé le 2026-10-19 après audit** : serveur Docker en Europe, maintenu par le propriétaire ; Vercel écarté (stockage local, tâche planifiée toutes les 15 min, envois jusqu'à 7 Mo, sauvegardes Docker) |
| D11 | Fournisseurs e-mail (SMTP) / SMS / WhatsApp Business | **E-mail** : adaptateur SMTP générique (`notifications/mailer.ts`, nodemailer), inactif tant que `SMTP_HOST` est vide ; fournisseur de départ **Brevo** (retenu le 2026-10-19). Échec d'envoi tracé (`FAILED`), jamais simulé, puis **renvoyé automatiquement** par la tâche planifiée (15 min, 1 h, 4 h ; 4 envois au plus ; jamais après un refus définitif 550/551/553). **SMS / WhatsApp** : aucun adaptateur ni fournisseur, notifications tracées `SKIPPED_NO_PROVIDER` |
| D12 | Conservation des données clients inactifs | 3 ans après la dernière commande, puis anonymisation (déclaration CDP à votre charge) |

### Identité & processus

| # | Question | Recommandation |
|---|---|---|
| D13 | Logo et couleurs | Logo provisoire typographique remplaçable depuis l'admin ; bleu nuit / bleu électrique / accent orange limité |
| D14 | Flux Git | Une branche par phase (`feat/phase-2-socle`…), commits conventionnels, fusion dans `main` après validation. Aucun push sans votre accord |

## 3. Décisions du propriétaire (phase 9)

Décisions ouvertes à la fin de la phase 9 (voir `docs/rapports/phase-9.md`), tranchées par le propriétaire et appliquées sur la branche `fix/phase-9-decisions` (section « Correctifs post-phase 9 » du rapport).

| # | Question | Décision finale | Mise en œuvre |
|---|---|---|---|
| 1 | Plafond de remboursement d'un retour | **Validé tel quel** : prix payés, remise de la commande déduite au prorata (arrondi en faveur de la boutique), frais de livraison non remboursés par le plafond automatique ; jamais plus que les espèces encore détenues pour la commande | `returns/refund-cap.ts`, `returns/service.ts` (inchangés) |
| 2 | Une même personne peut-elle créer et décider un retour ? | **Non** : politique de retours ci-dessous (délais, vérification, validation indépendante, remboursement séparé, historique, exceptions) | `returns/*`, permission `returns.decide`, migration `*_owner_decisions` |
| 3 | Motif d'échec de livraison et nom de la personne qui a reçu le colis montrés au client | **Validé tel quel** ; les observations de livraison restent internes | `deliveries/service.ts` (inchangé) |
| 4 | Logo hébergé sur un autre site | **Non** : logo **téléversé uniquement** (validation, écran, contrainte en base ; une adresse externe déjà enregistrée est retirée par la migration, auditée). Ajout d'une section **Partenaires** (nom, site https facultatif, logo téléversé, actif, ordre), administrée par `content.manage` et affichée sur l'accueil seulement s'il y a des partenaires actifs. **Aucun logo externe, nulle part** | `settings/*`, `partners/*`, `storage/logo-upload.ts`, `/admin/contenu`, accueil |
| 5 | Clôture manuelle d'une commande à livrer sans livreur | **Non** : une commande en mode livraison est **toujours** remise au client par un livreur (livraison marquée effectuée). Le retrait en boutique n'est pas concerné | `orders/status.ts`, trigger `orders_delivery_closed_by_courier` |
| 6 | Bibliothèque Excel | **Validé** : `write-excel-file` (au lieu d'`exceljs`, non maintenu) | inchangé |

### Politique de retours (décision 2)

1. **Délai de déclaration.** Un produit endommagé, défectueux ou non conforme se déclare dans les **48 heures** qui suivent la remise au client : livraison effectuée ou retrait en boutique (date de clôture de la commande). Ce délai commercial **ne limite pas les droits légaux du client** (voir le point 7).
2. **Délai de traitement.** Le personnel dispose de **24 heures ouvrables** à compter de la déclaration pour commencer le traitement (première action : demande de vérification ou décision). Passé ce délai, la demande **reste ouverte** et **une seule alerte** est envoyée aux administrateurs actifs (tâche planifiée `pnpm orders:expire`). Un retour n'est **jamais annulé ni décidé automatiquement**. Les heures ouvrables sont un paramètre administrable (**Paramètres → Heures ouvrables**) : jours ouvrables et une ou deux plages horaires, heure de Dakar. Valeur par défaut : **du lundi au samedi, de 8 h à 18 h** (conservée en phase 10, voir § 4, décision 3). Depuis la phase 10, les **jours fériés** du calendrier administrable **sont déduits**.
3. **Validation indépendante.** La personne qui déclare un retour ne peut ni l'accepter ni le refuser. Seul un autre responsable disposant de la permission `returns.decide` (gestionnaire de commandes, administrateurs) décide. Le refus est journalisé (`authz.denied`), vérifié sous verrou et contrôlé en base.
4. **Vérification.** Avant de décider, le responsable peut demander une **inspection physique**, des **photos**, une **facture** ou des **informations complémentaires** (statut « Vérification demandée », nature et précisions). La réponse ou le résultat est ensuite enregistré (par un responsable, ou par la personne qui reçoit les éléments du client), et le retour revient « à vérifier ».
5. **Remboursement.** Jamais déclenché automatiquement : l'acceptation fixe un montant (dans les plafonds de la décision 1), puis une **validation distincte et explicite** par une personne autorisée (`payments.correct`) verse le remboursement en espèces, avec son reçu.
6. **Traçabilité.** Chaque retour a son **historique propre** (déclaration, vérification, réponse, décision, remboursement, alerte de délai : utilisateur, date, statut, motif, décision), en **ajout seul** en base, affiché sur la fiche du retour, en plus du journal d'audit.
7. **Exceptions.** Une déclaration hors délai est **enregistrée** et marquée **« hors délai »** (indicateur visible et filtrable). Un responsable autorisé peut l'examiner et l'**accepter**, notamment au titre de la **garantie**, d'un **vice caché** ou d'une **obligation légale**, avec un **fondement et un motif d'exception obligatoires**.

Déclaration : le **personnel déclare le retour au nom du client** (fiche de la commande, `orders.update`) ; depuis la phase 10 (décision 2, § 4), le **client peut aussi déclarer lui-même** depuis son compte ou son lien de suivi.

## 4. Décisions du propriétaire (phase 10)

Questions restées ouvertes après les correctifs de la phase 9 (« Reste à décider » de `docs/rapports/phase-9.md`), tranchées par le propriétaire et appliquées sur la branche `feat/phase-10-retours-livraisons`. Détail, tests et limites : `docs/rapports/phase-10.md`. Les travaux de stabilisation prévus en phase 10 (§ 1) ont été menés sur la branche `feat/phase-10-stabilisation` : image Docker de production, rôle PostgreSQL restreint, sauvegarde et restauration testées, test de charge, analyse de vulnérabilités, guide `docs/04-mise-en-service.md`. L'installation sur le serveur cible et la recette restent à faire.

| # | Question | Décision finale | Mise en œuvre |
|---|---|---|---|
| 1 | Validation du retour et remboursement par deux personnes ? | **Oui.** La personne qui a décidé le retour ne verse pas le remboursement : une autre personne autorisée (`payments.correct`) le fait. **Exception contrôlée** (un seul administrateur disponible) : permission `returns.refund_own_decision`, réservée à l'**administrateur principal**, et **motif obligatoire**, inscrit sur le retour, dans son historique et au journal d'audit. Double remboursement impossible (unicité en base, verrou, idempotence) | `returns/service.ts` (`refundReturn`), trigger `returns_check_update`, `authz/{permissions,roles}.ts` |
| 2 | Le client déclare-t-il lui-même un retour ? | **Oui**, depuis « Mon compte » ou son **lien de suivi** (jeton signé) : articles et quantités, motif, description, **jusqu'à 3 photos** (JPEG, PNG ou WebP reconnus sur leur contenu, 2 Mo chacune), suivi du statut et de la décision, **réponse en ligne** aux vérifications qui l'attendent (photos, facture, informations). Seulement sur **ses** commandes (sinon « introuvable »). Photos **privées** (jamais servies par `/medias`, lues par le personnel `orders.read` seulement). Envois limités (10 par heure et par connexion, 2 demandes du client en cours par commande). **Jamais de remboursement automatique.** Le délai commercial de 48 h s'applique sans limiter les droits légaux (déclaration tardive enregistrée et signalée). Le personnel peut toujours déclarer au nom du client. Le motif d'une décision n'est communiqué au client qu'en cas de **refus** | `returns/customer.ts`, `storage/return-photos.ts`, `app/retours/actions.ts`, `components/returns/customer-returns.tsx`, route `/admin/retours/[id]/photos/[photoId]` |
| 3 | Jours fériés déduits des heures ouvrables ? | **Oui.** Calcul **centralisé** (`lib/business-hours.ts`) pour tous les délais des retours (traitement et relances). Fuseau `Africa/Dakar`. **Horaires par défaut : ceux de la phase 9 (lundi à samedi, 8 h – 18 h), conservés** ; dimanche exclu ; **calendrier des jours fériés** administrable (**Paramètres → Heures ouvrables et jours fériés**, une date par ligne). Aucun jour férié n'est pré-rempli : les fêtes mobiles changent chaque année | `lib/business-hours.ts`, paramètre `businessHours.holidays` |
| 4 | Relancer les vérifications sans réponse ? | **Oui**, en heures ouvrables depuis la demande, **configurables** (**Paramètres → Relances des vérifications**) : **12 h** relance 1 (client, s'il est concerné et a un e-mail, et responsable qui a demandé la vérification), **24 h** relance 2, **48 h** **escalade** aux administrateurs. Chaque palier une seule fois (verrou, palier croissant en base), inscrit à l'historique ; tout s'arrête dès la réponse ; la demande reste ouverte, jamais annulée. **Notifications internes** : encart « Alertes retours » du tableau de bord ; e-mail seulement si le service est configuré. L'inspection physique (en boutique) ne relance pas le client | `returns/reminders.ts`, `pnpm orders:expire`, `returns/queries.ts` (`getReturnAlerts`) |
| 5 | Relier chaque livreur à un compte ? | **Oui pour les livreurs internes** : compte individuel avec le rôle **Livreur** (`COURIER` : `admin.access`, `deliveries.update_own`). Il voit **ses** livraisons (« Mes livraisons »), part, **encaisse le solde de sa livraison en cours** (choix du propriétaire), marque la livraison effectuée ou signale un incident ; chaque étape est tracée à son nom. Aucun accès aux remboursements, à la caisse, aux rapports, aux commandes ni aux autres livraisons (contrôlé côté serveur, revérifié sous verrou). Les **transporteurs externes** restent des fiches sans compte, gérées par le responsable des livraisons | `deliveries/{service,queries}.ts`, `payments/service.ts`, `/admin/mes-livraisons`, `/admin/livraison` |

**Divergence d'horaires (à trancher) :** la phase 9 a validé lundi–samedi, 8 h – 18 h ; la proposition de la phase 10 était lundi–vendredi, 9 h – 17 h. Faute d'approbation formelle de la seconde, **le défaut reste celui de la phase 9**. Les horaires et jours ouvrables se changent sans code dans **Paramètres → Heures ouvrables et jours fériés** (audités).

**Quotas des demandes du client :** atomiques (verrou consultatif par connexion puis verrou de la commande, comptage dans la transaction), voir `docs/rapports/phase-10.md`.

**Isolation des tests E2E :** chaque exécution (`pnpm test:e2e`, lanceur `e2e/run.ts`) crée son PostgreSQL jetable (conteneur étiqueté, données en mémoire, port et identifiants aléatoires), marque la base avec son identifiant et revérifie base, utilisateur et marque auprès du serveur avant toute écriture ; dossier de fichiers temporaire et port applicatif propres à l'exécution, build dans `.next-e2e/` (verrou contre deux exécutions simultanées), aucun serveur existant réutilisé. Seules les ressources de l'exécution (étiquette ou préfixe revérifiés) sont supprimées à la fin. Les tests qui modifient des paramètres globaux ne tournent que sur un projet. La base de développement n'est jamais modifiée par les E2E. (Avant : base persistante `systelec_e2e` sur `db-test` et dossier `storage-e2e/` partagés entre exécutions.)

Déploiement : relancer `pnpm db:seed` (rôle `COURIER`, permissions `deliveries.update_own` et `returns.refund_own_decision`), puis relier les livreurs existants (repris comme transporteurs externes) à leur compte.
