import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Actor } from "@/server/authz/service";
import { syncRolesAndPermissions } from "@/server/authz/sync";
import { db } from "@/server/db/client";
import { logger } from "@/server/logger";
import { settingsDefaults } from "@/server/modules/settings/schemas";
import { resetDatabase } from "../../../../tests/setup/db";
import { actorWith } from "../../../../tests/support/actors";
import { changeContactMessageStatus, CONTACT_LIMITS, saveContactMessageNotes, submitContactMessage } from "./messages";
import { getContactMessage, listContactMessages } from "./queries";

const messageInput = (overrides: Record<string, unknown> = {}) => ({
  idempotencyKey: randomUUID(),
  name: "Awa Diop",
  email: "awa@example.sn",
  phone: "77 000 00 00",
  subject: "ORDER",
  reference: "CMD-2026-000001",
  message: "Bonjour, où en est la livraison de ma commande ?",
  ...overrides,
});

/** Données saisies par le visiteur : elles ne doivent jamais apparaître dans le journal technique. */
const VISITOR_DATA = ["Awa", "awa@example.sn", "77 000 00 00", "CMD-2026-000001", "livraison", "10.0.0.7", "10.0.0.9"];

let agent: Actor;

describe("messages du formulaire de contact (PostgreSQL)", () => {
  beforeEach(async () => {
    await resetDatabase();
    await syncRolesAndPermissions(db);
    agent = await actorWith("CUSTOMER_SERVICE");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("un invité envoie un message : numéro, statut, accusé de réception et audit", async () => {
    const sent = await submitContactMessage(db, { userId: null, ip: "10.0.0.1" }, messageInput());
    expect(sent.number).toMatch(/^MSG-\d{4}-000001$/);
    expect(await db.contactMessage.findUniqueOrThrow({ where: { id: sent.id } })).toMatchObject({ status: "NEW", userId: null, subject: "ORDER", closedAt: null });
    expect(await db.notification.count({ where: { contactMessageId: sent.id, template: "contact.received", recipient: "awa@example.sn" } })).toBe(1);
    expect(await db.auditLog.count({ where: { action: "contact_message.create", entityId: sent.id, ip: "10.0.0.1" } })).toBe(1);
  });

  it("cohérence message / audit / notifications : alerte au personnel et accusé, sans aucune donnée du visiteur", async () => {
    await db.siteSetting.create({ data: { key: "company", value: { ...settingsDefaults.company, email: "staff@example.sn" } } });
    const sent = await submitContactMessage(db, { userId: null, ip: "10.0.0.2" }, messageInput());
    const notifications = await db.notification.findMany({ where: { contactMessageId: sent.id }, orderBy: { template: "asc" } });
    expect(notifications.map(({ template, channel, recipient }) => ({ template, channel, recipient }))).toEqual([
      { template: "contact.new_staff", channel: "EMAIL", recipient: "staff@example.sn" },
      { template: "contact.received", channel: "EMAIL", recipient: "awa@example.sn" },
    ]);
    // Charge utile : numéro et libellé du sujet seulement (ni nom, ni message, ni coordonnées).
    for (const { payload } of notifications) expect(payload).toEqual({ number: sent.number, subject: "Commande ou livraison" });
    const audit = await db.auditLog.findFirstOrThrow({ where: { action: "contact_message.create", entityId: sent.id } });
    expect(audit.after).toEqual({ number: sent.number, subject: "ORDER" });
  });

  it("sans e-mail, aucun accusé de réception n'est préparé", async () => {
    const sent = await submitContactMessage(db, { userId: null }, messageInput({ email: "" }));
    expect(await db.notification.count({ where: { contactMessageId: sent.id, template: "contact.received" } })).toBe(0);
  });

  it("échec en cours de transaction : ni message, ni numéro, ni audit, ni notification ; trace « internal »", async () => {
    const error = vi.spyOn(logger, "error").mockImplementation(() => {});
    // Paramètre société corrompu : lu APRÈS la création du message et de l'accusé, dans la même transaction.
    await db.siteSetting.create({ data: { key: "company", value: { corrompu: true } } });
    await expect(submitContactMessage(db, { userId: null, ip: "10.0.0.3" }, messageInput())).rejects.toMatchObject({ code: "INTERNAL" });
    expect(await db.contactMessage.count()).toBe(0);
    expect(await db.notification.count()).toBe(0);
    expect(await db.auditLog.count({ where: { action: "contact_message.create" } })).toBe(0);
    expect(await db.sequence.count({ where: { key: "contact_message" } })).toBe(0);
    expect(error).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ event: "contact_message.rejected", reason: "internal", network: "10.0.0.0/24" }));

    // Une fois la cause corrigée, le premier message reçoit le premier numéro : rien n'a été consommé.
    await db.siteSetting.delete({ where: { key: "company" } });
    expect((await submitContactMessage(db, { userId: null, ip: "10.0.0.3" }, messageInput())).number).toMatch(/-000001$/);
  });

  it("idempotence : une double soumission, même simultanée, ne crée qu'un message", async () => {
    const info = vi.spyOn(logger, "info").mockImplementation(() => {});
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => {});
    const input = messageInput();
    const results = await Promise.all([submitContactMessage(db, { userId: null }, input), submitContactMessage(db, { userId: null }, input)]);
    expect(new Set(results.map((result) => result.number)).size).toBe(1);
    expect(await db.contactMessage.count()).toBe(1);
    expect(info).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ event: "contact_message.replayed" }));

    const customerId = randomUUID();
    await db.user.create({ data: { id: customerId, name: "Client", email: `${customerId}@example.sn` } });
    // La même clé rejouée depuis un compte est refusée.
    await expect(submitContactMessage(db, { userId: customerId }, input)).rejects.toMatchObject({ code: "CONFLICT" });
    expect(warn).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ reason: "replay_conflict", account: true }));
  });

  it("refuse un robot (champ piège) et limite les envois depuis une même connexion", async () => {
    vi.spyOn(logger, "warn").mockImplementation(() => {});
    await expect(submitContactMessage(db, { userId: null }, messageInput({ website: "spam" }))).rejects.toMatchObject({ code: "VALIDATION" });
    for (let i = 0; i < CONTACT_LIMITS.perIp; i++) await submitContactMessage(db, { userId: null, ip: "10.0.0.7" }, messageInput());
    await expect(submitContactMessage(db, { userId: null, ip: "10.0.0.7" }, messageInput())).rejects.toMatchObject({ code: "RATE_LIMITED" });
    await expect(submitContactMessage(db, { userId: null, ip: "10.0.0.8" }, messageInput())).resolves.toMatchObject({ number: expect.any(String) });
  });

  it("aucun plafond commun : un afflux depuis d'autres connexions ne ferme pas le formulaire aux autres visiteurs", async () => {
    const flood = 10 * CONTACT_LIMITS.perIp * 2;
    await db.auditLog.createMany({ data: Array.from({ length: flood }, (_, i) => ({ action: "contact_message.create", ip: `10.2.${i}.1` })) });
    await expect(submitContactMessage(db, { userId: null, ip: "10.3.0.1" }, messageInput())).resolves.toMatchObject({ number: expect.any(String) });
    await expect(submitContactMessage(db, { userId: null }, messageInput())).resolves.toMatchObject({ number: expect.any(String) });
    expect(await db.contactMessage.count()).toBe(2);
  });

  it("trace chaque refus (motif, champs, réseau) sans aucune donnée saisie ni adresse IP complète", async () => {
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => {});
    await expect(submitContactMessage(db, { userId: null, ip: "10.0.0.9" }, messageInput({ name: "Awa\nhttps://faux.example", website: "x" }))).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(submitContactMessage(db, { userId: null, ip: "10.0.0.9" }, messageInput({ email: "", phone: "" }))).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(submitContactMessage(db, { userId: null, ip: "10.0.0.9" }, messageInput({ name: "Awa\nVotre compte" }))).rejects.toMatchObject({ code: "VALIDATION" });
    for (let i = 0; i < CONTACT_LIMITS.perIp; i++) await submitContactMessage(db, { userId: null, ip: "10.0.0.7" }, messageInput());
    await expect(submitContactMessage(db, { userId: null, ip: "10.0.0.7" }, messageInput())).rejects.toMatchObject({ code: "RATE_LIMITED" });

    // Le journal reçoit aussi d'autres avertissements (envoi d'e-mail sans SMTP) : seuls les refus comptent ici.
    const rejections = warn.mock.calls.map(([, context]) => context).filter((context) => context?.event === "contact_message.rejected");
    expect(rejections).toEqual([
      { event: "contact_message.rejected", reason: "honeypot", network: "10.0.0.0/24", account: false },
      { event: "contact_message.rejected", reason: "validation", network: "10.0.0.0/24", account: false, fields: ["email"] },
      { event: "contact_message.rejected", reason: "validation", network: "10.0.0.0/24", account: false, fields: ["name"] },
      { event: "contact_message.rejected", reason: "rate_limited_ip", network: "10.0.0.0/24", account: false },
    ]);
    const logged = JSON.stringify(warn.mock.calls);
    for (const value of [...VISITOR_DATA, "faux.example", "Votre compte"]) expect(logged).not.toContain(value);
    // Aucune ligne en base pour les refus : seuls les envois acceptés sont audités.
    expect(await db.auditLog.count({ where: { action: "contact_message.create" } })).toBe(CONTACT_LIMITS.perIp);
  });

  it("plafonne les accusés de réception par adresse e-mail", async () => {
    const total = CONTACT_LIMITS.acknowledgementsPerEmailPerDay + 2;
    for (let i = 0; i < total; i++) await submitContactMessage(db, { userId: null, ip: `10.1.0.${i}` }, messageInput());
    expect(await db.notification.count({ where: { template: "contact.received" } })).toBe(CONTACT_LIMITS.acknowledgementsPerEmailPerDay);
    expect(await db.contactMessage.count()).toBe(total);
  });

  it("le service client prend en charge, annote, clôt et rouvre un message ; chaque étape est auditée", async () => {
    const { id } = await submitContactMessage(db, { userId: null }, messageInput());
    await changeContactMessageStatus(db, agent, id, { status: "IN_PROGRESS" });
    await expect(changeContactMessageStatus(db, agent, id, { status: "IN_PROGRESS" })).rejects.toMatchObject({ code: "CONFLICT" });
    await saveContactMessageNotes(db, agent, id, { internalNotes: "Rappelée, livraison demain." });
    await changeContactMessageStatus(db, agent, id, { status: "CLOSED" });
    expect(await getContactMessage(db, agent, id)).toMatchObject({ status: "CLOSED", internalNotes: "Rappelée, livraison demain.", closedAt: expect.any(Date) });
    await changeContactMessageStatus(db, agent, id, { status: "IN_PROGRESS" });
    expect(await db.contactMessage.findUniqueOrThrow({ where: { id } })).toMatchObject({ status: "IN_PROGRESS", closedAt: null });
    expect(await db.auditLog.count({ where: { entityId: id, action: { in: ["contact_message.status", "contact_message.notes"] } } })).toBe(4);
    await expect(changeContactMessageStatus(db, agent, "inconnu", { status: "CLOSED" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(saveContactMessageNotes(db, agent, "inconnu", { internalNotes: "x" })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("sans la permission messages.manage, ni lecture ni traitement", async () => {
    const { id } = await submitContactMessage(db, { userId: null }, messageInput());
    const technician = await actorWith("TECHNICIAN");
    await expect(listContactMessages(db, technician)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(getContactMessage(db, technician, id)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(changeContactMessageStatus(db, technician, id, { status: "CLOSED" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(saveContactMessageNotes(db, technician, id, { internalNotes: "x" })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("liste les nouveaux d'abord, filtre par statut et recherche par nom, téléphone ou référence", async () => {
    const first = await submitContactMessage(db, { userId: null }, messageInput({ name: "Moussa Fall", reference: "" }));
    await submitContactMessage(db, { userId: null }, messageInput());
    await changeContactMessageStatus(db, agent, first.id, { status: "CLOSED" });
    const all = await listContactMessages(db, agent);
    expect(all.rows.map((row) => row.status)).toEqual(["NEW", "CLOSED"]);
    expect((await listContactMessages(db, agent, { status: "CLOSED" })).rows).toMatchObject([{ id: first.id }]);
    expect((await listContactMessages(db, agent, { q: "moussa" })).total).toBe(1);
    expect((await listContactMessages(db, agent, { q: "CMD-2026" })).total).toBe(1);
  });
});
