# Modèle de données initial

Identifiants : `cuid` (texte) stables. Montants : `Int` en FCFA. Dates : `timestamptz` (UTC).
Les numéros métier lisibles (`CMD-2026-000123`, `DEV-…`, `INT-…`, `REC-…`, `FAC-…`) sont générés via une table `Sequence` incrémentée dans la transaction.

## 1. Identité, rôles, audit

| Modèle | Champs clés | Notes |
|---|---|---|
| `User` | email (unique), name, phone, isActive, kind (`STAFF`/`CUSTOMER`) | Mot de passe géré par Better Auth (`Account`, haché) ; jamais lisible |
| `Session`, `Account`, `Verification` | — | Tables Better Auth |
| `Role` | code (unique), label, isSystem | 10 rôles du §14, plus `COURIER` (livreur, phase 10) |
| `Permission` | code (unique, ex. `payments.record`) | Liste figée dans le code, synchronisée par le seed |
| `RolePermission` | roleId, permissionId | |
| `UserRole` | userId, roleId | Garde-fou : impossible de retirer le dernier `SUPER_ADMIN` actif |
| `AuditLog` | actorId?, action, entityType, entityId, before (json), after (json), result, ip, correlationId, createdAt | Append-only (trigger) |

## 2. Clients

| Modèle | Champs clés | Notes |
|---|---|---|
| `Customer` | userId? (unique), type (`INDIVIDUAL`/`BUSINESS`), name, companyName?, phone, email?, internalNotes | Existe aussi pour les invités (userId nul). `internalNotes` jamais exposé |
| `Address` | customerId, label, recipient, phone, line1, district, city, zoneId?, landmark, isDefault | « Point de repère » utile au Sénégal |
| `Favorite` | customerId, productId | unique (customerId, productId) |
| `SupportTicket` | customerId, orderId?, interventionId?, subject, status, messages | Réclamations |

## 3. Catalogue et stock

| Modèle | Champs clés | Notes |
|---|---|---|
| `Category` | parentId?, name, slug (unique), position, isActive, seo | Arborescence (6 familles + sous-catégories du §6) |
| `Brand` | name, slug | |
| `Product` | categoryId, brandId?, name, slug, model, shortDesc, description, condition (`NEW`/`REFURBISHED`/`USED`), warrantyMonths, warrantyText, specs (json), weightG?, dimensions?, status (`DRAFT`/`PUBLISHED`/`ARCHIVED`), isFeatured | « Épuisé » est **calculé** depuis le stock, pas stocké |
| `ProductImage` | productId, url, alt, position | |
| `ProductVariant` | productId, sku (unique), barcode?, name, attributes (json), price, compareAtPrice?, costPrice, isDefault, isActive | Tout produit a au moins une variante par défaut → stock et prix uniformes. `costPrice` réservé aux rôles autorisés |
| `ProductCompatibility` | productId, compatibleProductId | Accessoires compatibles |
| `Inventory` | variantId (unique), onHand, reserved, alertThreshold, lastCountedAt, lastCountedQty | `CHECK (reserved >= 0 AND onHand >= reserved)` ; disponible = onHand − reserved |
| `StockMovement` | variantId, type (`IN`/`OUT`/`ADJUSTMENT`/`RESERVE`/`RELEASE`/`SALE`/`RETURN`), quantity (signé), reason, orderId?, returnId?, actorId, createdAt | Journal immuable |
| `Promotion` | name, type (`PERCENT`/`FIXED`), value, startsAt, endsAt, scope (produits/catégories), code?, isActive | |

## 4. Panier et commandes

| Modèle | Champs clés | Notes |
|---|---|---|
| `Cart` | customerId? / anonymousToken?, expiresAt | |
| `CartItem` | cartId, variantId, quantity | Pas de prix stocké : toujours relu en base |
| `Order` | number (unique), customerId, idempotencyKey (unique), status, paymentStatus, fulfillmentMethod (`DELIVERY`/`PICKUP`), contact & adresse **figés** (json), deliveryZoneId?, subtotal, deliveryFee, discountTotal, total, amountPaid, notes, internalNotes, confirmedAt, cancelledAt, closedAt | `amountPaid`/`paymentStatus` recalculés depuis `Payment` dans la même transaction |
| `OrderItem` | orderId, variantId, productName, sku, unitPrice, quantity, lineTotal, unitCost | Prix figés |
| `OrderStatusHistory` | orderId, field (`ORDER`/`DELIVERY`/`PAYMENT`), from, to, actorId, comment, createdAt | |

Statuts (enums distincts) :
- `OrderStatus` : `PENDING_CONFIRMATION`, `CONFIRMED`, `PREPARING`, `READY_FOR_PICKUP`, `READY_TO_SHIP`, `CANCELLED`, `CLOSED`
- `PaymentStatus` : `UNPAID`, `PARTIALLY_PAID`, `PAID`, `TO_VERIFY`, `REFUND_PENDING`, `REFUNDED`

## 5. Livraison et retrait

| Modèle | Champs clés | Notes |
|---|---|---|
| `DeliveryZone` | name, description, fee, freeAbove?, leadTimeText, isActive, position | Aucune zone réelle inventée |
| `PickupPoint` | name, address, hours, phone, isActive | Vide tant que non renseigné → option retrait masquée |
| `Courier` | name (unique), phone, kind (`INTERNAL`/`EXTERNAL`), userId? (unique), isActive | Livreurs (phase 9). Phase 10 : livreur interne relié à un compte (rôle `COURIER`), transporteur externe sans compte (contrainte `couriers_account_check`) |
| `Delivery` | orderId (unique), courierId, status, attempts, scheduledFor?, startedAt?, deliveredAt?, recipientName?, proofNote?, failureReason? | Commandes « livraison à domicile » seulement (trigger). Historique dans `OrderStatusHistory` (champ `DELIVERY`), en ajout seul |

`DeliveryStatus` (phase 9) : `ASSIGNED` (livreur assigné), `IN_TRANSIT`, `DELIVERED`, `FAILED` (motif obligatoire). Le retrait en boutique reste porté par le statut de la commande (`READY_FOR_PICKUP` → `CLOSED`).

Décision 5 : une commande `DELIVERY` ne passe à `CLOSED` qu'avec une livraison `DELIVERED` dans la même transaction (trigger différé `orders_delivery_closed_by_courier`) ; aucune clôture manuelle.

## 6. Encaissements, factures, retours

| Modèle | Champs clés | Notes |
|---|---|---|
| `Payment` | receiptNumber (unique), orderId? / interventionId? (exactement un — `CHECK`), amount (> 0, ou < 0 pour une contre-écriture), method (`CASH` uniquement), balanceAfter, recordedById, idempotencyKey?, reversesPaymentId? (unique), reason?, note (interne), createdAt | Ajout seul (trigger). Annulation = contre-écriture liée ; « annulé » se lit sur l'existence de la contre-écriture (pas de colonne `status` modifiable). Date d'encaissement = createdAt. `orders.amountPaid` et `interventions.amountPaid` = Σ amount, contrôlés par un trigger différé. Remplace `PaymentReceipt` (le reçu est généré depuis cette ligne) |
| `Invoice` | number (unique), orderId? / interventionId? (exactement un — `CHECK`), issuedAt, lines (json), customer (json), total, issuedById | Document commercial figé (ajout seul), pas une comptabilité réglementaire. PDF généré à la demande (pas de `pdfUrl`) |
| `Return` | number `RET-…` (unique), orderId, idempotencyKey (unique), status, reason, itemsValue, refundAmount, restocked?, decisionNote?, createdById, decidedById?, decidedAt?, refundedAt?, handedOverAt, declarationDeadline, lateDeclaration, exceptionGround?, exceptionNote?, firstActionAt?, overdueNotifiedAt? | Commande remise (`CLOSED`) seulement. Contenu et délais figés, décision définitive, décidée par une autre personne que le déclarant (triggers) |
| `ReturnEvent` | returnId, type, fromStatus?, toStatus, actorId?, comment?, verificationKind?, details (json), createdAt | Historique propre au retour, **ajout seul** (trigger) ; `toStatus` = statut du retour à l'écriture |
| `ReturnItem` | returnId, orderItemId, quantity, unitPrice (figé) | Ajout seul ; quantité retournée ≤ quantité livrée, retours refusés exclus (trigger sous verrou de la ligne de commande) |
| `Expense` | date, category, amount, label, recordedById | Module optionnel |

`ReturnStatus` (phase 9, complété après la phase 9) : `RECEIVED` (à vérifier), `VERIFICATION` (vérification demandée, en attente de réponse), `REFUND_PENDING`, `COMPLETED`, `REJECTED`. Cycle : `RECEIVED` → (`VERIFICATION` → `RECEIVED`)* → `REFUND_PENDING` | `COMPLETED` | `REJECTED` ; `REFUND_PENDING` → `COMPLETED`.

**Politique de retours (décision 2, voir `03-plan-et-decisions.md`)**, garantie en base :
- `handedOverAt` (clôture de la commande), `declarationDeadline` (= remise + 48 h), `lateDeclaration` et `createdAt` sont **posés par le trigger d'insertion**, puis figés ; contrainte `returns_declaration_check`.
- Décision (`RECEIVED` → décision) : `decidedById ≠ createdById` ; hors délai accepté seulement avec `exceptionGround` (`WARRANTY`, `HIDDEN_DEFECT`, `LEGAL_OBLIGATION`, `OTHER`) et `exceptionNote` (contrainte `returns_exception_check` et trigger).
- `firstActionAt` posé par la base à la première sortie de `RECEIVED` (vérification ou décision) ; `overdueNotifiedAt` (alerte unique de délai) ; tous deux figés une fois posés.
- Échéance de traitement : `createdAt` + 24 heures ouvrables (paramètre `businessHours`), calculée par l'application (non stockée : un changement d'horaires s'applique aux retours ouverts).
- `ReturnVerificationKind` : `INSPECTION`, `PHOTOS`, `INVOICE`, `INFORMATION` ; `ReturnEventType` : `DECLARED`, `VERIFICATION_REQUESTED`, `VERIFICATION_ANSWERED`, `ACCEPTED`, `REJECTED`, `REFUNDED`, `OVERDUE_NOTIFIED`.
- Reprise : les retours existants reçoivent leur date de remise (clôture de la commande), leur délai, leur indicateur, `firstActionAt` = date de décision, et un historique reconstitué (marqué `reprise`).

**Remboursements (phase 9)** : un remboursement est une écriture `Payment` négative liée au retour (`returnId`, unique), distincte d'une contre-écriture (`reversesPaymentId`). `Order.refundedAmount` = somme des remboursements ; `Order.amountPaid` reste la somme de toutes les écritures (net). Contrôles en base : `amountPaid + refundedAmount ≤ total`, `amountPaid ≥ 0` (jamais plus remboursé qu'encaissé), montant égal au remboursement décidé, retour en attente de remboursement, cohérence vérifiée à la validation (trigger différé). Un remboursement ne s'annule pas.

`PaymentStatus` dérivé pour une commande avec retours : `REFUND_PENDING` (remboursement à verser) > `TO_VERIFY` (retour à vérifier) > `REFUNDED` (remboursement effectué) > statut des encaissements.

## 7. Services techniques

| Modèle | Champs clés | Notes |
|---|---|---|
| `ServiceCategory` | name, slug, position | Maintenance, Réseaux, Vidéosurveillance, Électricité |
| `Service` | categoryId, name, slug, description, images, pricingMode (`FIXED`/`INDICATIVE`/`QUOTE_ONLY`), price?, estimatedDuration?, zonesText, conditions, isActive | |
| `QuoteRequest` | number, customerId, serviceId?, address, description, urgency, availability, attachments, status | |
| `Quote` | number, quoteRequestId?, customerId, validUntil, status (`DRAFT`/`SENT`/`ACCEPTED`/`REFUSED`/`EXPIRED`), subtotal, total, sentAt, decidedAt | |
| `QuoteItem` | quoteId, kind (`MATERIAL`/`LABOR`/`TRAVEL`/`OTHER`), variantId?, label, quantity, unitPrice, lineTotal | |
| `Technician` | userId (unique), skills, zones, isActive | |
| `Appointment` | interventionId? / quoteRequestId?, technicianId, startsAt, endsAt, kind (`SITE_VISIT`/`INTERVENTION`) | Planning |
| `Intervention` | number, customerId, serviceId?, quoteId?, address, technicianId?, status, problem, amountDue, internalCost, amountPaid, paymentStatus, completedAt, customerSignOff | |
| `InterventionReport` | interventionId, diagnosis, workDone, timeSpentMin, observations, authorId | |
| `InterventionPart` | interventionId, variantId?, label, quantity, unitCost, unitPrice | Sortie de stock tracée si `variantId` |

`InterventionStatus` (phase 8) : `TO_SCHEDULE`, `SCHEDULED`, `IN_PROGRESS`, `DONE`, `CANCELLED`. Le cycle amont (qualification, devis, acceptation) est porté par `QuoteRequestStatus` (`NEW`, `IN_REVIEW`, `QUOTED`, `ACCEPTED`, `CANCELLED`) et `QuoteStatus`, au lieu d'être dupliqué dans l'intervention.

Écarts de la phase 8 : `QuoteRequest.attachments` reporté (stockage de fichiers clients à cadrer) ; `QuoteItem.variantId` non retenu (les lignes sont libres) ; `InterventionPart.unitPrice` non retenu (la facturation suit le devis ou le montant convenu ; `unitCost` sert au coût interne) ; `Appointment` ne porte que des interventions (pas de visite technique distincte) ; `Invoice` pour les interventions seulement (factures de commandes : phase 9).

## 8. Contenu, paramètres, notifications

| Modèle | Champs clés | Notes |
|---|---|---|
| `SiteSetting` | key (unique), value (json), updatedById | Valeurs validées par schéma Zod par clé ; **aucune clé de paiement électronique**. Clés : `company` (dont NINEA, RCCM, logo **téléversé uniquement**, contrainte `site_settings_logo_check`), `commerce` (D1, D2, D3), `payments`, `tax` (D6, phase 9), `features` (D8, phase 9), `businessHours` (jours et plages ouvrables, décision 2) |
| `Page` | slug, title, body, seo, isPublished | CGV, livraison, garantie, confidentialité, à propos |
| `FaqItem`, `Banner` | … | |
| `Notification` | channel (`EMAIL`/`SMS`/`WHATSAPP`), template, recipient, payload, status (`PENDING`/`SENT`/`FAILED`/`SKIPPED_NO_PROVIDER`), error, sentAt, attempts, nextAttemptAt?, orderId? / quoteRequestId? / quoteId? / interventionId? / returnId? | Envoi réel uniquement si fournisseur configuré. Échec renvoyé par la tâche planifiée tant que `nextAttemptAt` est défini (CHECK : seulement pour `FAILED`). `returnId` : alerte interne de délai de traitement d'un retour |
| `Partner` | name, websiteUrl? (https), logoUrl (téléversé), isActive, position | Partenaires affichés sur l'accueil (actifs seulement). Logo téléversé uniquement et lien https : contrainte `partners_fields_check` |
| `Review` | productId, customerId, orderItemId (achat vérifié), rating, body, status (`PENDING`/`APPROVED`/`REJECTED`) | Désactivable ; jamais d'avis fictifs |
| `Sequence` | key, year, value | Numérotation |

## Écarts par rapport à la liste du cahier des charges

- `PaymentReceipt` fusionné dans `Payment` (le reçu est une vue du paiement) — évite une relation redondante.
- `RolePermission` ajouté (nécessaire au lien rôle ↔ permission).
- Ajouts : `PickupPoint`, `Courier`, `InterventionPart`, `ProductCompatibility`, `ReturnItem`, `Favorite`, `SupportTicket`, `Page`, `FaqItem`, `Banner`, `Expense`, `Sequence`.

## Écarts de la phase 9

- `Delivery` simplifié : ni `method`, ni `pickupPointId` (le mode est sur la commande), ni `feeCharged` (frais figés sur la commande), ni `recipientPhone`, ni `handedOverById` (l'auteur de chaque étape est dans l'historique), ni `proofUrl` : la preuve est le nom de la personne qui a reçu et une observation ; la photo de preuve est reportée (stockage de photos de domicile à cadrer). `Courier.userId` non retenu.
- `Return.processedById` remplacé par `createdById` et `decidedById` ; `restock` → `restocked` (décision motivée par `decisionNote`) ; `ReturnItem.condition` non retenu (l'état est dans le motif de la décision). Décision par retour entier : un retour mixte (un article intact, un abîmé) se saisit en deux retours.
- `StockMovement.returnId` non ajouté : la remise en stock est un mouvement `RETURN` rattaché à la commande, motivé par le numéro du retour.
- `Order.refundedAmount` ajouté ; `Payment.returnId` ajouté.
- `Address` (adresses enregistrées du client) : reporté en phase 10, avec l'adaptation du formulaire de commande.
- `Expense`, `Review`, `Banner`, `SupportTicket`, `Favorite` : non créés (hors périmètre de la phase 9).

## Correctifs post-phase 9 (décisions du propriétaire)

- `Return` : délais et exception (voir §6), `ReturnEvent` (historique propre), statut `VERIFICATION`, permission `returns.decide`.
- `Notification.returnId` (alertes internes de délai).
- `Partner` (logos téléversés uniquement).
- `SiteSetting` : clé `businessHours` ; logo du site téléversé uniquement (contrainte en base).
- `Order` : clôture d'une commande à livrer réservée à la livraison effectuée (trigger).
- Migrations `20261018090000_return_verification_status` (valeur d'énumération, séparée : utilisable seulement après validation) et `20261018090100_owner_decisions`.

## Phase 10 (décisions du propriétaire sur les retours et les livraisons)

- `Return.createdById` facultatif et `Return.declaredBy` (`ReturnDeclarationSource` : `STAFF` / `CUSTOMER`) : le client peut déclarer lui-même ; déclarant interne présent si et seulement si le personnel déclare (contrainte `returns_declarer_check`), figés (trigger).
- `Return.verificationRequestedAt` et `Return.verificationReminderStage` (0 à 3) : suivi des relances posé par la base (date à la demande, remise à zéro à la réponse, palier croissant ; contrainte `returns_reminder_check`). `ReturnEventType` : `VERIFICATION_REMINDED`, `VERIFICATION_ESCALATED` (événements système, sans auteur).
- `Return.refundExceptionNote` : remboursement versé par la personne qui a décidé, à titre d'exception motivée ; écrit seulement au versement ; sans lui, le trigger refuse le versement par le décideur.
- `ReturnAttachment` (returnId, storageKey unique, contentType, byteSize, createdAt) : photos jointes par le client, **ajout seul**, fichier privé `retours/<retour>/photo-<uuid>.<jpg|png|webp>`, 2 Mo au plus (contrainte `return_attachments_file_check`). Jamais servies par `/medias`.
- `ReturnEvent` : une étape sans auteur interne est une action du système ou du client (`details.by = customer`).
- `SiteSetting` : `businessHours.holidays` (jours fériés AAAA-MM-JJ, jamais comptés) ; défaut inchangé (lundi–samedi 8 h–18 h, horaires de la phase 9) ; nouvelle clé `returnReminders` (12 / 24 / 48 heures ouvrables).
- Permissions `deliveries.update_own` (livreur) et `returns.refund_own_decision` (administrateur principal seulement).
- Migrations `20261018120000_return_reminder_events` (valeurs d'énumération, séparée) et `20261018120100_phase10_returns_couriers`.
