# Rapport de phase 7 — Encaissements

**Branche :** `feat/phase-7-encaissements` · **Date :** 2026-10-14

## Livré

| Élément | Fichiers |
|---|---|
| Modèle `Payment` : reçu numéroté `REC-AAAA-NNNNNN`, montant en FCFA entiers, moyen `CASH` (seul moyen existant), solde après écriture figé, agent, clé d'idempotence, lien de contre-écriture, motif, note interne | `prisma/schema.prisma`, migrations `*_payments` et `*_payments_integrity` |
| **Intégrité en base** : | |
| — journal en **ajout seul** (trigger) | |
| — signe du montant cohérent (encaissement > 0, contre-écriture < 0) et motif obligatoire (CHECK) | |
| — contre-écriture exactement opposée, même commande, jamais d'une contre-écriture (trigger) | |
| — une seule annulation par encaissement (unicité) | |
| — `amountPaid ≤ total`, et `amountPaid` = somme des écritures, vérifié à la validation de chaque transaction (trigger différé) | |
| **Encaissement** (`payments.record`), sous le verrou de la commande : | `src/server/modules/payments/service.ts`, `balance.ts` |
| — seulement sur une commande confirmée et non remise | |
| — jamais au-delà du reste à payer (la monnaie rendue n'est pas encaissée) | |
| — solde complet exigé tant que le paiement partiel est désactivé (D2), acompte possible sinon | |
| — statut de paiement **recalculé** (non payée, partiellement payée, payée), historisé, audité, notifié au client | |
| — idempotence : un double envoi, même simultané, n'encaisse qu'une fois | |
| **Contre-écriture** (`payments.correct`) : nouvelle ligne opposée, liée, avec motif et son propre reçu. L'encaissement d'origine n'est jamais modifié | `voidPayment` |
| **Payée avant remise** : la remise au client est refusée tant que la commande n'est pas soldée. Une commande encaissée ne s'annule qu'après contre-écriture de ses encaissements (espèces rendues) | `src/server/modules/orders/status.ts` |
| **Reçus PDF** (A5) : société, NINEA et RCCM s'ils sont renseignés (D7), commande, client, montant, reste à payer, agent. Le reçu d'annulation cite le reçu annulé et le motif ; le reçu d'origine mentionne son annulation. La note interne n'est jamais imprimée | `payments/receipt-pdf.tsx`, `src/app/recus/[number]/route.ts` |
| **Accès au reçu** : personnel des encaissements, titulaire du compte, ou invité avec le jeton de son lien de suivi. Tout autre cas répond 404, que le reçu existe ou non | `payments/queries.ts` (`getReceipt`) |
| **Soldes** : total, encaissé et reste à payer sur la fiche commande (administration et client), liste des reçus, filtre « Paiement » dans la liste des commandes | `admin/commandes/[id]/payments-section.tsx`, `components/orders/order-details.tsx` |
| **Journal de caisse** du jour (ou d'une journée choisie) : encaissé, annulé, net, net à remettre par agent | `/admin/encaissements` |
| Paramètres société : champs NINEA et RCCM, vides par défaut (rien d'inventé) | `settings/schemas.ts` |

Dépendance ajoutée : `@react-pdf/renderer` 4.9.0, déjà prévue dans `docs/01-architecture.md`. Le test de politique « aucun paiement électronique » passe toujours.

## Tests réellement exécutés

| Commande | Résultat |
|---|---|
| `pnpm lint` / `pnpm typecheck` | OK |
| `pnpm test` | 38 fichiers, 240 tests réussis (dont intégration PostgreSQL) |
| `pnpm build` | OK (inclus dans `pnpm test:e2e`) |
| `pnpm test:e2e` | 68 tests réussis (bureau et mobile) |

Critères couverts. Le texte détaillé du §20 n'est pas dans le dépôt : les critères ont été rapprochés du plan de la phase 7.

- **§20 n° 15, enregistrement des espèces** :
  - reçu numéroté, statut recalculé, historique, audit, notification ;
  - montant supérieur au solde refusé, montant nul ou décimal refusé ;
  - commande non confirmée ou annulée refusée ;
  - double envoi simultané : un seul encaissement ;
  - deux agents en même temps sur le même solde : un seul encaissement.
- **§20 n° 16, partiel et contre-écriture** :
  - acompte refusé si D2 est désactivé ;
  - acompte puis solde si D2 est activé ;
  - contre-écriture opposée et liée, original intact, une seule annulation (même en parallèle) ;
  - pas d'annulation d'une contre-écriture ni sans motif ;
  - commande encaissée non annulable avant contre-écriture ;
  - ajout seul et cohérence vérifiés directement en base.
- **§20 n° 26, contrôle d'accès** :
  - un gestionnaire de commandes ou le service client ne peut pas encaisser ;
  - un responsable de livraison encaisse mais ne peut pas annuler ;
  - un technicien ne voit pas les encaissements ;
  - refus journalisés ;
  - reçu : personnel, titulaire et invité muni du jeton seulement (un autre client, un jeton d'une autre commande ou l'absence de jeton donnent 404).
- **Payée avant remise** : en intégration et en E2E (remise refusée, encaissement, remise acceptée, stock sorti).
- **E2E** :
  - parcours complet : confirmation, refus de la remise, encaissement, PDF pour le personnel et l'invité, 404 sans jeton, contre-écriture, nouvel encaissement, remise, journal de caisse ;
  - un gestionnaire de commandes voit les encaissements en lecture seule.

## Défauts trouvés par les tests et corrigés

- **Message de la dernière transition perdu** : à la remise au client, la section « Changer le statut » disparaissait avec son message de confirmation (statut final). Elle reste désormais affichée et indique « Statut final ». Même défaut qu'en phase 6, trouvé par le nouvel E2E.
- **Trigger d'intégrité** : la première version lisait `NEW."orderId"` dans une expression commune aux deux tables, et PostgreSQL l'évaluait aussi sur `orders`. Les tests d'intégration ont échoué tout de suite. Les champs sont désormais lus dans des branches séparées. La migration n'était pas commitée : la fonction et son empreinte ont été corrigées en place sur les bases locales, sans réinitialisation, et `prisma migrate status` est à jour.

## Revue de code et de sécurité

Deux revues : qualité du code et sécurité. Aucun point CRITICAL ni HIGH.

Vérifié sain :

- **Verrous** : la commande est toujours verrouillée avant le stock, donc aucun interblocage entre statut et encaissement.
- **Gardes** : « soldée avant remise » et « pas d'annulation encaissée » sont contrôlées sous ce verrou.
- **Accès au reçu** : réservé à la commande du demandeur, avec la même réponse 404 pour un reçu inexistant ou refusé.
- **Jeton** : comparé à temps constant.
- **Note interne** : absente des vues client et du PDF.
- **Paiement électronique** : aucun chemin.

Corrigé, avec des tests :

- **MEDIUM, contre-écriture sur une commande déjà remise** : elle laissait une commande clôturée non soldée. Elle est désormais refusée, et une commande remise ne s'encaisse plus. La correction passera par un retour (phase 9).
- **MEDIUM, cohérence de `amountPaid`** : elle ne reposait que sur le code. Un trigger différé l'impose désormais en base, et le `search_path` des fonctions est figé. Un point de la revue était un faux positif : `amountPaid ≥ 0` était déjà contrôlé depuis la phase 6, et un test le confirme.
- **MEDIUM, commande à 0 FCFA** : elle gardait le statut « non payée ». Elle est maintenant « payée » dès sa création.
- **MEDIUM, duplication** : la liste des statuts encaissables est partagée entre le service et l'interface. Le verrou de commande est mutualisé (`orders/lock.ts`).
- **LOW** :
  - une clé d'idempotence rejouée avec un autre montant est refusée, au lieu d'annoncer « déjà enregistré » ;
  - un incident d'envoi de notification ne fait plus paraître échoué un encaissement validé ;
  - l'historique choisit son libellé selon le champ (commande ou paiement) ;
  - le rendu PDF est testé avec des caractères hors de la police intégrée.

Reporté en phase 10 :

- l'application devra tourner avec un rôle PostgreSQL non propriétaire, sans `UPDATE`, `DELETE` ni `TRUNCATE` sur `payments` et `audit_logs` (les triggers ne couvrent pas `TRUNCATE`, que les tests utilisent pour vider la base) ;
- une limitation de débit sur `/recus/*`, car le rendu PDF coûte du temps machine ;
- le masquage de `jeton` dans les journaux du proxy ;
- un jeton de suivi révocable (déjà noté en phase 6).

Hors périmètre : `pnpm audit` signale deux vulnérabilités dans `mysql2`, tiré par `better-auth`. Elles existaient avant cette phase et ce pilote n'est pas utilisé avec PostgreSQL. Il faudra mettre `better-auth` à jour ou forcer la version de `mysql2`.

## Choix et points ouverts

- **Statut d'un encaissement** : aucune colonne `status` modifiable. « Annulé » se lit sur l'existence de la contre-écriture, ce qui garde la table strictement en ajout seul. La date d'encaissement est celle de la saisie, sans antidatage possible. Le modèle de données est mis à jour.
- **Remboursements** : les statuts `TO_VERIFY`, `REFUND_PENDING` et `REFUNDED` existent mais ne sont pas utilisés. Les retours et remboursements arrivent en phase 9.
- **Reçus** :
  - le nom de l'agent est imprimé, comme sur un reçu papier, et le motif d'une annulation aussi (le formulaire le signale) ;
  - aucune notification au client lors d'une contre-écriture.

  Ces trois points sont à confirmer.
- **Encaissement des interventions** : en phase 8. `Payment.interventionId` sera ajouté, avec une contrainte « exactement une commande ou une intervention ».
- **Mentions légales** : NINEA et RCCM sont prêts dans le schéma des paramètres. Leur écran d'administration arrive avec les paramètres en phase 9 ; d'ici là, ils restent vides et le reçu les omet.
