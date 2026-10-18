# Rapport de phase 8 — Services techniques

**Branche :** `feat/phase-8-services-techniques` · **Date :** 2026-10-14

## Livré

| Élément | Fichiers |
|---|---|
| **Modèle** : demandes, devis et lignes, techniciens, interventions, rendez-vous, rapports, pièces, factures. Les encaissements portent sur une commande **ou** une intervention (exactement l'une, `CHECK`) | `prisma/schema.prisma`, migrations `*_technical_services`, `*_quote_request_idempotency`, `*_technical_services_integrity` |
| **Intégrité en base** : | |
| — planning sans chevauchement par technicien (contrainte d'exclusion `btree_gist`, créneaux `[début, fin[`) | |
| — une seule intervention active par demande (index unique partiel) | |
| — devis envoyé figé : lignes, montants et validité (triggers) | |
| — facture en ajout seul | |
| — `amountPaid` = somme des encaissements, pour les commandes comme pour les interventions (trigger différé) | |
| — contre-écriture de la même cible que l'encaissement annulé | |
| **Demande de devis** publique, avec ou sans compte : | `quotes/requests.ts`, `/devis/demande` |
| — téléphone obligatoire, urgence, disponibilités, service rattaché | |
| — lien de suivi signé (HMAC) pour l'invité ; idempotence par clé unique | |
| — limites : 10 demandes par IP et par heure ; 5 demandes ouvertes par téléphone **depuis une même connexion** ; 3 accusés de réception par adresse e-mail et par jour | |
| **Devis détaillé** (`quotes.manage`) : | `quotes/quotes.ts`, `/admin/devis/[id]` |
| — lignes matériel, main-d'œuvre, déplacement ou autre ; total calculé par le serveur (FCFA entiers, prix TTC, D6) | |
| — modifiable en brouillon seulement ; validité en fin de journée à Dakar | |
| — envoi : devis figé, client notifié avec son lien | |
| **Décision** : le client accepte ou refuse (compte, ou lien invité), ou le personnel enregistre un accord par téléphone. Un devis expiré ou une demande close n'est plus acceptable. L'acceptation crée l'intervention au montant du devis et clôt les autres devis de la demande | `decideQuote`, `/devis/[numéro]` |
| **Intervention à prix fixe** créée directement depuis une demande, sans devis | `createDirectIntervention` |
| **Planning et techniciens** : profils (compétences, zones, disponibilité) pour les comptes portant le rôle Technicien, planification et replanification, vue hebdomadaire | `/admin/techniciens`, `/admin/planning`, `technicians/service.ts` |
| **Travail du technicien** : il ne voit et n'agit que sur **ses** interventions (`interventions.update_own`, revérifié sous verrou). Démarrage, rapport (diagnostic, travaux, temps), pièces, fin des travaux avec le nom de la personne présente | `interventions/{access,workflow,parts}.ts`, `/admin/interventions/[id]` |
| **Pièces** : une référence du catalogue sort du stock (mouvement OUT motivé, sous verrou, intervention puis stock) avec son prix d'achat en coût interne ; retour en stock si la pièce est retirée ou l'intervention annulée. Le coût n'est montré qu'aux responsables | `parts.ts` |
| **Encaissement après prestation** : même module que les commandes, avec la même idempotence, la contre-écriture et le reçu PDF. Une intervention ne s'encaisse qu'une fois terminée | `payments/targets.ts`, `payments/service.ts` |
| **Facture PDF** : émise une fois l'intervention terminée, unique, figée (lignes du devis, ou une ligne au montant convenu). Mentions légales D7 si renseignées | `invoices/*`, `/factures/[numéro]` |
| **Suivi client** : depuis le lien de la demande ou du devis, ou depuis « Mon compte ». Le client voit le statut, le rendez-vous, le paiement, ses reçus et sa facture, mais jamais le rapport interne, les pièces ni les coûts | `/devis/demande/[numéro]`, `/devis/[numéro]`, `/compte` |
| **Notifications persistées** : demande reçue, nouvelle demande (boutique), devis envoyé, décision, intervention planifiée, terminée, paiement reçu. SMS tracés « aucun fournisseur » (D11) | `notifications/{queue,service-templates}.ts` |
| Expiration des devis ajoutée à la tâche planifiée `pnpm orders:expire` | `scripts/expire-orders.ts` |

Refactorisations utiles aux phases suivantes :

- **Encaissements** : abstraction de cible (commande ou intervention), au lieu de dupliquer le module.
- **Notifications** : file générique rattachée à n'importe quel document.
- **Jetons d'accès** : portées distinctes (`order`, `quote_request`, `quote`) ; le jeton d'une portée n'en ouvre jamais une autre.
- **PDF** : éléments communs aux reçus et aux factures (`server/documents/pdf-kit.tsx`).
- **Doublons supprimés** : `optionalText` et `isUniqueViolation`, chacun dans un module unique.

## Tests réellement exécutés

| Commande | Résultat |
|---|---|
| `pnpm lint` / `pnpm typecheck` | OK |
| `pnpm test` | 43 fichiers, 280 tests réussis (dont intégration PostgreSQL) |
| `pnpm build` | OK (inclus dans `pnpm test:e2e`) |
| `pnpm test:e2e` | 70 tests réussis (bureau et mobile) |

Critères couverts. Le texte détaillé du §20 n'est pas dans le dépôt : les critères ont été rapprochés du plan de la phase 8.

- **§20 n° 19, demande et devis détaillé** :
  - dépôt invité ou avec compte, et confidentialité entre clients ;
  - idempotence, même simultanée ;
  - limites anti-abus, sans permettre à un tiers de bloquer une victime ;
  - total calculé par le serveur ; brouillon invisible du client ; devis envoyé figé (service et base) ; envoi d'un devis vide refusé ; droits.
- **§20 n° 20, acceptation, interventions et planning** :
  - acceptation par lien invité, par le compte ou par le personnel ; mauvais jeton, mauvais compte, devis expiré, demande close : tous refusés ;
  - double acceptation simultanée : une seule intervention ;
  - chevauchement refusé, même simultané ; créneaux bord à bord permis ;
  - technicien inactif refusé ; replanification ;
  - technicien non assigné refusé, avec refus journalisé ;
  - rapport obligatoire avant la fin ; pièces et stock ; annulation qui libère le créneau et le stock.
- **§20 n° 21, facturation et encaissement après prestation** :
  - encaissement refusé avant la fin, puis enregistré ;
  - contre-écriture ;
  - facture unique et figée, PDF ;
  - accès aux documents : personnel autorisé, invité muni de son lien de devis ou de demande ; jeton d'une autre portée refusé.
- **E2E**, parcours complet à trois acteurs, sur bureau et mobile :
  - le client dépose sa demande ;
  - le responsable crée le profil du technicien, rédige le devis et l'envoie ;
  - le client l'accepte ;
  - le responsable planifie ;
  - le technicien démarre, rédige son rapport, ajoute une pièce et termine ;
  - le responsable encaisse et émet la facture ;
  - le client ouvre son reçu et sa facture ; sans jeton, rien.

## Défauts trouvés par les tests et corrigés

- **Identifiants de champs dupliqués** (accessibilité). Sur une page à plusieurs formulaires (fiches techniciens, motifs d'annulation des encaissements), chaque libellé désignait le champ du premier formulaire. Les identifiants sont désormais uniques (`useId`). Ce défaut existait depuis la phase 5 ; le nouvel E2E l'a révélé.
- **Message perdu après l'envoi d'un devis** : l'éditeur de brouillon disparaissait avec sa confirmation. L'envoi redirige désormais vers le devis, qui affiche le message.
- **Délai du test E2E** : le parcours à trois acteurs dépassait le délai par défaut de 30 s. Ce test dispose désormais de 90 s ; il s'exécute en 10 s environ.

## Revue de code et de sécurité

Deux revues : qualité du code et sécurité. Aucun point CRITICAL. Vérifié sain :

- **Verrous** : ordre intervention puis stock, demande puis devis ; aucun cycle.
- **Refus d'accès** : journalisés avant la transaction, puis revérifiés sous verrou.
- **Portée des jetons** et **réponse 404 uniforme** sur les documents.
- **Données internes** : coût interne masqué au technicien et au client ; aucune note interne exposée.
- **Server actions** liées côté serveur.
- **Paiement électronique** : aucun chemin.

Corrigé, avec des tests :

- **HIGH (revue de code), MEDIUM (sécurité), une même demande pouvait donner plusieurs interventions facturables.** Cas possibles : deux devis acceptés ; un devis accepté après la clôture de la demande ; une intervention directe en parallèle d'un devis. Corrections :
  - la demande est verrouillée avant le devis ;
  - son statut est revérifié à l'envoi, à la modification et à l'acceptation ;
  - les autres devis sont clos à l'acceptation, à la clôture et à la création d'une intervention directe ;
  - un index unique partiel l'interdit en base.
- **HIGH, l'envoi d'un brouillon rouvrait une demande close** : il est désormais refusé.
- **MEDIUM** :
  - **pièces** : l'annulation d'une intervention en cours remet en stock les pièces du catalogue ;
  - **intervention à prix fixe** : l'invité ouvre sa facture et ses reçus avec le lien de sa demande, et la page de la demande affiche le suivi ;
  - **devis envoyé** : il est figé aussi en base (triggers) ;
  - **blocage par un tiers** : il ne peut plus bloquer les demandes d'un numéro depuis une autre connexion ;
  - **accusés de réception** : plafonnés par adresse e-mail, pour que le formulaire ne serve pas à envoyer du spam ;
  - **PDF** : un caractère non affichable par la police (émoji, autre alphabet) est remplacé, et les textes très longs sont tronqués, au lieu de casser le rendu.
- **LOW** :
  - libellés neutres « Soldé » (commande ou intervention) ;
  - message adapté quand rien ne reste à régler ;
  - ancien créneau conservé dans l'audit d'une replanification ;
  - en-tête `Referrer-Policy` sur les factures ;
  - message de stock générique pour le technicien (il ne voit pas les niveaux de stock).

Non corrigé (risque faible) :

- **Message « Pièce retirée »** : il disparaît avec la ligne retirée ; la liste mise à jour suffit.
- **Refus sous verrou non journalisé** : quand un technicien est réattribué entre le contrôle et le verrou, le refus n'est pas journalisé (le premier contrôle, lui, l'est).
- **Technicien désactivé** : il peut encore travailler sur ses interventions en cours. C'est une décision métier à prendre.
- **Migration `*_quote_request_idempotency`** : elle suppose la table vide. C'est le cas, car rien n'est déployé.

Reporté en phase 10 :

- une limitation de débit au proxy et un compteur atomique par IP ;
- un comportement explicite quand l'IP du client est inconnue ;
- des jetons de suivi révocables (version par document) et une durée réduite.

## Choix et points ouverts

- **Statuts** : `InterventionStatus` est simplifié (à planifier, planifiée, en cours, terminée, annulée). Le cycle amont est porté par la demande et le devis. Les écarts sont documentés dans `docs/02-modele-donnees.md` :
  - pièces jointes reportées ;
  - lignes de devis libres ;
  - pas de visite technique distincte ;
  - factures de commandes en phase 9.
- **Suivi invité** : le lien vaut 180 jours à partir de la création de la demande ou du devis.
- **Prix** : ils sont saisis TTC, sans TVA détaillée (D6, à valider avec le comptable).
- **Créneaux** : une heure de Dakar équivaut à l'heure UTC, toute l'année.
- **À confirmer de votre part** :
  - un client peut déposer 5 demandes ouvertes par numéro et par connexion ;
  - un technicien désactivé peut-il terminer ses interventions en cours ?
  - le nom du technicien est montré au client dans le rendez-vous.
