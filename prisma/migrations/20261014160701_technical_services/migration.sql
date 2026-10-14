-- CreateEnum
CREATE TYPE "QuoteRequestStatus" AS ENUM ('NEW', 'IN_REVIEW', 'QUOTED', 'ACCEPTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "Urgency" AS ENUM ('NORMAL', 'URGENT');

-- CreateEnum
CREATE TYPE "QuoteStatus" AS ENUM ('DRAFT', 'SENT', 'ACCEPTED', 'REFUSED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "QuoteItemKind" AS ENUM ('MATERIAL', 'LABOR', 'TRAVEL', 'OTHER');

-- CreateEnum
CREATE TYPE "InterventionStatus" AS ENUM ('TO_SCHEDULE', 'SCHEDULED', 'IN_PROGRESS', 'DONE', 'CANCELLED');

-- AlterTable
ALTER TABLE "notifications" ADD COLUMN     "interventionId" TEXT,
ADD COLUMN     "quoteId" TEXT,
ADD COLUMN     "quoteRequestId" TEXT;

-- AlterTable
ALTER TABLE "payments" ADD COLUMN     "interventionId" TEXT,
ALTER COLUMN "orderId" DROP NOT NULL;

-- CreateTable
CREATE TABLE "quote_requests" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "serviceId" TEXT,
    "contact" JSONB NOT NULL,
    "address" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "urgency" "Urgency" NOT NULL DEFAULT 'NORMAL',
    "availability" TEXT,
    "status" "QuoteRequestStatus" NOT NULL DEFAULT 'NEW',
    "closingNote" TEXT,
    "internalNotes" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "quote_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quotes" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "quoteRequestId" TEXT,
    "customerId" TEXT NOT NULL,
    "status" "QuoteStatus" NOT NULL DEFAULT 'DRAFT',
    "validUntil" TIMESTAMPTZ(3) NOT NULL,
    "subtotal" INTEGER NOT NULL DEFAULT 0,
    "total" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "createdById" TEXT NOT NULL,
    "sentAt" TIMESTAMPTZ(3),
    "decidedAt" TIMESTAMPTZ(3),
    "decidedById" TEXT,
    "decisionNote" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "quotes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quote_items" (
    "id" TEXT NOT NULL,
    "quoteId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "kind" "QuoteItemKind" NOT NULL,
    "label" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitPrice" INTEGER NOT NULL,
    "lineTotal" INTEGER NOT NULL,

    CONSTRAINT "quote_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "technicians" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "skills" TEXT,
    "zones" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "technicians_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "interventions" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "quoteRequestId" TEXT,
    "quoteId" TEXT,
    "serviceId" TEXT,
    "contact" JSONB NOT NULL,
    "address" TEXT NOT NULL,
    "problem" TEXT NOT NULL,
    "technicianId" TEXT,
    "status" "InterventionStatus" NOT NULL DEFAULT 'TO_SCHEDULE',
    "amountDue" INTEGER NOT NULL,
    "amountPaid" INTEGER NOT NULL DEFAULT 0,
    "paymentStatus" "PaymentStatus" NOT NULL DEFAULT 'UNPAID',
    "startedAt" TIMESTAMPTZ(3),
    "completedAt" TIMESTAMPTZ(3),
    "cancelledAt" TIMESTAMPTZ(3),
    "customerSignOff" TEXT,
    "cancelReason" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "interventions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "appointments" (
    "id" TEXT NOT NULL,
    "interventionId" TEXT NOT NULL,
    "technicianId" TEXT NOT NULL,
    "startsAt" TIMESTAMPTZ(3) NOT NULL,
    "endsAt" TIMESTAMPTZ(3) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "appointments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "intervention_reports" (
    "id" TEXT NOT NULL,
    "interventionId" TEXT NOT NULL,
    "diagnosis" TEXT NOT NULL,
    "workDone" TEXT NOT NULL,
    "timeSpentMin" INTEGER NOT NULL,
    "observations" TEXT,
    "authorId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "intervention_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "intervention_parts" (
    "id" TEXT NOT NULL,
    "interventionId" TEXT NOT NULL,
    "variantId" TEXT,
    "label" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitCost" INTEGER,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "intervention_parts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoices" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "interventionId" TEXT NOT NULL,
    "issuedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lines" JSONB NOT NULL,
    "customer" JSONB NOT NULL,
    "total" INTEGER NOT NULL,
    "issuedById" TEXT NOT NULL,

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "quote_requests_number_key" ON "quote_requests"("number");

-- CreateIndex
CREATE INDEX "quote_requests_status_createdAt_idx" ON "quote_requests"("status", "createdAt");

-- CreateIndex
CREATE INDEX "quote_requests_customerId_createdAt_idx" ON "quote_requests"("customerId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "quotes_number_key" ON "quotes"("number");

-- CreateIndex
CREATE INDEX "quotes_status_validUntil_idx" ON "quotes"("status", "validUntil");

-- CreateIndex
CREATE INDEX "quotes_customerId_createdAt_idx" ON "quotes"("customerId", "createdAt");

-- CreateIndex
CREATE INDEX "quote_items_quoteId_position_idx" ON "quote_items"("quoteId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "technicians_userId_key" ON "technicians"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "interventions_number_key" ON "interventions"("number");

-- CreateIndex
CREATE UNIQUE INDEX "interventions_quoteId_key" ON "interventions"("quoteId");

-- CreateIndex
CREATE INDEX "interventions_status_createdAt_idx" ON "interventions"("status", "createdAt");

-- CreateIndex
CREATE INDEX "interventions_technicianId_status_idx" ON "interventions"("technicianId", "status");

-- CreateIndex
CREATE INDEX "interventions_customerId_createdAt_idx" ON "interventions"("customerId", "createdAt");

-- CreateIndex
CREATE INDEX "appointments_technicianId_startsAt_idx" ON "appointments"("technicianId", "startsAt");

-- CreateIndex
CREATE INDEX "appointments_interventionId_idx" ON "appointments"("interventionId");

-- CreateIndex
CREATE UNIQUE INDEX "intervention_reports_interventionId_key" ON "intervention_reports"("interventionId");

-- CreateIndex
CREATE INDEX "intervention_parts_interventionId_idx" ON "intervention_parts"("interventionId");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_number_key" ON "invoices"("number");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_interventionId_key" ON "invoices"("interventionId");

-- CreateIndex
CREATE INDEX "notifications_quoteRequestId_idx" ON "notifications"("quoteRequestId");

-- CreateIndex
CREATE INDEX "notifications_quoteId_idx" ON "notifications"("quoteId");

-- CreateIndex
CREATE INDEX "notifications_interventionId_idx" ON "notifications"("interventionId");

-- CreateIndex
CREATE INDEX "payments_interventionId_createdAt_idx" ON "payments"("interventionId", "createdAt");

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_interventionId_fkey" FOREIGN KEY ("interventionId") REFERENCES "interventions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quote_requests" ADD CONSTRAINT "quote_requests_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quote_requests" ADD CONSTRAINT "quote_requests_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "services"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_quoteRequestId_fkey" FOREIGN KEY ("quoteRequestId") REFERENCES "quote_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quote_items" ADD CONSTRAINT "quote_items_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "quotes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "technicians" ADD CONSTRAINT "technicians_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "interventions" ADD CONSTRAINT "interventions_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "interventions" ADD CONSTRAINT "interventions_quoteRequestId_fkey" FOREIGN KEY ("quoteRequestId") REFERENCES "quote_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "interventions" ADD CONSTRAINT "interventions_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "quotes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "interventions" ADD CONSTRAINT "interventions_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "services"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "interventions" ADD CONSTRAINT "interventions_technicianId_fkey" FOREIGN KEY ("technicianId") REFERENCES "technicians"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_interventionId_fkey" FOREIGN KEY ("interventionId") REFERENCES "interventions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_technicianId_fkey" FOREIGN KEY ("technicianId") REFERENCES "technicians"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "intervention_reports" ADD CONSTRAINT "intervention_reports_interventionId_fkey" FOREIGN KEY ("interventionId") REFERENCES "interventions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "intervention_parts" ADD CONSTRAINT "intervention_parts_interventionId_fkey" FOREIGN KEY ("interventionId") REFERENCES "interventions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "intervention_parts" ADD CONSTRAINT "intervention_parts_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "product_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_interventionId_fkey" FOREIGN KEY ("interventionId") REFERENCES "interventions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ─── Contraintes métier ─────────────────────────────────────────────────────

ALTER TABLE "quote_items"
  ADD CONSTRAINT "quote_items_amounts_check" CHECK (
    "quantity" > 0 AND "unitPrice" >= 0 AND "lineTotal" = "quantity" * "unitPrice" AND length(trim("label")) > 0);

ALTER TABLE "quotes"
  ADD CONSTRAINT "quotes_amounts_check" CHECK ("subtotal" >= 0 AND "total" = "subtotal");

ALTER TABLE "interventions"
  ADD CONSTRAINT "interventions_amounts_check" CHECK ("amountDue" >= 0 AND "amountPaid" >= 0 AND "amountPaid" <= "amountDue");

ALTER TABLE "intervention_parts"
  ADD CONSTRAINT "intervention_parts_quantity_check" CHECK ("quantity" > 0 AND ("unitCost" IS NULL OR "unitCost" >= 0));

ALTER TABLE "intervention_reports"
  ADD CONSTRAINT "intervention_reports_time_check" CHECK ("timeSpentMin" > 0);

ALTER TABLE "invoices"
  ADD CONSTRAINT "invoices_total_check" CHECK ("total" >= 0);

-- Un encaissement porte sur exactement une commande OU une intervention.
ALTER TABLE "payments"
  ADD CONSTRAINT "payments_target_check" CHECK (("orderId" IS NULL) <> ("interventionId" IS NULL));

-- Planning : deux créneaux d'un même technicien ne se chevauchent jamais.
CREATE EXTENSION IF NOT EXISTS btree_gist;
ALTER TABLE "appointments"
  ADD CONSTRAINT "appointments_range_check" CHECK ("endsAt" > "startsAt"),
  ADD CONSTRAINT "appointments_no_overlap" EXCLUDE USING gist (
    "technicianId" WITH =, tstzrange("startsAt", "endsAt", '[)') WITH &&);

-- Factures : figées à l'émission, en ajout seul.
CREATE FUNCTION invoices_forbid_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'invoices est en ajout seul : % interdit', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$ LANGUAGE plpgsql SET search_path = pg_catalog, public;

CREATE TRIGGER invoices_append_only
  BEFORE UPDATE OR DELETE ON "invoices"
  FOR EACH ROW EXECUTE FUNCTION invoices_forbid_mutation();

-- ─── Encaissements : commandes et interventions ────────────────────────────

-- Contre-écriture : même cible (commande ou intervention) que l'encaissement annulé.
CREATE OR REPLACE FUNCTION payments_check_reversal() RETURNS trigger AS $$
DECLARE
  original RECORD;
BEGIN
  IF NEW."reversesPaymentId" IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT "orderId", "interventionId", "amount", "reversesPaymentId" INTO original FROM "payments" WHERE "id" = NEW."reversesPaymentId";
  IF original."reversesPaymentId" IS NOT NULL THEN
    RAISE EXCEPTION 'une contre-écriture ne peut pas être annulée' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."amount" <> -original."amount"
     OR NEW."orderId" IS DISTINCT FROM original."orderId"
     OR NEW."interventionId" IS DISTINCT FROM original."interventionId" THEN
    RAISE EXCEPTION 'contre-écriture incohérente avec l''encaissement annulé' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = pg_catalog, public;

-- Montant encaissé = somme des écritures, pour les commandes comme pour les interventions.
DROP TRIGGER payments_amount_paid_consistency ON "payments";
DROP TRIGGER orders_amount_paid_consistency ON "orders";
DROP FUNCTION orders_check_amount_paid();

CREATE FUNCTION check_amount_paid() RETURNS trigger AS $$
DECLARE
  order_id TEXT;
  intervention_id TEXT;
  paid INTEGER;
  recorded INTEGER;
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
    SELECT "amountPaid" INTO paid FROM "orders" WHERE "id" = order_id;
    SELECT coalesce(sum("amount"), 0) INTO recorded FROM "payments" WHERE "orderId" = order_id;
    IF paid IS DISTINCT FROM recorded THEN
      RAISE EXCEPTION 'commande % : montant encaissé (%) différent de la somme des encaissements (%)', order_id, paid, recorded
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

CREATE CONSTRAINT TRIGGER payments_amount_paid_consistency
  AFTER INSERT ON "payments"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION check_amount_paid();

CREATE CONSTRAINT TRIGGER orders_amount_paid_consistency
  AFTER UPDATE OF "amountPaid" ON "orders"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION check_amount_paid();

CREATE CONSTRAINT TRIGGER interventions_amount_paid_consistency
  AFTER UPDATE OF "amountPaid" ON "interventions"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION check_amount_paid();
