import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/server/db/client";
import { resetDatabase } from "../../../../tests/setup/db";

let counter = 0;
const row = (overrides: Partial<Prisma.ContactMessageUncheckedCreateInput> = {}): Prisma.ContactMessageUncheckedCreateInput => ({
  number: `MSG-2026-${String(++counter).padStart(6, "0")}`,
  idempotencyKey: randomUUID(),
  name: "Awa Diop",
  email: "awa@example.sn",
  phone: null,
  subject: "GENERAL",
  message: "Bonjour, une question.",
  ...overrides,
});

/**
 * Structure posée par la migration 20261031090000_contact_messages, vérifiée sur la base jetable des
 * tests d'intégration (toutes les migrations y sont rejouées sur un PostgreSQL vierge au démarrage).
 */
describe("table contact_messages : migration, contraintes et index (PostgreSQL)", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("la migration Contact est enregistrée comme appliquée, sans échec", async () => {
    const [migration] = await db.$queryRaw<{ finished: boolean; rolledBack: boolean }[]>`
      SELECT finished_at IS NOT NULL AS finished, rolled_back_at IS NOT NULL AS "rolledBack"
      FROM _prisma_migrations WHERE migration_name = '20261031090000_contact_messages'`;
    expect(migration).toEqual({ finished: true, rolledBack: false });
  });

  it("CHECK reply_check : un moyen de répondre (e-mail ou téléphone) est toujours présent", async () => {
    await expect(db.contactMessage.create({ data: row({ email: null, phone: null }) })).rejects.toThrow(/contact_messages_reply_check/);
    await expect(db.contactMessage.create({ data: row({ email: null, phone: "77 000 00 00" }) })).resolves.toMatchObject({ phone: "77 000 00 00" });
  });

  it("CHECK closed_check : date de clôture si, et seulement si, le message est traité", async () => {
    await expect(db.contactMessage.create({ data: row({ status: "CLOSED" }) })).rejects.toThrow(/contact_messages_closed_check/);
    await expect(db.contactMessage.create({ data: row({ status: "NEW", closedAt: new Date() }) })).rejects.toThrow(/contact_messages_closed_check/);
    const created = await db.contactMessage.create({ data: row({ status: "CLOSED", closedAt: new Date() }) });
    await expect(db.contactMessage.update({ where: { id: created.id }, data: { status: "IN_PROGRESS" } })).rejects.toThrow(/contact_messages_closed_check/);
  });

  it("numéro et clé d'idempotence uniques", async () => {
    const first = await db.contactMessage.create({ data: row() });
    await expect(db.contactMessage.create({ data: row({ number: first.number }) })).rejects.toThrow(/number/);
    await expect(db.contactMessage.create({ data: row({ idempotencyKey: first.idempotencyKey }) })).rejects.toThrow(/idempotencyKey/);
  });

  it("supprimer un compte conserve ses messages, détachés (ON DELETE SET NULL)", async () => {
    const userId = randomUUID();
    await db.user.create({ data: { id: userId, name: "Client", email: `${userId}@example.sn` } });
    const message = await db.contactMessage.create({ data: row({ userId }) });
    await db.user.delete({ where: { id: userId } });
    expect(await db.contactMessage.findUniqueOrThrow({ where: { id: message.id } })).toMatchObject({ userId: null });
  });

  it("énumérations, contraintes et index attendus sont présents", async () => {
    const enums = await db.$queryRaw<{ type: string; labels: string[] }[]>`
      SELECT t.typname AS type, array_agg(e.enumlabel::text ORDER BY e.enumsortorder) AS labels
      FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid
      WHERE t.typname IN ('ContactSubject', 'ContactMessageStatus') GROUP BY t.typname ORDER BY t.typname`;
    expect(enums).toEqual([
      { type: "ContactMessageStatus", labels: ["NEW", "IN_PROGRESS", "CLOSED"] },
      { type: "ContactSubject", labels: ["GENERAL", "ORDER", "QUOTE", "AFTER_SALES", "PARTNERSHIP", "OTHER"] },
    ]);

    const constraints = await db.$queryRaw<{ name: string }[]>`
      SELECT conname AS name FROM pg_constraint WHERE conrelid = 'contact_messages'::regclass ORDER BY conname`;
    expect(constraints.map(({ name }) => name)).toEqual([
      "contact_messages_closed_check",
      "contact_messages_pkey",
      "contact_messages_reply_check",
      "contact_messages_userId_fkey",
    ]);

    const indexes = await db.$queryRaw<{ name: string; definition: string }[]>`
      SELECT indexname AS name, indexdef AS definition FROM pg_indexes
      WHERE tablename IN ('contact_messages', 'notifications') AND indexname LIKE ANY (ARRAY['contact_messages_%', 'notifications_contactMessageId_idx'])
      ORDER BY indexname`;
    expect(indexes.map(({ name, definition }) => [name, definition.replace(/^.* USING btree /, "")])).toEqual([
      ["contact_messages_email_createdAt_idx", '(email, "createdAt")'],
      ["contact_messages_idempotencyKey_key", '("idempotencyKey")'],
      ["contact_messages_number_key", "(number)"],
      ["contact_messages_pkey", "(id)"],
      ["contact_messages_status_createdAt_idx", '(status, "createdAt")'],
      ["notifications_contactMessageId_idx", '("contactMessageId")'],
    ]);
    expect(indexes.filter(({ definition }) => definition.startsWith("CREATE UNIQUE")).map(({ name }) => name)).toEqual([
      "contact_messages_idempotencyKey_key",
      "contact_messages_number_key",
      "contact_messages_pkey",
    ]);
  });

  it("la colonne notifications.contactMessageId est facultative : les notifications existantes restent valides", async () => {
    const [column] = await db.$queryRaw<{ nullable: string; type: string }[]>`
      SELECT is_nullable AS nullable, data_type AS type FROM information_schema.columns
      WHERE table_name = 'notifications' AND column_name = 'contactMessageId'`;
    expect(column).toEqual({ nullable: "YES", type: "text" });
  });
});
