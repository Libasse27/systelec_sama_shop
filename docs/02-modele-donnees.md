# Modèle de données initial

Identifiants : `cuid` (texte) stables. Montants : `Int` en FCFA. Dates : `timestamptz` (UTC).
Les numéros métier lisibles (`CMD-2026-000123`, `DEV-…`, `INT-…`, `REC-…`, `FAC-…`) sont générés via une table `Sequence` incrémentée dans la transaction.

## 1. Identité, rôles, audit

| Modèle | Champs clés | Notes |
|---|---|---|
| `User` | email (unique), name, phone, isActive, kind (`STAFF`/`CUSTOMER`) | Mot de passe géré par Better Auth (`Account`, haché) ; jamais lisible |
| `Session`, `Account`, `Verification` | — | Tables Better Auth |
| `Role` | code (unique), label, isSystem | 10 rôles du §14 |
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
| `Courier` | name, phone, isActive, userId? | Livreurs |
| `Delivery` | orderId (unique), method, courierId?, pickupPointId?, scheduledAt, deliveredAt, status, feeCharged, recipientName, recipientPhone, proofUrl?, handedOverById?, notes | |

`DeliveryStatus` : `UNSCHEDULED`, `TO_PREPARE`, `IN_TRANSIT`, `DELIVERED`, `FAILED`, `RETURNING`, `RETURNED`, `READY_TO_COLLECT`, `COLLECTED`, `NOT_COLLECTED`.

## 6. Encaissements, factures, retours

| Modèle | Champs clés | Notes |
|---|---|---|
| `Payment` | receiptNumber (unique), orderId? / interventionId? (exactement un — `CHECK`), amount (> 0, ou < 0 pour une contre-écriture), method (`CASH` uniquement), balanceAfter, recordedById, idempotencyKey?, reversesPaymentId? (unique), reason?, note (interne), createdAt | Ajout seul (trigger). Annulation = contre-écriture liée ; « annulé » se lit sur l'existence de la contre-écriture (pas de colonne `status` modifiable). Date d'encaissement = createdAt. `orders.amountPaid` et `interventions.amountPaid` = Σ amount, contrôlés par un trigger différé. Remplace `PaymentReceipt` (le reçu est généré depuis cette ligne) |
| `Invoice` | number (unique), orderId? / interventionId?, issuedAt, total, pdfUrl? | Document commercial, pas une comptabilité réglementaire |
| `Return` | number, orderId, status, reason, restock (bool), refundAmount, processedById | |
| `ReturnItem` | returnId, orderItemId, quantity, condition | |
| `Expense` | date, category, amount, label, recordedById | Module optionnel |

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
| `SiteSetting` | key (unique), value (json), updatedById | Valeurs validées par schéma Zod par clé ; **aucune clé de paiement électronique** |
| `Page` | slug, title, body, seo, isPublished | CGV, livraison, garantie, confidentialité, à propos |
| `FaqItem`, `Banner` | … | |
| `Notification` | channel (`EMAIL`/`SMS`/`WHATSAPP`), template, recipient, payload, status (`PENDING`/`SENT`/`FAILED`/`SKIPPED_NO_PROVIDER`), error, sentAt | Envoi réel uniquement si fournisseur configuré |
| `Review` | productId, customerId, orderItemId (achat vérifié), rating, body, status (`PENDING`/`APPROVED`/`REJECTED`) | Désactivable ; jamais d'avis fictifs |
| `Sequence` | key, year, value | Numérotation |

## Écarts par rapport à la liste du cahier des charges

- `PaymentReceipt` fusionné dans `Payment` (le reçu est une vue du paiement) — évite une relation redondante.
- `RolePermission` ajouté (nécessaire au lien rôle ↔ permission).
- Ajouts : `PickupPoint`, `Courier`, `InterventionPart`, `ProductCompatibility`, `ReturnItem`, `Favorite`, `SupportTicket`, `Page`, `FaqItem`, `Banner`, `Expense`, `Sequence`.
