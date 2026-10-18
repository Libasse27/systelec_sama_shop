-- Phase 10, décision 4 : relances d'une vérification sans réponse et escalade.
-- Migration séparée : une valeur d'énumération ajoutée n'est utilisable qu'après validation de sa transaction.
ALTER TYPE "ReturnEventType" ADD VALUE IF NOT EXISTS 'VERIFICATION_REMINDED';
ALTER TYPE "ReturnEventType" ADD VALUE IF NOT EXISTS 'VERIFICATION_ESCALATED';
