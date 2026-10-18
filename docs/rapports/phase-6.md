# Rapport de phase 6 — Panier et commandes

**Branche :** `feat/phase-6-panier-commandes` · **Date :** 2026-10-14

## Livré

| Élément | Fichiers |
|---|---|
| Modèle : panier, lignes, zones de livraison, points de retrait, clients, commandes, lignes figées, historique des statuts, notifications. Contraintes en base : total = sous-total + frais − remises, montants ≥ 0, ligne = prix × quantité, mode de remise cohérent (zone + adresse, ou point de retrait), quantité du panier 1 à 99, historique **en ajout seul** (trigger) | `prisma/schema.prisma`, migration `*_orders` |
| **Panier** : compte ou visiteur. Le visiteur est identifié par un cookie `httpOnly` aléatoire de 256 bits, dont seule l'empreinte SHA-256 est stockée. Aucun prix n'est stocké : prix et stock sont relus à chaque affichage. Les lignes devenues invendables sont signalées. Quantité plafonnée au stock disponible, 50 lignes maximum, fusion du panier visiteur à la connexion | `src/server/modules/cart/*` |
| **Commande** invitée (si D1 l'autorise) ou avec compte : | `src/server/modules/orders/checkout.ts` |
| — **total recalculé par le serveur** sur les prix en base, et refusé si le sous-total affiché au client a changé | |
| — **réservation du stock** sous verrou de ligne, avec les versions toujours verrouillées dans le même ordre (pas d'interblocage) : aucune survente possible | |
| — **idempotence** : la clé unique fait qu'une double soumission, même simultanée, ne crée qu'une commande | |
| — prix, noms, SKU, prix d'achat (pour la marge), coordonnées et adresse sont figés ; le panier est vidé ; numéro `CMD-AAAA-NNNNNN` | |
| **Livraison et retrait** : zones (frais, livraison offerte au-delà d'un seuil, délai) et points de retrait administrables. Sans point de retrait actif, l'option est masquée (D4) ; sans aucune option, la commande en ligne reste fermée. Données de démonstration « [DÉMO] » séparées (D5) | `orders/delivery-settings.ts`, `/admin/livraison`, `orders/demo.ts` |
| **Statuts** : à confirmer → confirmée → en préparation → prête (retrait ou livraison) → remise au client, avec annulation possible avant la remise (motif obligatoire). L'annulation **libère** le stock et la remise le **sort définitivement** (mouvement `SALE`). Chaque passage est historisé, audité et notifié | `orders/status.ts`, `inventory/reservations.ts` |
| **Expiration des réservations (D3)** : une commande non confirmée après le délai paramétré (48 h par défaut) est annulée et son stock libéré. Commande `pnpm orders:expire`, à planifier | `scripts/expire-orders.ts` |
| **Suivi** : un lien personnel signé par HMAC pour l'invité (rien à stocker, et une double soumission retrouve le même lien), l'historique dans « Mon compte », annulation par le client tant que la commande n'est pas confirmée | `/commande/[numéro]`, `/compte`, `/compte/commandes/[numéro]` |
| **Notifications persistées** : e-mail au client et à la boutique ; SMS tracés comme « aucun fournisseur » (D11). Rien n'est simulé, et chaque état d'envoi est visible dans la fiche de commande | `src/server/notifications/*` |
| Administration : liste des commandes (recherche, filtre), fiche (statuts, historique, notifications), livraison et retrait | `src/app/admin/{commandes,livraison}` |
| Boutique : bouton « Ajouter au panier » sur la fiche produit, panier dans l'en-tête, pages panier, commande et confirmation | `src/app/{panier,commande}`, `src/components/{cart,orders}` |

## Tests réellement exécutés

| Commande | Résultat |
|---|---|
| `pnpm lint` / `pnpm typecheck` | OK |
| `pnpm test` | 36 fichiers, 211 tests réussis (dont intégration PostgreSQL) |
| `pnpm build` | OK (inclus dans `pnpm test:e2e`) |
| `pnpm test:e2e` | 64 tests réussis (bureau et mobile) |

Critères couverts : le texte détaillé du §20 n'est pas dans le dépôt, ils ont été rapprochés du plan de la phase 6.

- **Panier** : ajout, plafond de stock, modification, retrait, fusion à la connexion, ligne devenue indisponible.
- **Commande invitée et avec compte** : bout en bout en E2E, dans les deux cas.
- **Total serveur** :
  - prix modifié entre panier et commande ;
  - sous-total affiché périmé refusé ;
  - livraison offerte au-delà du seuil ;
  - retrait sans frais.
- **Idempotence** : deux soumissions simultanées donnent une seule commande et une seule réservation.
- **Pas de survente** : deux clients simultanés sur le même stock, un seul est servi.
- **Statuts** : transitions invalides refusées, motif d'annulation exigé, droits par rôle ; annulation libératrice, remise au client qui sort le stock ; historique non modifiable.
- **Expiration D3** : seules les commandes non confirmées et expirées sont annulées.
- **Confidentialité** : un client ne voit pas la commande d'un autre ; un lien invité sans jeton valide renvoie une 404.
- **Notifications** : enregistrées, sans fournisseur tracé comme tel.

## Défauts trouvés par les tests et corrigés

- **En-tête mobile** : le nouveau lien « Panier » faisait déborder l'en-tête sur téléphone (« Mon compte » recouvrait « Se déconnecter »). L'en-tête passe à la ligne et le panier n'affiche que son icône sur petit écran, avec un libellé conservé pour les lecteurs d'écran.
- **Annulation par le client** : le message de confirmation disparaissait avec le bouton. L'action redirige désormais vers la commande, qui affiche la confirmation.
- **E2E** : la suite complète faisait ponctuellement échouer des navigations quand la machine était saturée (charge 12 sur 8 cœurs). Aucune fuite de connexions n'a été constatée (au plus 13 connexions, puis retour à 1). Le délai des assertions Playwright passe à 10 s ; trois exécutions complètes sont ensuite passées.

## Revue de code et de sécurité

Deux revues : qualité du code et sécurité. Aucun point CRITICAL. Vérifié sain :

- aucun accès aux commandes d'autrui ;
- aucun prix d'achat ni note interne exposés au client ;
- aucun chemin de paiement électronique ;
- comparaison HMAC à temps constant ;
- ordre des verrous cohérent (commande, puis stock).

Corrigé, avec des tests :

- **Code, HIGH : un même panier soumis depuis deux onglets** (deux clés différentes) pouvait donner deux commandes. Le panier était lu avant tout verrou. Il est désormais verrouillé (`FOR UPDATE`) avant la lecture de ses articles, et un test lance les deux soumissions en parallèle.
- **Sécurité, HIGH : aucune limitation**. Un robot pouvait multiplier les commandes invitées et immobiliser tout le stock. Désormais :
  - 10 commandes par IP et par heure ;
  - 3 commandes en attente par téléphone, comparées sur les seuls chiffres ;
  - purge des paniers expirés avec `pnpm orders:expire`.
- **MEDIUM** :
  - une resoumission invitée ne rend le lien de suivi qu'au navigateur qui détient le panier d'origine (empreinte stockée sur la commande) ;
  - même clé soumise en parallèle : la commande existante est retrouvée sous verrou, au lieu d'une fausse erreur de stock ;
  - l'expiration et l'annulation par le client revérifient leur condition sous le verrou de la commande ;
  - le lien de suivi invité expire après 180 jours.
- **LOW** :
  - fusion des paniers en une transaction, avec plafond commun de 50 lignes ;
  - e-mail réservé avant envoi (pas de double envoi) ;
  - cookie de panier préfixé `__Host-` en production.

Reporté en phase 10 :

- une limitation de débit au niveau du proxy (nginx `limit_req`) sur l'ajout au panier et les formulaires publics ;
- l'effacement du paramètre `jeton` dans les journaux du proxy ;
- un secret dédié aux liens de suivi, distinct de `AUTH_SECRET`.

Note : la migration `*_orders` a été modifiée deux fois avant tout commit (retrait puis ajout d'une colonne). Les bases locales de développement et de test ont été alignées par une modification ciblée (colonne et empreinte de migration), sans réinitialisation. `prisma migrate diff` confirme qu'il n'y a aucun écart.

## Choix et points ouverts

- **Promotions à règles** (pourcentage, période, code) : le calcul est prêt à les recevoir (`discountTotal`, contrainte en base), mais le moteur n'est pas encore écrit. Il demande des décisions métier : cumul, portée, codes. À valider avant de l'implémenter.
- **Encaissement** : `amountPaid` et `paymentStatus` restent à « non payée ». L'enregistrement des espèces, les reçus et le contrôle « payée avant remise » arrivent en phase 7.
- **Livraisons détaillées** (livreur, preuve, échec), **retours** et **adresses enregistrées** : phase 9.
- **Planification** de `pnpm orders:expire` (cron, toutes les 15 minutes environ) : à mettre en place au déploiement (phase 10).
- **E-mails** : enregistrés mais non envoyés tant que le fournisseur SMTP n'est pas choisi (D11).
