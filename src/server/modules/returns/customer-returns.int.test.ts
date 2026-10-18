import { randomUUID } from "node:crypto";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Actor } from "@/server/authz/service";
import { syncRolesAndPermissions } from "@/server/authz/sync";
import { db } from "@/server/db/client";
import { orderAccessToken } from "@/server/modules/orders/access-token";
import { createLocalStorage, type FileStorage } from "@/server/storage/storage";
import { resetDatabase } from "../../../../tests/setup/db";
import { actorWith } from "../../../../tests/support/actors";
import { closedPickupOrder, confirmedOrder, contact, seedOrderCatalog, type OrderFixtures, type PlacedOrder } from "../../../../tests/support/orders";
import { answerCustomerVerification, CUSTOMER_RETURN_LIMITS, declareCustomerReturn, getCustomerReturns, type CustomerContext } from "./customer";
import { decideReturn, requestReturnVerification } from "./service";

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 9, 9, 9]);
const SVG = new TextEncoder().encode("<svg onload=alert(1)></svg>");

let fixtures: OrderFixtures;
let manager: Actor;
let decider: Actor;
let cashier: Actor;
let dir: string;
let storage: FileStorage;

async function customerAccount(): Promise<string> {
  const id = randomUUID();
  await db.user.create({ data: { id, name: "Awa Diop", email: `${id}@client.sn`, kind: "CUSTOMER" } });
  return id;
}

const asAccount = (userId: string, ip = "198.51.100.7"): CustomerContext => ({ access: { userId }, ip });
const asGuest = (order: PlacedOrder, ip = "198.51.100.8"): CustomerContext => ({ access: { userId: null, token: orderAccessToken(order.id) }, ip });

async function lineOf(order: PlacedOrder) {
  return (await db.orderItem.findFirstOrThrow({ where: { orderId: order.id, sku: "RT-01" }, select: { id: true } })).id;
}

async function declaration(order: PlacedOrder, overrides: Record<string, unknown> = {}) {
  return { idempotencyKey: randomUUID(), category: "DEFECTIVE", description: "L'écran reste noir à l'allumage", items: [{ orderItemId: await lineOf(order), quantity: 1 }], ...overrides };
}

const storedFiles = async (): Promise<string[]> => {
  try {
    return (await readdir(path.join(dir, "retours"), { recursive: true })).filter((name) => name.includes("photo-"));
  } catch {
    return [];
  }
};

describe("décision 2 : retour déclaré par le client (PostgreSQL)", () => {
  beforeEach(async () => {
    await resetDatabase();
    await syncRolesAndPermissions(db);
    fixtures = await seedOrderCatalog();
    manager = await actorWith("ORDER_MANAGER");
    decider = await actorWith("ORDER_MANAGER");
    cashier = await actorWith("FINANCE_MANAGER");
    dir = await mkdtemp(path.join(tmpdir(), "sama-retours-"));
    storage = createLocalStorage(dir);
  });
  afterEach(() => rm(dir, { recursive: true, force: true }));

  it("depuis son compte : retour « à vérifier », photos privées, accusé de réception, aucun remboursement", async () => {
    const userId = await customerAccount();
    const order = await closedPickupOrder(fixtures, manager, cashier, undefined, userId);
    const created = await declareCustomerReturn(db, storage, asAccount(userId), order.number, await declaration(order), [PNG, JPEG]);

    const row = await db.return.findUniqueOrThrow({ where: { id: created.id }, include: { attachments: true } });
    expect(row).toMatchObject({ status: "RECEIVED", declaredBy: "CUSTOMER", createdById: null, refundAmount: 0, lateDeclaration: false });
    expect(row.reason).toBe("Produit défectueux ou en panne : L'écran reste noir à l'allumage");
    expect(row.attachments.map((photo) => photo.storageKey).every((key) => key.startsWith(`retours/${created.id}/photo-`))).toBe(true);
    expect(row.attachments.map((photo) => photo.contentType).sort()).toEqual(["image/jpeg", "image/png"]);
    expect(await storedFiles()).toHaveLength(2);

    const event = await db.returnEvent.findFirstOrThrow({ where: { returnId: created.id } });
    expect(event).toMatchObject({ type: "DECLARED", actorId: userId, details: { by: "customer", photos: 2, lateDeclaration: false } });
    expect(await db.auditLog.count({ where: { action: "return.customer_declare", entityId: created.id, ip: "198.51.100.7" } })).toBe(1);
    expect((await db.notification.findMany({ where: { returnId: created.id } })).map((n) => [n.template, n.recipient])).toEqual([["return.declared_customer", contact.email]]);
    // Jamais de remboursement automatique.
    expect(await db.payment.count({ where: { returnId: created.id } })).toBe(0);
    expect((await db.order.findUniqueOrThrow({ where: { id: order.id } })).paymentStatus).toBe("TO_VERIFY");
  });

  it("depuis le lien de suivi d'une commande invitée (jeton signé)", async () => {
    const order = await closedPickupOrder(fixtures, manager, cashier);
    const created = await declareCustomerReturn(db, storage, asGuest(order), order.number, await declaration(order), []);
    expect(await db.return.findUniqueOrThrow({ where: { id: created.id } })).toMatchObject({ declaredBy: "CUSTOMER", createdById: null });
    expect((await db.returnEvent.findFirstOrThrow({ where: { returnId: created.id } })).actorId).toBeNull();
  });

  describe("accès limité à ses propres commandes", () => {
    it("autre compte, jeton faux ou d'une autre commande, commande d'un compte par un lien : introuvable, rien n'est enregistré", async () => {
      const owner = await customerAccount();
      const intruder = await customerAccount();
      const accountOrder = await closedPickupOrder(fixtures, manager, cashier, undefined, owner);
      const guestOrder = await closedPickupOrder(fixtures, manager, cashier);
      const otherGuest = await closedPickupOrder(fixtures, manager, cashier);

      await expect(declareCustomerReturn(db, storage, asAccount(intruder), accountOrder.number, await declaration(accountOrder), [])).rejects.toMatchObject({ code: "NOT_FOUND" });
      await expect(declareCustomerReturn(db, storage, { access: { userId: null, token: "faux" } }, guestOrder.number, await declaration(guestOrder), [])).rejects.toMatchObject({ code: "NOT_FOUND" });
      await expect(declareCustomerReturn(db, storage, asGuest(otherGuest), guestOrder.number, await declaration(guestOrder), [])).rejects.toMatchObject({ code: "NOT_FOUND" });
      await expect(declareCustomerReturn(db, storage, { access: { userId: null, token: orderAccessToken(accountOrder.id) } }, accountOrder.number, await declaration(accountOrder), [])).rejects.toMatchObject({ code: "NOT_FOUND" });
      expect(await getCustomerReturns(db, { userId: intruder }, accountOrder.number)).toBeNull();
      expect(await getCustomerReturns(db, { userId: null, token: "faux" }, guestOrder.number)).toBeNull();
      expect(await db.return.count()).toBe(0);
    });

    it("article d'une autre commande refusé ; commande pas encore remise refusée", async () => {
      const order = await closedPickupOrder(fixtures, manager, cashier);
      const other = await closedPickupOrder(fixtures, manager, cashier);
      await expect(declareCustomerReturn(db, storage, asGuest(order), order.number, await declaration(order, { items: [{ orderItemId: await lineOf(other), quantity: 1 }] }), [])).rejects.toMatchObject({
        code: "VALIDATION",
      });
      const pending = await confirmedOrder(fixtures, manager);
      await expect(declareCustomerReturn(db, storage, asGuest(pending), pending.number, await declaration(pending), [])).rejects.toMatchObject({ code: "CONFLICT" });
      expect(await db.return.count()).toBe(0);
    });
  });

  describe("photos contrôlées", () => {
    it("format réel vérifié, taille et nombre limités : refus avant tout stockage", async () => {
      const order = await closedPickupOrder(fixtures, manager, cashier);
      const declare = async (files: Uint8Array[]) => declareCustomerReturn(db, storage, asGuest(order), order.number, await declaration(order), files);
      await expect(declare([SVG])).rejects.toMatchObject({ code: "VALIDATION", details: { fieldErrors: { photos: expect.any(Array) } } });
      await expect(declare([PNG, PNG, PNG, PNG])).rejects.toMatchObject({ code: "VALIDATION" });
      const heavy = new Uint8Array(2 * 1024 * 1024 + 1);
      heavy.set(PNG);
      await expect(declare([heavy])).rejects.toMatchObject({ code: "VALIDATION" });
      expect(await storedFiles()).toEqual([]);
      expect(await db.return.count()).toBe(0);
    });

    it("enregistrement refusé en base : les photos déjà stockées sont retirées", async () => {
      const order = await closedPickupOrder(fixtures, manager, cashier);
      // Quantité supérieure à la quantité livrée : refus sous verrou, après le stockage.
      const input = await declaration(order, { items: [{ orderItemId: await lineOf(order), quantity: 99 }] });
      await expect(declareCustomerReturn(db, storage, asGuest(order), order.number, input, [PNG])).rejects.toMatchObject({ code: "CONFLICT" });
      expect(await storedFiles()).toEqual([]);
    });

    it("en base : fichier privé de forme stricte, ajout seul", async () => {
      const order = await closedPickupOrder(fixtures, manager, cashier);
      const created = await declareCustomerReturn(db, storage, asGuest(order), order.number, await declaration(order), [PNG]);
      const photo = await db.returnAttachment.findFirstOrThrow({ where: { returnId: created.id } });
      await expect(db.returnAttachment.update({ where: { id: photo.id }, data: { byteSize: 1 } })).rejects.toThrow(/ajout seul/);
      await expect(db.returnAttachment.delete({ where: { id: photo.id } })).rejects.toThrow(/ajout seul/);
      await expect(
        db.returnAttachment.create({ data: { returnId: created.id, storageKey: "produits/x/photo.png", contentType: "image/png", byteSize: 10 } }),
      ).rejects.toThrow(/return_attachments_file_check/);
    });
  });

  it("double envoi : un seul retour ; limites par commande et par connexion", async () => {
    const order = await closedPickupOrder(fixtures, manager, cashier, { "RT-01": 5 });
    const input = await declaration(order);
    const first = await declareCustomerReturn(db, storage, asGuest(order), order.number, input, [PNG]);
    const again = await declareCustomerReturn(db, storage, asGuest(order), order.number, input, [PNG]);
    expect(again).toMatchObject({ id: first.id, replayed: true });
    expect(await db.return.count()).toBe(1);

    await declareCustomerReturn(db, storage, asGuest(order), order.number, await declaration(order), []);
    await expect(declareCustomerReturn(db, storage, asGuest(order), order.number, await declaration(order), [])).rejects.toMatchObject({ code: "RATE_LIMITED" });
    expect(await db.return.count()).toBe(CUSTOMER_RETURN_LIMITS.openPerOrder);

    const ip = "203.0.113.50";
    await db.auditLog.createMany({
      data: Array.from({ length: CUSTOMER_RETURN_LIMITS.perIpPerHour }, () => ({ action: "return.customer_declare", entityType: "Return", entityId: randomUUID(), ip, result: "SUCCESS" as const })),
    });
    const other = await closedPickupOrder(fixtures, manager, cashier);
    await expect(declareCustomerReturn(db, storage, asGuest(other, ip), other.number, await declaration(other), [])).rejects.toMatchObject({ code: "RATE_LIMITED" });
  });

  describe("quotas sous envois simultanés (atomiques)", () => {
    const fulfilled = (results: PromiseSettledResult<unknown>[]) => results.filter((result) => result.status === "fulfilled").length;
    const rateLimited = (results: PromiseSettledResult<unknown>[]) =>
      results.filter((result) => result.status === "rejected" && (result.reason as { code?: string }).code === "RATE_LIMITED").length;
    /** Commandes préparées l'une après l'autre (seuls les envois testés sont simultanés). */
    const closedOrders = async (count: number, userId?: string) => {
      const orders: PlacedOrder[] = [];
      for (let index = 0; index < count; index += 1) orders.push(await closedPickupOrder(fixtures, manager, cashier, undefined, userId));
      return orders;
    };
    const fillAudit = (count: number, ip: string | null) =>
      db.auditLog.createMany({ data: Array.from({ length: count }, () => ({ action: "return.customer_declare", entityType: "Return", entityId: randomUUID(), ip, result: "SUCCESS" as const })) });

    it("même commande : 6 demandes simultanées, exactement 2 acceptées, aucune photo orpheline", async () => {
      const order = await closedPickupOrder(fixtures, manager, cashier, { "RT-01": 6 });
      const inputs = await Promise.all(Array.from({ length: 6 }, () => declaration(order)));
      const results = await Promise.allSettled(inputs.map((input, index) => declareCustomerReturn(db, storage, asGuest(order, `198.51.100.${10 + index}`), order.number, input, [PNG])));
      expect(fulfilled(results)).toBe(CUSTOMER_RETURN_LIMITS.openPerOrder);
      expect(rateLimited(results)).toBe(6 - CUSTOMER_RETURN_LIMITS.openPerOrder);
      expect(await db.return.count({ where: { orderId: order.id } })).toBe(CUSTOMER_RETURN_LIMITS.openPerOrder);
      expect(await storedFiles()).toHaveLength(CUSTOMER_RETURN_LIMITS.openPerOrder);
    });

    it("même connexion, plusieurs commandes du même client : la limite horaire n'est jamais dépassée", async () => {
      const ip = "203.0.113.77";
      const userId = await customerAccount();
      const orders = await closedOrders(5, userId);
      await fillAudit(CUSTOMER_RETURN_LIMITS.perIpPerHour - 2, ip);
      const inputs = await Promise.all(orders.map((order) => declaration(order)));
      const results = await Promise.allSettled(orders.map((order, index) => declareCustomerReturn(db, storage, asAccount(userId, ip), order.number, inputs[index], [])));
      expect(fulfilled(results)).toBe(2);
      expect(rateLimited(results)).toBe(3);
      expect(await db.auditLog.count({ where: { action: { in: ["return.customer_declare", "return.customer_answer"] }, ip } })).toBe(CUSTOMER_RETURN_LIMITS.perIpPerHour);
    });

    it("sans adresse IP fiable : l'enveloppe commune tient aussi sous envois simultanés", async () => {
      const orders = await closedOrders(3);
      await fillAudit(CUSTOMER_RETURN_LIMITS.unknownIpPerHour - 1, null);
      const inputs = await Promise.all(orders.map((order) => declaration(order)));
      const results = await Promise.allSettled(
        orders.map((order, index) => declareCustomerReturn(db, storage, { access: { userId: null, token: orderAccessToken(order.id) } }, order.number, inputs[index], [])),
      );
      expect(fulfilled(results)).toBe(1);
    });

    it("pas de blocage excessif : des connexions et commandes différentes passent toutes", async () => {
      const orders = await closedOrders(4);
      const inputs = await Promise.all(orders.map((order) => declaration(order)));
      const results = await Promise.allSettled(orders.map((order, index) => declareCustomerReturn(db, storage, asGuest(order, `192.0.2.${index + 1}`), order.number, inputs[index], [])));
      expect(fulfilled(results)).toBe(4);
    });
  });

  it("hors délai (48 h après la remise) : enregistré et signalé, jamais refusé", async () => {
    const order = await closedPickupOrder(fixtures, manager, cashier);
    await db.order.update({ where: { id: order.id }, data: { closedAt: new Date(Date.now() - 49 * 3_600_000) } });
    const created = await declareCustomerReturn(db, storage, asGuest(order), order.number, await declaration(order), []);
    expect(created.lateDeclaration).toBe(true);
    const ack = await db.notification.findFirstOrThrow({ where: { returnId: created.id, template: "return.declared_customer" } });
    expect(ack.payload).toMatchObject({ lateDeclaration: true });
  });

  describe("suivi par le client et réponse à une vérification", () => {
    it("le client voit le statut, l'information attendue, y répond avec une photo ; la décision ne révèle que le motif d'un refus", async () => {
      const userId = await customerAccount();
      const order = await closedPickupOrder(fixtures, manager, cashier, { "RT-01": 3 }, userId);
      const created = await declareCustomerReturn(db, storage, asAccount(userId), order.number, await declaration(order), []);

      await requestReturnVerification(db, decider, created.id, { kind: "PHOTOS", request: "Photo de l'étiquette du numéro de série" });
      let view = await getCustomerReturns(db, { userId }, order.number);
      expect(view?.returns[0]).toMatchObject({ status: "VERIFICATION", pendingRequest: { kind: "PHOTOS", request: "Photo de l'étiquette du numéro de série" } });

      await answerCustomerVerification(db, storage, asAccount(userId), order.number, created.number, { response: "Voici la photo de l'étiquette" }, [JPEG]);
      expect((await db.return.findUniqueOrThrow({ where: { id: created.id } })).status).toBe("RECEIVED");
      const answer = await db.returnEvent.findFirstOrThrow({ where: { returnId: created.id, type: "VERIFICATION_ANSWERED" } });
      expect(answer).toMatchObject({ actorId: userId, comment: "Voici la photo de l'étiquette", details: { by: "customer", photos: 1 } });
      await expect(answerCustomerVerification(db, storage, asAccount(userId), order.number, created.number, { response: "Encore" }, [])).rejects.toMatchObject({ code: "CONFLICT" });

      // Le client n'est pas déclarant au sens du personnel : tout responsable autorisé décide.
      await decideReturn(db, manager, created.id, { decision: "ACCEPT", restock: false, refundAmount: 20_000, note: "Note interne : rayure sur le boîtier" });
      view = await getCustomerReturns(db, { userId }, order.number);
      expect(view?.returns[0]?.decision).toEqual({ outcome: "ACCEPTED", note: null, refundAmount: 20_000 });
      expect(JSON.stringify(view)).not.toContain("Note interne");

      const second = await declareCustomerReturn(db, storage, asAccount(userId), order.number, await declaration(order), []);
      await decideReturn(db, manager, second.id, { decision: "REJECT", note: "Aucun défaut constaté au test" });
      view = await getCustomerReturns(db, { userId }, order.number);
      expect(view?.returns.find((entry) => entry.number === second.number)?.decision).toEqual({ outcome: "REJECTED", note: "Aucun défaut constaté au test", refundAmount: 0 });
      expect(await db.notification.count({ where: { template: "return.decided_customer" } })).toBe(2);
    });

    it("inspection en boutique : pas de réponse en ligne ; un autre client ne peut pas répondre", async () => {
      const order = await closedPickupOrder(fixtures, manager, cashier);
      const created = await declareCustomerReturn(db, storage, asGuest(order), order.number, await declaration(order), []);
      await requestReturnVerification(db, decider, created.id, { kind: "INSPECTION", request: "Apporter l'appareil en boutique" });
      expect((await getCustomerReturns(db, { userId: null, token: orderAccessToken(order.id) }, order.number))?.returns[0]?.pendingRequest).toBeNull();
      await expect(answerCustomerVerification(db, storage, asGuest(order), order.number, created.number, { response: "Je passe demain" }, [])).rejects.toMatchObject({ code: "CONFLICT" });

      const intruder = await customerAccount();
      await expect(answerCustomerVerification(db, storage, asAccount(intruder), order.number, created.number, { response: "x".repeat(5) }, [])).rejects.toMatchObject({ code: "NOT_FOUND" });
    });
  });

  it("un membre du personnel qui déclare en ligne sur sa propre commande ne décide ni n'examine ce retour (service et base)", async () => {
    const employee = await actorWith("ORDER_MANAGER");
    const order = await closedPickupOrder(fixtures, manager, cashier, undefined, employee.id);
    const created = await declareCustomerReturn(db, storage, asAccount(employee.id), order.number, await declaration(order), []);
    await expect(decideReturn(db, employee, created.id, { decision: "ACCEPT", restock: true, refundAmount: 25_000, note: "Pour moi" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(requestReturnVerification(db, employee, created.id, { kind: "PHOTOS", request: "Photos" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      db.return.update({ where: { id: created.id }, data: { status: "REJECTED", decidedAt: new Date(), decidedById: employee.id, decisionNote: "Contournement" } }),
    ).rejects.toThrow(/ne peut pas le décider/);
    await decideReturn(db, decider, created.id, { decision: "REJECT", note: "Aucun défaut constaté" });
  });

  it("réponse à un retour qui n'attend rien : refus avant toute lecture ou stockage des photos", async () => {
    const order = await closedPickupOrder(fixtures, manager, cashier);
    const created = await declareCustomerReturn(db, storage, asGuest(order), order.number, await declaration(order), []);
    let read = false;
    const files = async () => {
      read = true;
      return [PNG];
    };
    await expect(answerCustomerVerification(db, storage, asGuest(order), order.number, created.number, { response: "Voici" }, files)).rejects.toMatchObject({ code: "CONFLICT" });
    expect(read).toBe(false);
    expect(await storedFiles()).toEqual([]);
  });

  it("sans adresse IP fiable : une enveloppe commune limite quand même les envois", async () => {
    await db.auditLog.createMany({
      data: Array.from({ length: CUSTOMER_RETURN_LIMITS.unknownIpPerHour }, () => ({ action: "return.customer_answer", entityType: "Return", entityId: randomUUID(), result: "SUCCESS" as const })),
    });
    const order = await closedPickupOrder(fixtures, manager, cashier);
    await expect(declareCustomerReturn(db, storage, { access: { userId: null, token: orderAccessToken(order.id) } }, order.number, await declaration(order), [])).rejects.toMatchObject({
      code: "RATE_LIMITED",
    });
  });

  it("en base : le déclarant interne existe si et seulement si le personnel déclare", async () => {
    const order = await closedPickupOrder(fixtures, manager, cashier);
    const created = await declareCustomerReturn(db, storage, asGuest(order), order.number, await declaration(order), []);
    await expect(db.return.update({ where: { id: created.id }, data: { createdById: manager.id } })).rejects.toThrow(/contenu ne se modifie pas/);
    await expect(db.return.update({ where: { id: created.id }, data: { declaredBy: "STAFF" } })).rejects.toThrow(/contenu ne se modifie pas/);
    await expect(
      db.return.create({
        data: { number: "RET-TEST-1", orderId: order.id, idempotencyKey: randomUUID(), reason: "Test", itemsValue: 0, declaredBy: "STAFF", handedOverAt: new Date(), declarationDeadline: new Date(), items: { create: [] } },
      }),
    ).rejects.toThrow(/returns_declarer_check/);
  });
});
