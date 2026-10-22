-- Renvoi automatique des e-mails en échec (tâche planifiée, pnpm orders:expire).
-- attempts : envois tentés ; nextAttemptAt : prochain essai d'une notification FAILED (NULL = abandon définitif).
-- Transaction explicite : Prisma n'en ouvre pas ; sans elle, un échec en cours de route (index, coupure)
-- laisserait colonnes et contraintes appliquées et la migration marquée en échec (P3018). Avec elle,
-- tout est annulé : corriger la cause, `prisma migrate resolve --rolled-back`, puis relancer.
-- Vérifié par src/server/db/notification-retries.migration.test.ts (test:migration, PostgreSQL jetable).
BEGIN;

ALTER TABLE "notifications"
  ADD COLUMN "attempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "nextAttemptAt" TIMESTAMPTZ(3),
  ADD CONSTRAINT "notifications_attempts_check" CHECK ("attempts" >= 0),
  -- Un prochain essai n'a de sens que pour une notification en échec.
  ADD CONSTRAINT "notifications_retry_check" CHECK ("nextAttemptAt" IS NULL OR "status" = 'FAILED');

-- Échecs antérieurs : un essai compté, aucun renvoi (un ancien message n'est pas expédié après coup).
UPDATE "notifications" SET "attempts" = 1 WHERE "status" = 'FAILED';
-- Envois réussis antérieurs : un essai compté.
UPDATE "notifications" SET "attempts" = 1 WHERE "status" = 'SENT';

CREATE INDEX "notifications_status_nextAttemptAt_idx" ON "notifications"("status", "nextAttemptAt");

COMMIT;
