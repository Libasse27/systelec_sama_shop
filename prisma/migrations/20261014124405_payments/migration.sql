-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('CASH');

-- CreateTable
CREATE TABLE "payments" (
    "id" TEXT NOT NULL,
    "receiptNumber" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "method" "PaymentMethod" NOT NULL DEFAULT 'CASH',
    "balanceAfter" INTEGER NOT NULL,
    "recordedById" TEXT NOT NULL,
    "idempotencyKey" TEXT,
    "reversesPaymentId" TEXT,
    "reason" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "payments_receiptNumber_key" ON "payments"("receiptNumber");

-- CreateIndex
CREATE UNIQUE INDEX "payments_idempotencyKey_key" ON "payments"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "payments_reversesPaymentId_key" ON "payments"("reversesPaymentId");

-- CreateIndex
CREATE INDEX "payments_orderId_createdAt_idx" ON "payments"("orderId", "createdAt");

-- CreateIndex
CREATE INDEX "payments_createdAt_idx" ON "payments"("createdAt");

-- CreateIndex
CREATE INDEX "payments_recordedById_createdAt_idx" ON "payments"("recordedById", "createdAt");

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_reversesPaymentId_fkey" FOREIGN KEY ("reversesPaymentId") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Montants : encaissement > 0, contre-écriture < 0 (et seulement elle), motif obligatoire.
ALTER TABLE "payments"
  ADD CONSTRAINT "payments_amount_check" CHECK ("amount" <> 0 AND (("reversesPaymentId" IS NULL) = ("amount" > 0))),
  ADD CONSTRAINT "payments_reason_check" CHECK ("reversesPaymentId" IS NULL OR length(trim(coalesce("reason", ''))) > 0),
  ADD CONSTRAINT "payments_balance_check" CHECK ("balanceAfter" >= 0);

-- Une commande n'est jamais encaissée au-delà de son total.
ALTER TABLE "orders"
  ADD CONSTRAINT "orders_amount_paid_check" CHECK ("amountPaid" <= "total");

-- Contre-écriture : exactement l'opposé d'un encaissement de la même commande, jamais d'une autre contre-écriture.
CREATE FUNCTION payments_check_reversal() RETURNS trigger AS $$
DECLARE
  original RECORD;
BEGIN
  IF NEW."reversesPaymentId" IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT "orderId", "amount", "reversesPaymentId" INTO original FROM "payments" WHERE "id" = NEW."reversesPaymentId";
  IF original."reversesPaymentId" IS NOT NULL THEN
    RAISE EXCEPTION 'une contre-écriture ne peut pas être annulée' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."amount" <> -original."amount" OR NEW."orderId" <> original."orderId" THEN
    RAISE EXCEPTION 'contre-écriture incohérente avec l''encaissement annulé' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER payments_reversal_consistency
  BEFORE INSERT ON "payments"
  FOR EACH ROW EXECUTE FUNCTION payments_check_reversal();

-- Encaissements : ajout seul, comme l'audit et le journal de stock.
CREATE FUNCTION payments_forbid_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'payments est en ajout seul : % interdit', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER payments_append_only
  BEFORE UPDATE OR DELETE ON "payments"
  FOR EACH ROW EXECUTE FUNCTION payments_forbid_mutation();
