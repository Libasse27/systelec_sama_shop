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
