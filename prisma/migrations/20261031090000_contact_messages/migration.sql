-- Formulaire de contact : messages reçus (boîte « Messages » de l'administration) et rattachement
-- des notifications (alerte au personnel, accusé de réception) au message.
-- Transaction explicite : Prisma n'en ouvre pas ; un échec en cours de route annule tout
-- (corriger la cause, `prisma migrate resolve --rolled-back`, puis relancer).
-- Aucune donnée existante n'est modifiée : création de types, d'une table, d'une colonne nullable et
-- d'un index sur « notifications » (écritures sur cette table suspendues le temps de sa construction).
BEGIN;

-- Table occupée par une longue transaction : échec net au bout de 5 s plutôt qu'une file d'attente
-- qui bloquerait toutes les requêtes derrière la migration. Relancer dans un moment plus calme.
SET LOCAL lock_timeout = '5s';

CREATE TYPE "ContactSubject" AS ENUM ('GENERAL', 'ORDER', 'QUOTE', 'AFTER_SALES', 'PARTNERSHIP', 'OTHER');
CREATE TYPE "ContactMessageStatus" AS ENUM ('NEW', 'IN_PROGRESS', 'CLOSED');

ALTER TABLE "notifications" ADD COLUMN "contactMessageId" TEXT;

CREATE TABLE "contact_messages" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "userId" TEXT,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "subject" "ContactSubject" NOT NULL,
    "reference" TEXT,
    "message" TEXT NOT NULL,
    "status" "ContactMessageStatus" NOT NULL DEFAULT 'NEW',
    "internalNotes" TEXT,
    "closedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "contact_messages_pkey" PRIMARY KEY ("id"),
    -- Un moyen de répondre est toujours fourni (e-mail ou téléphone).
    CONSTRAINT "contact_messages_reply_check" CHECK ("email" IS NOT NULL OR "phone" IS NOT NULL),
    -- Date de clôture présente si, et seulement si, le message est clos.
    CONSTRAINT "contact_messages_closed_check" CHECK (("status" = 'CLOSED') = ("closedAt" IS NOT NULL))
);

CREATE UNIQUE INDEX "contact_messages_number_key" ON "contact_messages"("number");
CREATE UNIQUE INDEX "contact_messages_idempotencyKey_key" ON "contact_messages"("idempotencyKey");
CREATE INDEX "contact_messages_status_createdAt_idx" ON "contact_messages"("status", "createdAt");
CREATE INDEX "contact_messages_email_createdAt_idx" ON "contact_messages"("email", "createdAt");
CREATE INDEX "notifications_contactMessageId_idx" ON "notifications"("contactMessageId");

ALTER TABLE "contact_messages" ADD CONSTRAINT "contact_messages_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

COMMIT;
