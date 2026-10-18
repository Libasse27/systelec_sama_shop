-- Intégrité de caisse garantie par la base, pas seulement par le code :
-- à la validation de chaque transaction, le montant encaissé d'une commande est
-- exactement la somme de ses écritures (encaissements et contre-écritures).
CREATE FUNCTION orders_check_amount_paid() RETURNS trigger AS $$
DECLARE
  target TEXT;
  paid INTEGER;
  recorded INTEGER;
BEGIN
  -- Champs lus séparément : NEW n'a pas les mêmes colonnes selon la table.
  IF TG_TABLE_NAME = 'payments' THEN
    target := NEW."orderId";
  ELSE
    target := NEW."id";
  END IF;
  SELECT "amountPaid" INTO paid FROM "orders" WHERE "id" = target;
  SELECT coalesce(sum("amount"), 0) INTO recorded FROM "payments" WHERE "orderId" = target;
  IF paid IS DISTINCT FROM recorded THEN
    RAISE EXCEPTION 'commande % : montant encaissé (%) différent de la somme des encaissements (%)', target, paid, recorded
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql SET search_path = pg_catalog, public;

CREATE CONSTRAINT TRIGGER payments_amount_paid_consistency
  AFTER INSERT ON "payments"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION orders_check_amount_paid();

CREATE CONSTRAINT TRIGGER orders_amount_paid_consistency
  AFTER UPDATE OF "amountPaid" ON "orders"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION orders_check_amount_paid();

-- Fonctions des encaissements : chemin de recherche figé.
ALTER FUNCTION payments_check_reversal() SET search_path = pg_catalog, public;
ALTER FUNCTION payments_forbid_mutation() SET search_path = pg_catalog, public;
