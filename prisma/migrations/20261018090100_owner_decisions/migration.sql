-- Correctifs post-phase 9 : décisions du propriétaire (voir docs/03-plan-et-decisions.md).
--   Décision 2 : politique de retours (délais, vérification, validation indépendante, historique, exceptions).
--   Décision 4 : logo téléversé uniquement ; partenaires (logo téléversé uniquement).
--   Décision 5 : une commande à livrer n'est remise au client que par une livraison effectuée.

-- CreateEnum
CREATE TYPE "ReturnVerificationKind" AS ENUM ('INSPECTION', 'PHOTOS', 'INVOICE', 'INFORMATION');

-- CreateEnum
CREATE TYPE "ReturnExceptionGround" AS ENUM ('WARRANTY', 'HIDDEN_DEFECT', 'LEGAL_OBLIGATION', 'OTHER');

-- CreateEnum
CREATE TYPE "ReturnEventType" AS ENUM ('DECLARED', 'VERIFICATION_REQUESTED', 'VERIFICATION_ANSWERED', 'ACCEPTED', 'REJECTED', 'REFUNDED', 'OVERDUE_NOTIFIED');

-- AlterTable
ALTER TABLE "notifications" ADD COLUMN "returnId" TEXT;

-- AlterTable (colonnes obligatoires remplies ci-dessous pour les retours existants)
ALTER TABLE "returns" ADD COLUMN "declarationDeadline" TIMESTAMPTZ(3),
ADD COLUMN "exceptionGround" "ReturnExceptionGround",
ADD COLUMN "exceptionNote" TEXT,
ADD COLUMN "firstActionAt" TIMESTAMPTZ(3),
ADD COLUMN "handedOverAt" TIMESTAMPTZ(3),
ADD COLUMN "lateDeclaration" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "overdueNotifiedAt" TIMESTAMPTZ(3);

-- CreateTable
CREATE TABLE "return_events" (
    "id" TEXT NOT NULL,
    "returnId" TEXT NOT NULL,
    "type" "ReturnEventType" NOT NULL,
    "fromStatus" "ReturnStatus",
    "toStatus" "ReturnStatus" NOT NULL,
    "actorId" TEXT,
    "comment" TEXT,
    "verificationKind" "ReturnVerificationKind",
    "details" JSONB,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "return_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "partners" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "websiteUrl" TEXT,
    "logoUrl" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "partners_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "return_events_returnId_createdAt_idx" ON "return_events"("returnId", "createdAt");

-- CreateIndex
CREATE INDEX "partners_isActive_position_idx" ON "partners"("isActive", "position");

-- CreateIndex
CREATE INDEX "notifications_returnId_idx" ON "notifications"("returnId");

-- CreateIndex
CREATE INDEX "returns_lateDeclaration_createdAt_idx" ON "returns"("lateDeclaration", "createdAt");

-- AddForeignKey
ALTER TABLE "return_events" ADD CONSTRAINT "return_events_returnId_fkey" FOREIGN KEY ("returnId") REFERENCES "returns"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ═══ Décision 2 : reprise des retours existants ═════════════════════════════
-- Date de référence : la remise au client (clôture de la commande : retrait ou livraison effectuée).
-- Seules les nouvelles colonnes sont écrites : le trigger de mise à jour en place les ignore.
UPDATE "returns" r
   SET "handedOverAt" = coalesce(o."closedAt", r."createdAt")
  FROM "orders" o
 WHERE o."id" = r."orderId";

UPDATE "returns"
   SET "declarationDeadline" = "handedOverAt" + interval '48 hours',
       "firstActionAt" = "decidedAt";

UPDATE "returns" SET "lateDeclaration" = ("createdAt" > "declarationDeadline");

ALTER TABLE "returns" ALTER COLUMN "handedOverAt" SET NOT NULL,
ALTER COLUMN "declarationDeadline" SET NOT NULL;

-- Historique reconstitué depuis les champs des retours existants (marqué « reprise »).
INSERT INTO "return_events" ("id", "returnId", "type", "fromStatus", "toStatus", "actorId", "comment", "details", "createdAt")
SELECT gen_random_uuid()::text, "id", 'DECLARED', NULL, 'RECEIVED', "createdById", "reason",
       jsonb_build_object('lateDeclaration', "lateDeclaration", 'reprise', true), "createdAt"
  FROM "returns";

INSERT INTO "return_events" ("id", "returnId", "type", "fromStatus", "toStatus", "actorId", "comment", "details", "createdAt")
SELECT gen_random_uuid()::text, "id",
       'ACCEPTED',
       'RECEIVED',
       CASE WHEN "refundAmount" > 0 THEN 'REFUND_PENDING'::"ReturnStatus" ELSE 'COMPLETED'::"ReturnStatus" END,
       "decidedById", "decisionNote",
       jsonb_build_object('refundAmount', "refundAmount", 'restocked', "restocked", 'reprise', true), "decidedAt"
  FROM "returns" WHERE "decidedAt" IS NOT NULL AND "status" <> 'REJECTED';

INSERT INTO "return_events" ("id", "returnId", "type", "fromStatus", "toStatus", "actorId", "comment", "details", "createdAt")
SELECT gen_random_uuid()::text, "id", 'REJECTED', 'RECEIVED', 'REJECTED', "decidedById", "decisionNote",
       jsonb_build_object('reprise', true), "decidedAt"
  FROM "returns" WHERE "status" = 'REJECTED';

INSERT INTO "return_events" ("id", "returnId", "type", "fromStatus", "toStatus", "actorId", "comment", "details", "createdAt")
SELECT gen_random_uuid()::text, r."id", 'REFUNDED', 'REFUND_PENDING', 'COMPLETED', p."recordedById", p."reason",
       jsonb_build_object('receiptNumber', p."receiptNumber", 'amount', -p."amount", 'reprise', true), p."createdAt"
  FROM "returns" r JOIN "payments" p ON p."returnId" = r."id";


-- ═══ Décision 2 : intégrité des retours ══════════════════════════════════════
ALTER TABLE "returns"
  DROP CONSTRAINT "returns_decision_check";

ALTER TABLE "returns"
  -- « À examiner » et « vérification demandée » : rien n'est encore décidé.
  ADD CONSTRAINT "returns_decision_check" CHECK (
    ("status" IN ('RECEIVED', 'VERIFICATION') AND "decidedAt" IS NULL AND "decidedById" IS NULL AND "restocked" IS NULL AND "refundAmount" = 0)
    OR ("status" NOT IN ('RECEIVED', 'VERIFICATION') AND "decidedAt" IS NOT NULL AND "decidedById" IS NOT NULL
        AND length(trim(coalesce("decisionNote", ''))) > 0)),
  -- Délai de déclaration : remise + 48 h ; « hors délai » cohérent avec la date d'enregistrement.
  ADD CONSTRAINT "returns_declaration_check" CHECK (
    "declarationDeadline" = "handedOverAt" + interval '48 hours'
    AND "lateDeclaration" = ("createdAt" > "declarationDeadline")),
  -- Exception : seulement pour un retour hors délai accepté, fondement et motif ensemble.
  ADD CONSTRAINT "returns_exception_check" CHECK (
    ("exceptionGround" IS NULL) = ("exceptionNote" IS NULL)
    AND ("exceptionNote" IS NULL OR length(trim("exceptionNote")) > 0)
    AND ("exceptionGround" IS NULL OR ("lateDeclaration" AND "status" IN ('REFUND_PENDING', 'COMPLETED'))));

-- Enregistrement : la date de remise, le délai, l'indicateur « hors délai » et la date d'enregistrement
-- sont posés par la base (jamais fournis par l'application ni par un INSERT direct).
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
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = pg_catalog, public;

-- Cycle : à examiner → (vérification demandée → à examiner)* → décision ; remboursement → traité.
-- Contenu et délais figés ; décision définitive ; décidée par une autre personne que le déclarant ;
-- hors délai accepté seulement avec un fondement et un motif d'exception ; première action et
-- alerte de délai posées une seule fois.
CREATE OR REPLACE FUNCTION returns_check_update() RETURNS trigger AS $$
BEGIN
  IF NEW."number" <> OLD."number" OR NEW."orderId" <> OLD."orderId" OR NEW."reason" <> OLD."reason"
     OR NEW."itemsValue" <> OLD."itemsValue" OR NEW."idempotencyKey" <> OLD."idempotencyKey"
     OR NEW."createdById" <> OLD."createdById" OR NEW."createdAt" <> OLD."createdAt"
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
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = pg_catalog, public;

-- Historique d'un retour : ajout seul ; chaque étape reflète le statut du retour au moment de l'écriture.
CREATE FUNCTION return_events_check_insert() RETURNS trigger AS $$
BEGIN
  IF (SELECT "status" FROM "returns" WHERE "id" = NEW."returnId") IS DISTINCT FROM NEW."toStatus" THEN
    RAISE EXCEPTION 'historique du retour : statut % différent du statut du retour', NEW."toStatus" USING ERRCODE = 'check_violation';
  END IF;
  NEW."createdAt" := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = pg_catalog, public;

CREATE TRIGGER return_events_insert_rules
  BEFORE INSERT ON "return_events"
  FOR EACH ROW EXECUTE FUNCTION return_events_check_insert();

CREATE FUNCTION return_events_forbid_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'return_events est en ajout seul : % interdit', TG_OP USING ERRCODE = 'insufficient_privilege';
END;
$$ LANGUAGE plpgsql SET search_path = pg_catalog, public;

CREATE TRIGGER return_events_append_only
  BEFORE UPDATE OR DELETE ON "return_events"
  FOR EACH ROW EXECUTE FUNCTION return_events_forbid_mutation();

ALTER TABLE "return_events"
  ADD CONSTRAINT "return_events_comment_check" CHECK (
    ("type" NOT IN ('VERIFICATION_REQUESTED', 'VERIFICATION_ANSWERED', 'ACCEPTED', 'REJECTED')
      OR length(trim(coalesce("comment", ''))) > 0)
    AND (("type" = 'VERIFICATION_REQUESTED') = ("verificationKind" IS NOT NULL))
    AND ("actorId" IS NOT NULL OR "type" = 'OVERDUE_NOTIFIED'));


-- ═══ Décision 5 : une commande à livrer n'est remise que par sa livraison ════
-- Vérifié à la validation : la livraison est marquée effectuée dans la même transaction que la clôture.
CREATE FUNCTION orders_check_delivery_closure() RETURNS trigger AS $$
BEGIN
  IF NEW."status" = 'CLOSED' AND NEW."fulfillmentMethod" = 'DELIVERY'
     AND (TG_OP = 'INSERT' OR OLD."status" IS DISTINCT FROM 'CLOSED' OR OLD."fulfillmentMethod" IS DISTINCT FROM 'DELIVERY')
     AND NOT EXISTS (SELECT 1 FROM "deliveries" WHERE "orderId" = NEW."id" AND "status" = 'DELIVERED') THEN
    RAISE EXCEPTION 'commande % à livrer : elle n''est remise au client que par une livraison effectuée', NEW."number"
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql SET search_path = pg_catalog, public;

CREATE CONSTRAINT TRIGGER orders_delivery_closed_by_courier
  AFTER INSERT OR UPDATE OF "status", "fulfillmentMethod" ON "orders"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION orders_check_delivery_closure();


-- ═══ Décision 4 : logos téléversés uniquement ════════════════════════════════
-- Un logo externe déjà enregistré est retiré (le logo typographique provisoire s'affiche) et audité.
DO $$
DECLARE
  previous JSONB;
BEGIN
  SELECT "value" INTO previous FROM "site_settings"
   WHERE "key" = 'company' AND jsonb_typeof("value" -> 'logoUrl') = 'string'
     AND ("value" ->> 'logoUrl') !~ '^/medias/identite/logo-[a-f0-9-]{36}\.(jpg|png|webp)$';
  IF FOUND THEN
    UPDATE "site_settings" SET "value" = jsonb_set("value", '{logoUrl}', 'null'::jsonb), "updatedAt" = now() WHERE "key" = 'company';
    INSERT INTO "audit_logs" ("id", "actorId", "action", "entityType", "entityId", "before", "after", "result", "createdAt")
    VALUES (gen_random_uuid()::text, NULL, 'settings.migrate', 'SiteSetting', 'company', previous,
            jsonb_set(previous, '{logoUrl}', 'null'::jsonb), 'SUCCESS', now());
  END IF;
END;
$$;

ALTER TABLE "site_settings"
  ADD CONSTRAINT "site_settings_logo_check" CHECK (
    "key" <> 'company'
    OR jsonb_typeof("value" -> 'logoUrl') IS DISTINCT FROM 'string'
    OR ("value" ->> 'logoUrl') ~ '^/medias/identite/logo-[a-f0-9-]{36}\.(jpg|png|webp)$');

ALTER TABLE "partners"
  ADD CONSTRAINT "partners_fields_check" CHECK (
    length(trim("name")) > 0 AND length("name") <= 120
    AND "logoUrl" ~ '^/medias/partenaires/partenaire-[a-f0-9-]{36}\.(jpg|png|webp)$'
    AND ("websiteUrl" IS NULL OR ("websiteUrl" ~ '^https://[^/\s]' AND length("websiteUrl") <= 500))
    AND "position" >= 0);
