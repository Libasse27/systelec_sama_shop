-- Revue de la phase 9 : un retour ne passe jamais à « traité » avec un remboursement
-- décidé sans l'écriture de remboursement correspondante, quel que soit son statut précédent.
CREATE OR REPLACE FUNCTION returns_check_update() RETURNS trigger AS $$
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
  IF NEW."status" = 'COMPLETED' AND NEW."refundAmount" > 0
     AND NOT EXISTS (SELECT 1 FROM "payments" WHERE "returnId" = NEW."id") THEN
    RAISE EXCEPTION 'retour : remboursement non enregistré' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = pg_catalog, public;
