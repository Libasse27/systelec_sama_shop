-- Une demande ne donne qu'une intervention active (deux acceptations ou une intervention
-- directe en parallèle d'un devis ne peuvent pas créer deux prestations facturables).
CREATE UNIQUE INDEX "interventions_one_active_per_request"
  ON "interventions" ("quoteRequestId")
  WHERE "quoteRequestId" IS NOT NULL AND "status" <> 'CANCELLED';

-- Un devis envoyé est figé : ni ses lignes, ni ses montants, ni sa validité ne changent.
CREATE FUNCTION quote_items_frozen() RETURNS trigger AS $$
DECLARE
  quote_status TEXT;
BEGIN
  SELECT "status" INTO quote_status FROM "quotes" WHERE "id" = coalesce(NEW."quoteId", OLD."quoteId");
  IF quote_status IS DISTINCT FROM 'DRAFT' THEN
    RAISE EXCEPTION 'devis envoyé : ses lignes ne se modifient plus' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN coalesce(NEW, OLD);
END;
$$ LANGUAGE plpgsql SET search_path = pg_catalog, public;

CREATE TRIGGER quote_items_frozen_after_send
  BEFORE INSERT OR UPDATE OR DELETE ON "quote_items"
  FOR EACH ROW EXECUTE FUNCTION quote_items_frozen();

CREATE FUNCTION quotes_frozen() RETURNS trigger AS $$
BEGIN
  IF OLD."status" <> 'DRAFT' AND (
    NEW."subtotal" <> OLD."subtotal" OR NEW."total" <> OLD."total" OR NEW."validUntil" <> OLD."validUntil"
    OR NEW."notes" IS DISTINCT FROM OLD."notes" OR NEW."customerId" <> OLD."customerId") THEN
    RAISE EXCEPTION 'devis envoyé : son contenu ne se modifie plus' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = pg_catalog, public;

CREATE TRIGGER quotes_frozen_after_send
  BEFORE UPDATE ON "quotes"
  FOR EACH ROW EXECUTE FUNCTION quotes_frozen();
