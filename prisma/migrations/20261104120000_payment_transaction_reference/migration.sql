-- Référence de la transaction pour les paiements mobiles enregistrés à la main : sans elle, rien ne permet de
-- rapprocher la somme déclarée d'un transfert réel. Colonne ajoutée sans toucher au déclencheur « ajout seul ».
ALTER TABLE "payments" ADD COLUMN "transactionReference" TEXT;

-- Espèces : jamais de référence ; tout autre moyen : référence obligatoire.
ALTER TABLE "payments"
  ADD CONSTRAINT "payments_transaction_reference_check" CHECK (
    ("method" = 'CASH' AND "transactionReference" IS NULL)
    OR ("method" <> 'CASH' AND "transactionReference" IS NOT NULL)
  );

-- Recherche d'une référence déjà encaissée (contrôle de doublon).
CREATE INDEX "payments_method_transactionReference_idx" ON "payments"("method", "transactionReference");
