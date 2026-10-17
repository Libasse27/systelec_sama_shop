-- CreateEnum
CREATE TYPE "DeliveryStatus" AS ENUM ('ASSIGNED', 'IN_TRANSIT', 'DELIVERED', 'FAILED');

-- CreateEnum
CREATE TYPE "ReturnStatus" AS ENUM ('RECEIVED', 'REFUND_PENDING', 'COMPLETED', 'REJECTED');

-- AlterTable
ALTER TABLE "invoices" ADD COLUMN     "orderId" TEXT,
ALTER COLUMN "interventionId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "refundedAmount" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "payments" ADD COLUMN     "returnId" TEXT;

-- CreateTable
CREATE TABLE "couriers" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "couriers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deliveries" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "courierId" TEXT NOT NULL,
    "status" "DeliveryStatus" NOT NULL DEFAULT 'ASSIGNED',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "scheduledFor" TIMESTAMPTZ(3),
    "startedAt" TIMESTAMPTZ(3),
    "deliveredAt" TIMESTAMPTZ(3),
    "recipientName" TEXT,
    "proofNote" TEXT,
    "failureReason" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "returns" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "status" "ReturnStatus" NOT NULL DEFAULT 'RECEIVED',
    "reason" TEXT NOT NULL,
    "itemsValue" INTEGER NOT NULL,
    "refundAmount" INTEGER NOT NULL DEFAULT 0,
    "restocked" BOOLEAN,
    "decisionNote" TEXT,
    "createdById" TEXT NOT NULL,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMPTZ(3),
    "refundedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "returns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "return_items" (
    "id" TEXT NOT NULL,
    "returnId" TEXT NOT NULL,
    "orderItemId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitPrice" INTEGER NOT NULL,

    CONSTRAINT "return_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "couriers_name_key" ON "couriers"("name");

-- CreateIndex
CREATE UNIQUE INDEX "deliveries_orderId_key" ON "deliveries"("orderId");

-- CreateIndex
CREATE INDEX "deliveries_status_updatedAt_idx" ON "deliveries"("status", "updatedAt");

-- CreateIndex
CREATE INDEX "deliveries_courierId_status_idx" ON "deliveries"("courierId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "returns_number_key" ON "returns"("number");

-- CreateIndex
CREATE UNIQUE INDEX "returns_idempotencyKey_key" ON "returns"("idempotencyKey");

-- CreateIndex
CREATE INDEX "returns_orderId_createdAt_idx" ON "returns"("orderId", "createdAt");

-- CreateIndex
CREATE INDEX "returns_status_createdAt_idx" ON "returns"("status", "createdAt");

-- CreateIndex
CREATE INDEX "return_items_orderItemId_idx" ON "return_items"("orderItemId");

-- CreateIndex
CREATE UNIQUE INDEX "return_items_returnId_orderItemId_key" ON "return_items"("returnId", "orderItemId");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_orderId_key" ON "invoices"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "payments_returnId_key" ON "payments"("returnId");

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_returnId_fkey" FOREIGN KEY ("returnId") REFERENCES "returns"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_courierId_fkey" FOREIGN KEY ("courierId") REFERENCES "couriers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "returns" ADD CONSTRAINT "returns_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "return_items" ADD CONSTRAINT "return_items_returnId_fkey" FOREIGN KEY ("returnId") REFERENCES "returns"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "return_items" ADD CONSTRAINT "return_items_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "order_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ═══ Intégrité garantie par la base (phase 9) ═══════════════════════════════

-- ─── Factures : une commande OU une intervention, commande soldée ───────────
ALTER TABLE "invoices"
  ADD CONSTRAINT "invoices_target_check" CHECK (("orderId" IS NULL) <> ("interventionId" IS NULL));

CREATE FUNCTION invoices_check_order() RETURNS trigger AS $$
DECLARE
  o RECORD;
BEGIN
  IF NEW."orderId" IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT "status", "total", "amountPaid", "refundedAmount" INTO o FROM "orders" WHERE "id" = NEW."orderId";
  IF o."status" = 'CANCELLED' OR o."amountPaid" + o."refundedAmount" < o."total" THEN
    RAISE EXCEPTION 'facture : la commande doit être soldée' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = pg_catalog, public;

CREATE TRIGGER invoices_order_settled
  BEFORE INSERT ON "invoices"
  FOR EACH ROW EXECUTE FUNCTION invoices_check_order();

-- ─── Commandes : remboursements ─────────────────────────────────────────────
ALTER TABLE "orders"
  ADD CONSTRAINT "orders_refunded_check" CHECK ("refundedAmount" >= 0 AND "amountPaid" + "refundedAmount" <= "total");

-- ─── Encaissements : un remboursement est une écriture négative liée à un retour ──
ALTER TABLE "payments"
  DROP CONSTRAINT "payments_amount_check",
  DROP CONSTRAINT "payments_reason_check";

ALTER TABLE "payments"
  ADD CONSTRAINT "payments_amount_check" CHECK (
    "amount" <> 0 AND (("amount" > 0) = ("reversesPaymentId" IS NULL AND "returnId" IS NULL))),
  ADD CONSTRAINT "payments_kind_check" CHECK ("reversesPaymentId" IS NULL OR "returnId" IS NULL),
  ADD CONSTRAINT "payments_refund_target_check" CHECK ("returnId" IS NULL OR "orderId" IS NOT NULL),
  ADD CONSTRAINT "payments_reason_check" CHECK (
    ("reversesPaymentId" IS NULL AND "returnId" IS NULL) OR length(trim(coalesce("reason", ''))) > 0);

-- Contre-écriture : ni d'une contre-écriture, ni d'un remboursement ; même cible, montant opposé.
CREATE OR REPLACE FUNCTION payments_check_reversal() RETURNS trigger AS $$
DECLARE
  original RECORD;
BEGIN
  IF NEW."reversesPaymentId" IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT "orderId", "interventionId", "amount", "reversesPaymentId", "returnId" INTO original FROM "payments" WHERE "id" = NEW."reversesPaymentId";
  IF original."reversesPaymentId" IS NOT NULL OR original."returnId" IS NOT NULL THEN
    RAISE EXCEPTION 'une contre-écriture ou un remboursement ne peut pas être annulé' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."amount" <> -original."amount"
     OR NEW."orderId" IS DISTINCT FROM original."orderId"
     OR NEW."interventionId" IS DISTINCT FROM original."interventionId" THEN
    RAISE EXCEPTION 'contre-écriture incohérente avec l''encaissement annulé' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = pg_catalog, public;

-- Remboursement : exactement le montant décidé du retour, sur sa commande, une seule fois (unicité).
CREATE FUNCTION payments_check_refund() RETURNS trigger AS $$
DECLARE
  r RECORD;
BEGIN
  IF NEW."returnId" IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT "orderId", "status", "refundAmount" INTO r FROM "returns" WHERE "id" = NEW."returnId";
  IF r."status" IS DISTINCT FROM 'REFUND_PENDING' THEN
    RAISE EXCEPTION 'remboursement : le retour n''attend pas de remboursement' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."orderId" IS DISTINCT FROM r."orderId" OR NEW."amount" <> -r."refundAmount" THEN
    RAISE EXCEPTION 'remboursement incohérent avec le retour' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = pg_catalog, public;

CREATE TRIGGER payments_refund_consistency
  BEFORE INSERT ON "payments"
  FOR EACH ROW EXECUTE FUNCTION payments_check_refund();

-- Montant encaissé = somme des écritures ; montant remboursé = somme des remboursements.
CREATE OR REPLACE FUNCTION check_amount_paid() RETURNS trigger AS $$
DECLARE
  order_id TEXT;
  intervention_id TEXT;
  paid INTEGER;
  refunded INTEGER;
  recorded INTEGER;
  recorded_refunds INTEGER;
BEGIN
  -- Champs lus séparément : NEW n'a pas les mêmes colonnes selon la table.
  IF TG_TABLE_NAME = 'payments' THEN
    order_id := NEW."orderId";
    intervention_id := NEW."interventionId";
  ELSIF TG_TABLE_NAME = 'orders' THEN
    order_id := NEW."id";
  ELSE
    intervention_id := NEW."id";
  END IF;
  IF order_id IS NOT NULL THEN
    SELECT "amountPaid", "refundedAmount" INTO paid, refunded FROM "orders" WHERE "id" = order_id;
    SELECT coalesce(sum("amount"), 0), coalesce(-sum("amount") FILTER (WHERE "returnId" IS NOT NULL), 0)
      INTO recorded, recorded_refunds FROM "payments" WHERE "orderId" = order_id;
    IF paid IS DISTINCT FROM recorded OR refunded IS DISTINCT FROM recorded_refunds THEN
      RAISE EXCEPTION 'commande % : montants (encaissé %, remboursé %) différents des écritures (%, %)', order_id, paid, refunded, recorded, recorded_refunds
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  IF intervention_id IS NOT NULL THEN
    SELECT "amountPaid" INTO paid FROM "interventions" WHERE "id" = intervention_id;
    SELECT coalesce(sum("amount"), 0) INTO recorded FROM "payments" WHERE "interventionId" = intervention_id;
    IF paid IS DISTINCT FROM recorded THEN
      RAISE EXCEPTION 'intervention % : montant encaissé (%) différent de la somme des encaissements (%)', intervention_id, paid, recorded
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql SET search_path = pg_catalog, public;

DROP TRIGGER orders_amount_paid_consistency ON "orders";
CREATE CONSTRAINT TRIGGER orders_amount_paid_consistency
  AFTER UPDATE OF "amountPaid", "refundedAmount" ON "orders"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION check_amount_paid();

-- ─── Retours ─────────────────────────────────────────────────────────────────
ALTER TABLE "returns"
  ADD CONSTRAINT "returns_amounts_check" CHECK (
    "itemsValue" >= 0 AND "refundAmount" >= 0 AND "refundAmount" <= "itemsValue" AND length(trim("reason")) > 0),
  ADD CONSTRAINT "returns_decision_check" CHECK (
    ("status" = 'RECEIVED' AND "decidedAt" IS NULL AND "restocked" IS NULL AND "refundAmount" = 0)
    OR ("status" <> 'RECEIVED' AND "decidedAt" IS NOT NULL AND "decidedById" IS NOT NULL
        AND length(trim(coalesce("decisionNote", ''))) > 0)),
  ADD CONSTRAINT "returns_outcome_check" CHECK (
    ("status" <> 'REJECTED' OR ("refundAmount" = 0 AND "restocked" IS NULL))
    AND ("status" NOT IN ('REFUND_PENDING', 'COMPLETED') OR "restocked" IS NOT NULL)
    AND ("status" <> 'REFUND_PENDING' OR "refundAmount" > 0)
    AND (("refundedAt" IS NOT NULL) = ("status" = 'COMPLETED' AND "refundAmount" > 0)));

ALTER TABLE "return_items"
  ADD CONSTRAINT "return_items_quantity_check" CHECK ("quantity" > 0 AND "unitPrice" >= 0);

-- Un retour ne porte que sur une commande remise au client.
CREATE FUNCTION returns_check_insert() RETURNS trigger AS $$
BEGIN
  IF (SELECT "status" FROM "orders" WHERE "id" = NEW."orderId") IS DISTINCT FROM 'CLOSED' THEN
    RAISE EXCEPTION 'retour : la commande n''a pas été remise au client' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."status" <> 'RECEIVED' THEN
    RAISE EXCEPTION 'retour : un retour est enregistré « à vérifier »' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = pg_catalog, public;

CREATE TRIGGER returns_insert_rules
  BEFORE INSERT ON "returns"
  FOR EACH ROW EXECUTE FUNCTION returns_check_insert();

-- Cycle d'un retour : à vérifier → (remboursement attendu | traité | refusé) ; remboursement → traité.
-- Le contenu (commande, motif, valeur) ne change jamais ; la décision est figée une fois prise.
CREATE FUNCTION returns_check_update() RETURNS trigger AS $$
BEGIN
  IF NEW."number" <> OLD."number" OR NEW."orderId" <> OLD."orderId" OR NEW."reason" <> OLD."reason"
     OR NEW."itemsValue" <> OLD."itemsValue" OR NEW."idempotencyKey" <> OLD."idempotencyKey"
     OR NEW."createdById" <> OLD."createdById" THEN
    RAISE EXCEPTION 'retour : son contenu ne se modifie pas' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF OLD."status" <> 'RECEIVED' AND (
     NEW."refundAmount" <> OLD."refundAmount" OR NEW."restocked" IS DISTINCT FROM OLD."restocked"
     OR NEW."decisionNote" IS DISTINCT FROM OLD."decisionNote" OR NEW."decidedAt" IS DISTINCT FROM OLD."decidedAt"
     OR NEW."decidedById" IS DISTINCT FROM OLD."decidedById") THEN
    RAISE EXCEPTION 'retour : la décision est définitive' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW."status" <> OLD."status" AND NOT (
     (OLD."status" = 'RECEIVED' AND NEW."status" IN ('REFUND_PENDING', 'COMPLETED', 'REJECTED'))
     OR (OLD."status" = 'REFUND_PENDING' AND NEW."status" = 'COMPLETED')) THEN
    RAISE EXCEPTION 'retour : passage de % à % interdit', OLD."status", NEW."status" USING ERRCODE = 'check_violation';
  END IF;
  IF OLD."status" = 'REFUND_PENDING' AND NEW."status" = 'COMPLETED'
     AND NOT EXISTS (SELECT 1 FROM "payments" WHERE "returnId" = NEW."id") THEN
    RAISE EXCEPTION 'retour : remboursement non enregistré' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = pg_catalog, public;

CREATE TRIGGER returns_update_rules
  BEFORE UPDATE ON "returns"
  FOR EACH ROW EXECUTE FUNCTION returns_check_update();

CREATE FUNCTION returns_forbid_delete() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% est conservé : DELETE interdit', TG_TABLE_NAME USING ERRCODE = 'insufficient_privilege';
END;
$$ LANGUAGE plpgsql SET search_path = pg_catalog, public;

CREATE TRIGGER returns_no_delete
  BEFORE DELETE ON "returns"
  FOR EACH ROW EXECUTE FUNCTION returns_forbid_delete();

-- Lignes d'un retour : ajout seul, à la création ; quantité retournée ≤ quantité livrée
-- (retours refusés exclus), au prix figé de la commande. Le verrou de la ligne de commande
-- sérialise deux retours simultanés de la même ligne.
CREATE FUNCTION return_items_check_insert() RETURNS trigger AS $$
DECLARE
  item RECORD;
  r RECORD;
  already INTEGER;
BEGIN
  SELECT "orderId", "quantity", "unitPrice" INTO item FROM "order_items" WHERE "id" = NEW."orderItemId" FOR UPDATE;
  SELECT "orderId", "status" INTO r FROM "returns" WHERE "id" = NEW."returnId";
  IF r."status" IS DISTINCT FROM 'RECEIVED' THEN
    RAISE EXCEPTION 'retour : ses lignes sont fixées à son enregistrement' USING ERRCODE = 'check_violation';
  END IF;
  IF item."orderId" IS DISTINCT FROM r."orderId" THEN
    RAISE EXCEPTION 'retour : la ligne n''appartient pas à la commande' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."unitPrice" <> item."unitPrice" THEN
    RAISE EXCEPTION 'retour : prix différent du prix de la commande' USING ERRCODE = 'check_violation';
  END IF;
  SELECT coalesce(sum(ri."quantity"), 0) INTO already
    FROM "return_items" ri JOIN "returns" rr ON rr."id" = ri."returnId"
    WHERE ri."orderItemId" = NEW."orderItemId" AND rr."status" <> 'REJECTED';
  IF already + NEW."quantity" > item."quantity" THEN
    RAISE EXCEPTION 'retour : quantité retournée (%) supérieure à la quantité livrée (%)', already + NEW."quantity", item."quantity"
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = pg_catalog, public;

CREATE TRIGGER return_items_insert_rules
  BEFORE INSERT ON "return_items"
  FOR EACH ROW EXECUTE FUNCTION return_items_check_insert();

CREATE FUNCTION return_items_forbid_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'return_items est en ajout seul : % interdit', TG_OP USING ERRCODE = 'insufficient_privilege';
END;
$$ LANGUAGE plpgsql SET search_path = pg_catalog, public;

CREATE TRIGGER return_items_append_only
  BEFORE UPDATE OR DELETE ON "return_items"
  FOR EACH ROW EXECUTE FUNCTION return_items_forbid_mutation();

-- Valeur d'un retour = somme de ses lignes (au moins une), vérifiée à la validation.
CREATE FUNCTION returns_check_items_value() RETURNS trigger AS $$
DECLARE
  lines INTEGER;
  value INTEGER;
BEGIN
  SELECT count(*), coalesce(sum("quantity" * "unitPrice"), 0) INTO lines, value FROM "return_items" WHERE "returnId" = NEW."id";
  IF lines = 0 OR value <> NEW."itemsValue" THEN
    RAISE EXCEPTION 'retour % : valeur (%) différente de ses lignes (%)', NEW."number", NEW."itemsValue", value
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql SET search_path = pg_catalog, public;

CREATE CONSTRAINT TRIGGER returns_items_value_consistency
  AFTER INSERT ON "returns"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION returns_check_items_value();

-- ─── Livraisons ──────────────────────────────────────────────────────────────
ALTER TABLE "deliveries"
  ADD CONSTRAINT "deliveries_state_check" CHECK (
    "attempts" >= 0
    AND ("status" <> 'IN_TRANSIT' OR ("startedAt" IS NOT NULL AND "attempts" >= 1))
    AND ("status" <> 'DELIVERED' OR ("deliveredAt" IS NOT NULL AND length(trim(coalesce("recipientName", ''))) > 0))
    AND ("status" <> 'FAILED' OR length(trim(coalesce("failureReason", ''))) > 0));

ALTER TABLE "couriers"
  ADD CONSTRAINT "couriers_fields_check" CHECK (length(trim("name")) > 0 AND length(trim("phone")) > 0);

-- Seule une commande « livraison à domicile » a une livraison ; une livraison effectuée est définitive.
CREATE FUNCTION deliveries_check_rules() RETURNS trigger AS $$
BEGIN
  IF (SELECT "fulfillmentMethod" FROM "orders" WHERE "id" = NEW."orderId") IS DISTINCT FROM 'DELIVERY' THEN
    RAISE EXCEPTION 'livraison : la commande est à retirer en boutique' USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD."status" = 'DELIVERED' THEN
    RAISE EXCEPTION 'livraison effectuée : elle ne se modifie plus' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = pg_catalog, public;

CREATE TRIGGER deliveries_rules
  BEFORE INSERT OR UPDATE ON "deliveries"
  FOR EACH ROW EXECUTE FUNCTION deliveries_check_rules();

CREATE TRIGGER deliveries_no_delete
  BEFORE DELETE ON "deliveries"
  FOR EACH ROW EXECUTE FUNCTION returns_forbid_delete();

-- Livrée = remise au client : la commande est clôturée dans la même transaction.
CREATE FUNCTION deliveries_check_closed() RETURNS trigger AS $$
BEGIN
  IF NEW."status" = 'DELIVERED' AND (SELECT "status" FROM "orders" WHERE "id" = NEW."orderId") IS DISTINCT FROM 'CLOSED' THEN
    RAISE EXCEPTION 'livraison % : la commande n''est pas clôturée', NEW."id" USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql SET search_path = pg_catalog, public;

CREATE CONSTRAINT TRIGGER deliveries_delivered_closes_order
  AFTER INSERT OR UPDATE OF "status" ON "deliveries"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION deliveries_check_closed();
