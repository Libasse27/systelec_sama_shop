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
| D10 | Hébergement cible | VPS (Docker Compose : app + PostgreSQL + sauvegardes automatiques). Alternative : Vercel + PostgreSQL managé (stockage fichiers externe obligatoire) |
| D11 | Fournisseurs e-mail (SMTP) / SMS / WhatsApp Business | Adaptateurs prêts mais inactifs jusqu'à configuration |
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
2. **Délai de traitement.** Le personnel dispose de **24 heures ouvrables** à compter de la déclaration pour commencer le traitement (première action : demande de vérification ou décision). Passé ce délai, la demande **reste ouverte** et **une seule alerte** est envoyée aux administrateurs actifs (tâche planifiée `pnpm orders:expire`). Un retour n'est **jamais annulé ni décidé automatiquement**. Les heures ouvrables sont un paramètre administrable (**Paramètres → Heures ouvrables**) : jours ouvrables et une ou deux plages horaires, heure de Dakar. Valeur par défaut : **du lundi au samedi, de 8 h à 18 h** (24 heures ouvrables ≈ deux jours et demi d'ouverture). Les **jours fériés ne sont pas déduits** : un jour férié ouvrable dans le paramètre compte comme ouvré.
3. **Validation indépendante.** La personne qui déclare un retour ne peut ni l'accepter ni le refuser. Seul un autre responsable disposant de la permission `returns.decide` (gestionnaire de commandes, administrateurs) décide. Le refus est journalisé (`authz.denied`), vérifié sous verrou et contrôlé en base.
4. **Vérification.** Avant de décider, le responsable peut demander une **inspection physique**, des **photos**, une **facture** ou des **informations complémentaires** (statut « Vérification demandée », nature et précisions). La réponse ou le résultat est ensuite enregistré (par un responsable, ou par la personne qui reçoit les éléments du client), et le retour revient « à vérifier ».
5. **Remboursement.** Jamais déclenché automatiquement : l'acceptation fixe un montant (dans les plafonds de la décision 1), puis une **validation distincte et explicite** par une personne autorisée (`payments.correct`) verse le remboursement en espèces, avec son reçu.
6. **Traçabilité.** Chaque retour a son **historique propre** (déclaration, vérification, réponse, décision, remboursement, alerte de délai : utilisateur, date, statut, motif, décision), en **ajout seul** en base, affiché sur la fiche du retour, en plus du journal d'audit.
7. **Exceptions.** Une déclaration hors délai est **enregistrée** et marquée **« hors délai »** (indicateur visible et filtrable). Un responsable autorisé peut l'examiner et l'**accepter**, notamment au titre de la **garantie**, d'un **vice caché** ou d'une **obligation légale**, avec un **fondement et un motif d'exception obligatoires**.

Déclaration : aujourd'hui, le **personnel déclare le retour au nom du client** (fiche de la commande, `orders.update`). Le client ne déclare pas lui-même en ligne ; un parcours client (formulaire dans « Mon compte » et le suivi invité, avec photos) reste à décider.
