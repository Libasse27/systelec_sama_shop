-- En-tête société et taux de TVA FIGÉS sur les factures et les reçus à leur émission : un changement
-- ultérieur des paramètres (raison sociale, NINEA, RCCM, adresse, TVA) ne modifie plus un document émis.
-- Colonnes ajoutées sans toucher aux déclencheurs « ajout seul » ; les documents déjà émis gardent null
-- (en-tête et TVA relus dans les paramètres, comme avant).
ALTER TABLE "invoices" ADD COLUMN "company" JSONB, ADD COLUMN "vatRate" INTEGER;
ALTER TABLE "payments" ADD COLUMN "company" JSONB;

-- Tout NOUVEAU document porte son en-tête figé (un objet JSON, jamais le JSON « null »). NOT VALID : les
-- lignes existantes ne sont pas contrôlées (elles ne peuvent de toute façon plus être modifiées), chaque
-- insertion l'est. Ces contraintes restent NON VALIDÉES pour toujours : ne jamais tenter VALIDATE CONSTRAINT,
-- il échouerait sur les documents émis avant cette migration.
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_company_check"
  CHECK ("company" IS NOT NULL AND jsonb_typeof("company") = 'object') NOT VALID;
ALTER TABLE "payments" ADD CONSTRAINT "payments_company_check"
  CHECK ("company" IS NOT NULL AND jsonb_typeof("company") = 'object') NOT VALID;

-- Même borne que le paramètre « tax » (0 à 100 %, entier).
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_vat_rate_check" CHECK ("vatRate" IS NULL OR "vatRate" BETWEEN 0 AND 100);
