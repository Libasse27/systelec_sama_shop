# Phase 0 — Diagnostic du dépôt

Date : 2026-10-13

## 1. État réel du dépôt

| Élément | Constat |
|---|---|
| Branche | `main` (seule branche, suivie par `origin/main`) |
| Distant | `https://github.com/Libasse27/systelec_sama_shop.git` |
| Historique | 1 commit (`0a48c1a first commit`) |
| Contenu | Un unique fichier `README.md` **vide** |
| Code applicatif | Aucun |
| Tests | Aucun |
| CI | Aucune |
| Documentation | Aucune (hors ce dossier `docs/`) |

**Conclusion : dépôt vierge.** Aucun travail existant à préserver ni à migrer. La structure sera créée de zéro, conformément au §25 du cahier des charges.

## 2. Environnement de développement

| Outil | Version détectée | Commentaire |
|---|---|---|
| Node.js | 24.21.0 | Ligne LTS active, compatible Next.js / Prisma |
| npm | 11.19.0 | Disponible |
| pnpm | 12.9.1 | **Retenu** comme gestionnaire de paquets (rapide, strict sur les dépendances) |
| corepack | 0.36.0 | Permet de figer la version de pnpm via `packageManager` |
| Docker | 29.9.0 | Opérationnel (accès au démon vérifié) |
| Docker Compose | v5.6.0 | Utilisé pour PostgreSQL en dev/test |
| PostgreSQL client | absent | Non bloquant : PostgreSQL tournera dans un conteneur |

## 3. Technologies présentes

Aucune. La stack cible est celle du cahier des charges (voir `01-architecture.md`).

## 4. Fonctionnalités existantes

Aucune.

## 5. Lacunes et risques

| # | Risque | Impact | Mesure |
|---|---|---|---|
| R1 | Périmètre très large (boutique, back-office, stock, encaissements, devis, interventions, rapports) | Délai, dette | Livraison par phases avec tests à chaque étape ; monolithe modulaire |
| R2 | Concurrence sur le stock (deux clients sur la dernière unité) | Survente | Transactions + verrouillage de ligne (`SELECT … FOR UPDATE`) + contrainte `CHECK (on_hand >= reserved >= 0)` |
| R3 | Confusion « commande créée » / « payée » | Erreurs financières | Statuts séparés commande / livraison / paiement ; statut de paiement **dérivé** des encaissements valides |
| R4 | Fraude ou erreur d'encaissement espèces | Pertes | Permission `payments.record`, encaissements immuables, correction uniquement par contre-écriture, audit |
| R5 | Manipulation du prix côté client | Pertes | Le serveur ignore tout prix/total reçu et recalcule depuis la base |
| R6 | Fuite de données entre clients (IDOR) | Légal, réputation | Toute requête client filtrée par `customerId` de la session ; tests d'isolation dédiés |
| R7 | Données commerciales inconnues (zones, frais, adresse de retrait, coordonnées, mentions légales, TVA) | Blocage mise en prod | Paramètres administrables ; données de démo séparées et marquées ; décisions demandées (`03-decisions.md`) |
| R8 | Protection des données personnelles (loi sénégalaise n° 2008-12, CDP) | Légal | Minimisation des données, politique de conservation, export/suppression ; la déclaration CDP relève du propriétaire |
| R9 | Connexions mobiles lentes | Conversion | Rendu serveur, images optimisées, JS client minimal |
| R10 | Hébergement non défini | Choix stockage fichiers / sauvegardes | Abstraction de stockage ; décision demandée |
| R11 | Aucun fournisseur e-mail/SMS configuré | Notifications non envoyées | Notifications persistées avec statut explicite « non envoyée — fournisseur non configuré » ; aucun envoi simulé |
