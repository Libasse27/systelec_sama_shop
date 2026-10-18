-- Phase 10 : décisions du propriétaire (voir docs/03-plan-et-decisions.md, § 4).
--   Décision 1 : remboursement versé par une autre personne que celle qui a décidé (exception motivée).
--   Décision 2 : retour déclaré par le client lui-même ; photos privées.
--   Décision 4 : relances d'une vérification sans réponse (suivi posé par la base).
--   Décision 5 : livreurs internes reliés à un compte ; transporteurs externes sans compte.
-- CreateEnum
CREATE TYPE "CourierKind" AS ENUM ('INTERNAL', 'EXTERNAL');

-- CreateEnum
CREATE TYPE "ReturnDeclarationSource" AS ENUM ('STAFF', 'CUSTOMER');

-- AlterTable
ALTER TABLE "couriers" ADD COLUMN     "kind" "CourierKind" NOT NULL DEFAULT 'EXTERNAL',
ADD COLUMN     "userId" TEXT;

-- AlterTable
ALTER TABLE "returns" ADD COLUMN     "declaredBy" "ReturnDeclarationSource" NOT NULL DEFAULT 'STAFF',
ADD COLUMN     "refundExceptionNote" TEXT,
ADD COLUMN     "verificationReminderStage" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "verificationRequestedAt" TIMESTAMPTZ(3),
ALTER COLUMN "createdById" DROP NOT NULL;

-- CreateTable
CREATE TABLE "return_attachments" (
    "id" TEXT NOT NULL,
    "returnId" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "byteSize" INTEGER NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "return_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "return_attachments_storageKey_key" ON "return_attachments"("storageKey");

-- CreateIndex
CREATE INDEX "return_attachments_returnId_createdAt_idx" ON "return_attachments"("returnId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "couriers_userId_key" ON "couriers"("userId");

-- AddForeignKey
ALTER TABLE "couriers" ADD CONSTRAINT "couriers_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "return_attachments" ADD CONSTRAINT "return_attachments_returnId_fkey" FOREIGN KEY ("returnId") REFERENCES "returns"("id") ON DELETE RESTRICT ON UPDATE CASCADE;



-- ═══ Décision 5 : livreurs ═══════════════════════════════════════════════════
-- Les livreurs existants n'ont pas de compte : ils sont repris comme transporteurs externes, à relier
-- ensuite à un compte depuis « Livraison et retrait » s'il s'agit de livreurs internes.
ALTER TABLE "couriers"
  ADD CONSTRAINT "couriers_account_check" CHECK (("kind" = 'INTERNAL') = ("userId" IS NOT NULL));


-- ═══ Décision 2 : déclaration par le client ══════════════════════════════════
-- Reprise : un retour déjà en « vérification demandée » reçoit la date de sa dernière demande (avant les
-- contraintes et le nouveau trigger, qui fige ensuite cette date).
UPDATE "returns" r
   SET "verificationRequestedAt" = coalesce(
         (SELECT max(e."createdAt") FROM "return_events" e WHERE e."returnId" = r."id" AND e."type" = 'VERIFICATION_REQUESTED'),
         r."updatedAt")
 WHERE r."status" = 'VERIFICATION';

ALTER TABLE "returns"
  -- Le personnel déclarant est connu ; le client qui déclare lui-même est celui de la commande.
  ADD CONSTRAINT "returns_declarer_check" CHECK (("declaredBy" = 'STAFF') = ("createdById" IS NOT NULL)),
  -- Relances : de 0 à 3 (première relance, seconde relance, escalade), seulement pendant une vérification.
  ADD CONSTRAINT "returns_reminder_check" CHECK (
    "verificationReminderStage" BETWEEN 0 AND 3
    AND (("status" = 'VERIFICATION') = ("verificationRequestedAt" IS NOT NULL))
    AND ("status" = 'VERIFICATION' OR "verificationReminderStage" = 0)),
  ADD CONSTRAINT "returns_refund_exception_check" CHECK (
    "refundExceptionNote" IS NULL OR ("status" = 'COMPLETED' AND length(trim("refundExceptionNote")) > 0));

-- Enregistrement : date de remise, délai, indicateur « hors délai » et date d'enregistrement posés par
-- la base ; suivi des relances et exception de remboursement vides.
CREATE OR REPLACE FUNCTION returns_check_insert() RETURNS trigger AS $$
DECLARE
  o RECORD;
BEGIN
  SELECT "status", "closedAt" INTO o FROM "orders" WHERE "id" = NEW."orderId";
  IF o."status" IS DISTINCT FROM 'CLOSED' THEN
    RAISE EXCEPTION 'retour : la commande n''a pas été remise au client' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."status" <> 'RECEIVED' THEN
    RAISE EXCEPTION 'retour : un retour est enregistré « à vérifier »' USING ERRCODE = 'check_violation';
  END IF;
  NEW."createdAt" := now();
  NEW."handedOverAt" := coalesce(o."closedAt", now());
  NEW."declarationDeadline" := NEW."handedOverAt" + interval '48 hours';
  NEW."lateDeclaration" := NEW."createdAt" > NEW."declarationDeadline";
  NEW."firstActionAt" := NULL;
  NEW."overdueNotifiedAt" := NULL;
  NEW."exceptionGround" := NULL;
  NEW."exceptionNote" := NULL;
  NEW."verificationRequestedAt" := NULL;
  NEW."verificationReminderStage" := 0;
  NEW."refundExceptionNote" := NULL;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = pg_catalog, public;

-- Cycle : à examiner → (vérification demandée → à examiner)* → décision ; remboursement → traité.
-- Contenu et délais figés ; décision définitive ; décidée par une autre personne que le déclarant ;
-- hors délai accepté seulement avec un fondement et un motif d'exception ; première action et
-- alerte de délai posées une seule fois. Phase 10 : suivi des relances posé par la base (croissant) ;
-- remboursement versé par une autre personne que le décideur, sauf exception motivée.
CREATE OR REPLACE FUNCTION returns_check_update() RETURNS trigger AS $$
DECLARE
  refunder TEXT;
BEGIN
  IF NEW."number" <> OLD."number" OR NEW."orderId" <> OLD."orderId" OR NEW."reason" <> OLD."reason"
     OR NEW."itemsValue" <> OLD."itemsValue" OR NEW."idempotencyKey" <> OLD."idempotencyKey"
     OR NEW."createdById" IS DISTINCT FROM OLD."createdById" OR NEW."declaredBy" <> OLD."declaredBy"
     OR NEW."createdAt" <> OLD."createdAt"
     OR NEW."handedOverAt" <> OLD."handedOverAt" OR NEW."declarationDeadline" <> OLD."declarationDeadline"
     OR NEW."lateDeclaration" <> OLD."lateDeclaration" THEN
    RAISE EXCEPTION 'retour : son contenu ne se modifie pas' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF OLD."status" NOT IN ('RECEIVED', 'VERIFICATION') AND (
     NEW."refundAmount" <> OLD."refundAmount" OR NEW."restocked" IS DISTINCT FROM OLD."restocked"
     OR NEW."decisionNote" IS DISTINCT FROM OLD."decisionNote" OR NEW."decidedAt" IS DISTINCT FROM OLD."decidedAt"
     OR NEW."decidedById" IS DISTINCT FROM OLD."decidedById"
     OR NEW."exceptionGround" IS DISTINCT FROM OLD."exceptionGround" OR NEW."exceptionNote" IS DISTINCT FROM OLD."exceptionNote") THEN
    RAISE EXCEPTION 'retour : la décision est définitive' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF (OLD."firstActionAt" IS NOT NULL AND NEW."firstActionAt" IS DISTINCT FROM OLD."firstActionAt")
     OR (OLD."overdueNotifiedAt" IS NOT NULL AND NEW."overdueNotifiedAt" IS DISTINCT FROM OLD."overdueNotifiedAt") THEN
    RAISE EXCEPTION 'retour : l''historique des délais ne se modifie pas' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW."status" <> OLD."status" AND NOT (
     (OLD."status" = 'RECEIVED' AND NEW."status" IN ('VERIFICATION', 'REFUND_PENDING', 'COMPLETED', 'REJECTED'))
     OR (OLD."status" = 'VERIFICATION' AND NEW."status" = 'RECEIVED')
     OR (OLD."status" = 'REFUND_PENDING' AND NEW."status" = 'COMPLETED')) THEN
    RAISE EXCEPTION 'retour : passage de % à % interdit', OLD."status", NEW."status" USING ERRCODE = 'check_violation';
  END IF;
  -- Première action du personnel : la première sortie de « à examiner ».
  IF OLD."status" = 'RECEIVED' AND NEW."status" <> 'RECEIVED' AND NEW."firstActionAt" IS NULL THEN
    NEW."firstActionAt" := now();
  END IF;
  -- Relances (décision 4) : chaque demande de vérification repart de zéro ; la réponse arrête tout ;
  -- pendant l'attente, le palier ne fait que progresser et la date de la demande est figée.
  IF OLD."status" <> 'VERIFICATION' AND NEW."status" = 'VERIFICATION' THEN
    NEW."verificationRequestedAt" := now();
    NEW."verificationReminderStage" := 0;
  ELSIF NEW."status" <> 'VERIFICATION' THEN
    NEW."verificationRequestedAt" := NULL;
    NEW."verificationReminderStage" := 0;
  ELSIF NEW."verificationRequestedAt" IS DISTINCT FROM OLD."verificationRequestedAt"
        OR NEW."verificationReminderStage" < OLD."verificationReminderStage" THEN
    RAISE EXCEPTION 'retour : le suivi des relances ne se modifie pas' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF OLD."status" = 'RECEIVED' AND NEW."status" IN ('REFUND_PENDING', 'COMPLETED', 'REJECTED') THEN
    IF NEW."decidedById" = NEW."createdById" THEN
      RAISE EXCEPTION 'retour : la personne qui l''a déclaré ne peut pas le décider' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF NEW."status" <> 'REJECTED' AND NEW."lateDeclaration" AND NEW."exceptionGround" IS NULL THEN
      RAISE EXCEPTION 'retour hors délai : fondement et motif d''exception obligatoires pour l''accepter' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  IF NEW."status" = 'COMPLETED' AND NEW."refundAmount" > 0
     AND NOT EXISTS (SELECT 1 FROM "payments" WHERE "returnId" = NEW."id") THEN
    RAISE EXCEPTION 'retour : remboursement non enregistré' USING ERRCODE = 'check_violation';
  END IF;
  -- Décision 1 : l'exception de remboursement ne s'écrit qu'au versement, une seule fois.
  IF NEW."refundExceptionNote" IS DISTINCT FROM OLD."refundExceptionNote"
     AND NOT (OLD."status" = 'REFUND_PENDING' AND NEW."status" = 'COMPLETED') THEN
    RAISE EXCEPTION 'retour : l''exception de remboursement ne se modifie pas' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF OLD."status" = 'REFUND_PENDING' AND NEW."status" = 'COMPLETED' THEN
    SELECT "recordedById" INTO refunder FROM "payments" WHERE "returnId" = NEW."id";
    IF refunder = NEW."decidedById" AND NEW."refundExceptionNote" IS NULL THEN
      RAISE EXCEPTION 'retour : la personne qui l''a décidé ne verse pas le remboursement (exception motivée exigée)' USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = pg_catalog, public;

-- Historique : une étape sans auteur interne est une action du système (alertes, relances) ou du client.
ALTER TABLE "return_events" DROP CONSTRAINT "return_events_comment_check";
ALTER TABLE "return_events"
  ADD CONSTRAINT "return_events_comment_check" CHECK (
    ("type" NOT IN ('VERIFICATION_REQUESTED', 'VERIFICATION_ANSWERED', 'ACCEPTED', 'REJECTED')
      OR length(trim(coalesce("comment", ''))) > 0)
    AND (("type" = 'VERIFICATION_REQUESTED') = ("verificationKind" IS NOT NULL))
    AND ("actorId" IS NOT NULL
         OR "type" IN ('OVERDUE_NOTIFIED', 'VERIFICATION_REMINDED', 'VERIFICATION_ESCALATED')
         OR ("type" IN ('DECLARED', 'VERIFICATION_ANSWERED') AND "details" ->> 'by' = 'customer')));

-- Photos jointes : ajout seul, fichier privé de forme stricte, 3 au plus par retour et par étape d'envoi
-- (contrôlé par le service), taille bornée.
ALTER TABLE "return_attachments"
  ADD CONSTRAINT "return_attachments_file_check" CHECK (
    "storageKey" ~ '^retours/[a-z0-9]{1,64}/photo-[a-f0-9-]{36}\.(jpg|png|webp)$'
    AND "contentType" IN ('image/jpeg', 'image/png', 'image/webp')
    AND "byteSize" > 0 AND "byteSize" <= 2097152);

CREATE FUNCTION return_attachments_forbid_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'return_attachments est en ajout seul : % interdit', TG_OP USING ERRCODE = 'insufficient_privilege';
END;
$$ LANGUAGE plpgsql SET search_path = pg_catalog, public;

CREATE TRIGGER return_attachments_append_only
  BEFORE UPDATE OR DELETE ON "return_attachments"
  FOR EACH ROW EXECUTE FUNCTION return_attachments_forbid_mutation();

CREATE FUNCTION return_attachments_check_insert() RETURNS trigger AS $$
BEGIN
  NEW."createdAt" := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = pg_catalog, public;

CREATE TRIGGER return_attachments_insert_rules
  BEFORE INSERT ON "return_attachments"
  FOR EACH ROW EXECUTE FUNCTION return_attachments_check_insert();

-- Validation indépendante, retour déclaré par le client : le titulaire du compte client de la commande
-- (un membre du personnel qui commande pour lui-même, par exemple) ne décide pas son propre retour.
CREATE FUNCTION returns_check_customer_declarer() RETURNS trigger AS $$
BEGIN
  IF NEW."declaredBy" = 'CUSTOMER' AND OLD."status" = 'RECEIVED' AND NEW."status" IN ('REFUND_PENDING', 'COMPLETED', 'REJECTED')
     AND NEW."decidedById" = (SELECT c."userId" FROM "orders" o JOIN "customers" c ON c."id" = o."customerId" WHERE o."id" = NEW."orderId") THEN
    RAISE EXCEPTION 'retour : la personne qui l''a déclaré ne peut pas le décider' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = pg_catalog, public;

CREATE TRIGGER returns_customer_declarer_rules
  BEFORE UPDATE ON "returns"
  FOR EACH ROW EXECUTE FUNCTION returns_check_customer_declarer();
