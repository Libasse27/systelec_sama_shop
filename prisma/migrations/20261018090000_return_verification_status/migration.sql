-- Décision 2 (politique de retours) : étape « vérification demandée ».
-- Migration séparée : une valeur d'énumération ajoutée n'est utilisable qu'après validation de sa transaction.
ALTER TYPE "ReturnStatus" ADD VALUE IF NOT EXISTS 'VERIFICATION' AFTER 'RECEIVED';
