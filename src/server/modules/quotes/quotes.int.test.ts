import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import type { Actor } from "@/server/authz/service";
import { syncRolesAndPermissions } from "@/server/authz/sync";
import { db } from "@/server/db/client";
import { accessToken } from "@/server/modules/orders/access-token";
import { resetDatabase } from "../../../../tests/setup/db";
import { actorWith } from "../../../../tests/support/actors";
import { dayIn, QUOTE_TOTAL, quoteLines, requestInput, seedService, sentQuote } from "../../../../tests/support/services";
import { getAdminQuote, getQuoteForViewer, getRequestForViewer, listAdminRequests, listCustomerRequests } from "./queries";
import { createQuoteDraft, decideQuote, expireQuotes, saveQuoteDraft, sendQuote } from "./quotes";
import { changeQuoteRequestStatus, REQUEST_LIMITS, submitQuoteRequest } from "./requests";

let manager: Actor;

async function customerAccount(): Promise<string> {
  const id = randomUUID();
  await db.user.create({ data: { id, name: "Client", email: `${id}@example.sn` } });
  return id;
}

describe("demandes de devis et devis (§20 n° 19 et 20, PostgreSQL)", () => {
  beforeEach(async () => {
    await resetDatabase();
    await syncRolesAndPermissions(db);
    await seedService();
    manager = await actorWith("TECH_MANAGER");
  });

  describe("demande", () => {
    it("un invité dépose une demande : numéro, lien de suivi, service rattaché, notification tracée", async () => {
      const submitted = await submitQuoteRequest(db, { userId: null, ip: "10.0.0.1" }, requestInput({ urgency: "URGENT" }));
      expect(submitted.number).toMatch(/^DDE-\d{4}-000001$/);
      expect(submitted.accessToken).toBe(accessToken("quote_request", submitted.id));
      const saved = await db.quoteRequest.findUniqueOrThrow({ where: { id: submitted.id }, include: { service: true, customer: true } });
      expect(saved).toMatchObject({ status: "NEW", urgency: "URGENT", service: { slug: "installation-cameras" }, customer: { userId: null } });
      expect(await db.notification.count({ where: { quoteRequestId: submitted.id, template: "quote_request.received" } })).toBe(2);

      const view = await getRequestForViewer(db, { userId: null, token: submitted.accessToken! }, submitted.number);
      expect(view).toMatchObject({ number: submitted.number, serviceName: "Installation de caméras", quotes: [] });
      expect(await getRequestForViewer(db, { userId: null, token: "faux" }, submitted.number)).toBeNull();
      expect(await getRequestForViewer(db, { userId: null }, submitted.number)).toBeNull();
    });

    it("idempotence : une double soumission, même simultanée, ne crée qu'une demande", async () => {
      const input = requestInput();
      const results = await Promise.all([submitQuoteRequest(db, { userId: null }, input), submitQuoteRequest(db, { userId: null }, input)]);
      expect(new Set(results.map((result) => result.number)).size).toBe(1);
      expect(await db.quoteRequest.count()).toBe(1);
      // La même clé rejouée depuis un compte est refusée.
      await expect(submitQuoteRequest(db, { userId: await customerAccount() }, input)).rejects.toThrow(/déjà été envoyée/);
    });

    it("rattache la demande au compte, la cache aux autres, et la liste dans « Mon compte »", async () => {
      const userId = await customerAccount();
      const submitted = await submitQuoteRequest(db, { userId }, requestInput());
      expect(submitted.accessToken).toBeNull();
      expect(await getRequestForViewer(db, { userId }, submitted.number)).not.toBeNull();
      expect(await getRequestForViewer(db, { userId: await customerAccount() }, submitted.number)).toBeNull();
      // Un jeton ne donne jamais accès à la demande d'un compte.
      expect(await getRequestForViewer(db, { userId: null, token: accessToken("quote_request", submitted.id) }, submitted.number)).toBeNull();
      expect(await listCustomerRequests(db, userId)).toMatchObject([{ number: submitted.number, status: "NEW" }]);
    });

    it("refuse une demande incomplète et limite les demandes ouvertes par téléphone, depuis une même connexion", async () => {
      await expect(submitQuoteRequest(db, { userId: null }, requestInput({ description: "court" }))).rejects.toMatchObject({ code: "VALIDATION" });
      for (let i = 0; i < REQUEST_LIMITS.openPerPhone; i++) await submitQuoteRequest(db, { userId: null, ip: "10.0.0.7" }, requestInput());
      await expect(submitQuoteRequest(db, { userId: null, ip: "10.0.0.7" }, requestInput())).rejects.toMatchObject({ code: "RATE_LIMITED" });
      // Un tiers qui sature le numéro depuis sa connexion ne bloque pas la victime.
      await expect(submitQuoteRequest(db, { userId: null, ip: "10.0.0.8" }, requestInput())).resolves.toMatchObject({ number: expect.any(String) });
    });

    it("plafonne les accusés de réception par adresse e-mail (formulaire non utilisable pour arroser une adresse)", async () => {
      for (let i = 0; i < REQUEST_LIMITS.acknowledgementsPerEmailPerDay + 2; i++) {
        await submitQuoteRequest(db, { userId: null, ip: `10.1.0.${i}` }, requestInput());
      }
      expect(await db.notification.count({ where: { channel: "EMAIL", template: "quote_request.received" } })).toBe(REQUEST_LIMITS.acknowledgementsPerEmailPerDay);
      expect(await db.quoteRequest.count()).toBe(REQUEST_LIMITS.acknowledgementsPerEmailPerDay + 2);
    });

    it("le personnel prend en charge ou clôt une demande avec motif ; le service client ne peut pas", async () => {
      const { id } = await submitQuoteRequest(db, { userId: null }, requestInput());
      await expect(changeQuoteRequestStatus(db, await actorWith("CUSTOMER_SERVICE"), id, { status: "IN_REVIEW" })).rejects.toMatchObject({ code: "FORBIDDEN" });
      await changeQuoteRequestStatus(db, manager, id, { status: "IN_REVIEW" });
      await expect(changeQuoteRequestStatus(db, manager, id, { status: "CANCELLED" })).rejects.toMatchObject({ code: "VALIDATION" });
      await changeQuoteRequestStatus(db, manager, id, { status: "CANCELLED", note: "Hors zone d'intervention" });
      expect(await db.quoteRequest.findUniqueOrThrow({ where: { id } })).toMatchObject({ status: "CANCELLED", closingNote: "Hors zone d'intervention" });
      await expect(createQuoteDraft(db, manager, id)).rejects.toThrow(/close/);
      const { rows } = await listAdminRequests(db, manager, { status: "CANCELLED" });
      expect(rows).toHaveLength(1);
    });
  });

  describe("devis", () => {
    it("brouillon détaillé : total calculé par le serveur, invisible du client tant qu'il n'est pas envoyé", async () => {
      const request = await submitQuoteRequest(db, { userId: null }, requestInput());
      const quote = await createQuoteDraft(db, manager, request.id);
      expect(quote.number).toMatch(/^DEV-\d{4}-000001$/);
      expect((await db.quoteRequest.findUniqueOrThrow({ where: { id: request.id } })).status).toBe("IN_REVIEW");

      const { total } = await saveQuoteDraft(db, manager, quote.id, { validUntil: dayIn(15), items: quoteLines });
      expect(total).toBe(QUOTE_TOTAL);
      expect(await db.quoteItem.findMany({ where: { quoteId: quote.id }, orderBy: { position: "asc" }, select: { lineTotal: true } })).toEqual([
        { lineTotal: 140_000 },
        { lineTotal: 40_000 },
      ]);
      expect(await getQuoteForViewer(db, { userId: null, token: accessToken("quote", quote.id) }, quote.number)).toBeNull();
      await expect(saveQuoteDraft(db, manager, quote.id, { validUntil: "2020-01-01", items: quoteLines })).rejects.toThrow(/déjà passée/);
    });

    it("envoi : devis figé, demande « devis envoyé », client notifié ; un devis vide ne part pas", async () => {
      const request = await submitQuoteRequest(db, { userId: null }, requestInput());
      const empty = await createQuoteDraft(db, manager, request.id);
      await expect(sendQuote(db, manager, empty.id)).rejects.toThrow(/au moins une ligne/);

      const { quote } = await sentQuote(manager);
      const saved = await db.quote.findUniqueOrThrow({ where: { id: quote.id }, include: { quoteRequest: true } });
      expect(saved).toMatchObject({ status: "SENT", total: QUOTE_TOTAL, quoteRequest: { status: "QUOTED" } });
      expect(saved.sentAt).not.toBeNull();
      expect(await db.notification.count({ where: { quoteId: quote.id, template: "quote.sent" } })).toBe(2);
      await expect(saveQuoteDraft(db, manager, quote.id, { validUntil: dayIn(30), items: [] })).rejects.toThrow(/ne se modifie plus/);
      await expect(sendQuote(db, manager, quote.id)).rejects.toThrow(/déjà envoyé/);
      await expect(createQuoteDraft(db, await actorWith("CUSTOMER_SERVICE"), request.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
    });

    it("l'invité accepte depuis son lien : intervention à planifier au montant du devis, demande close", async () => {
      const { request, quote } = await sentQuote(manager);
      const token = accessToken("quote", quote.id);
      await expect(decideQuote(db, { kind: "guest", token: "faux" }, quote.id, { accept: true })).rejects.toMatchObject({ code: "NOT_FOUND" });
      // Le jeton de la demande n'ouvre pas le devis.
      await expect(decideQuote(db, { kind: "guest", token: request.accessToken! }, quote.id, { accept: true })).rejects.toMatchObject({ code: "NOT_FOUND" });

      const view = await getQuoteForViewer(db, { userId: null, token }, quote.number);
      expect(view).toMatchObject({ status: "SENT", canDecide: true, total: QUOTE_TOTAL, intervention: null });
      expect(view!.items).toHaveLength(2);

      const { interventionNumber } = await decideQuote(db, { kind: "guest", token }, quote.id, { accept: true, note: null });
      expect(interventionNumber).toMatch(/^INT-\d{4}-000001$/);
      const intervention = await db.intervention.findUniqueOrThrow({ where: { quoteId: quote.id } });
      expect(intervention).toMatchObject({ status: "TO_SCHEDULE", amountDue: QUOTE_TOTAL, amountPaid: 0, paymentStatus: "UNPAID", address: "Villa 12, Sacré-Cœur 3, Dakar" });
      expect(await db.quoteRequest.findUniqueOrThrow({ where: { id: request.id } })).toMatchObject({ status: "ACCEPTED" });
      expect(await getQuoteForViewer(db, { userId: null, token }, quote.number)).toMatchObject({ status: "ACCEPTED", canDecide: false, intervention: { status: "TO_SCHEDULE" } });
      await expect(decideQuote(db, { kind: "guest", token }, quote.id, { accept: false })).rejects.toThrow(/n'attend plus de réponse/);
    });

    it("deux acceptations simultanées ne créent qu'une intervention", async () => {
      const { quote } = await sentQuote(manager);
      const token = accessToken("quote", quote.id);
      const results = await Promise.allSettled([
        decideQuote(db, { kind: "guest", token }, quote.id, { accept: true }),
        decideQuote(db, { kind: "staff", actor: manager }, quote.id, { accept: true }),
      ]);
      expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
      expect(await db.intervention.count()).toBe(1);
    });

    it("refus par le titulaire du compte ; un autre compte ne voit ni ne décide", async () => {
      const userId = await customerAccount();
      const { quote } = await sentQuote(manager, userId);
      await expect(decideQuote(db, { kind: "customer", userId: await customerAccount() }, quote.id, { accept: true })).rejects.toMatchObject({ code: "NOT_FOUND" });
      expect(await getQuoteForViewer(db, { userId: await customerAccount() }, quote.number)).toBeNull();
      await decideQuote(db, { kind: "customer", userId }, quote.id, { accept: false, note: "Trop cher" });
      expect(await db.quote.findUniqueOrThrow({ where: { id: quote.id } })).toMatchObject({ status: "REFUSED", decidedById: userId, decisionNote: "Trop cher" });
      expect(await db.intervention.count()).toBe(0);
    });

    it("un devis expiré ne s'accepte plus et passe « expiré »", async () => {
      const request = await submitQuoteRequest(db, { userId: null }, requestInput());
      const quote = await createQuoteDraft(db, manager, request.id);
      await saveQuoteDraft(db, manager, quote.id, { validUntil: dayIn(1), items: quoteLines });
      // Validité dépassée posée en brouillon (un devis envoyé ne se modifie plus, même en base).
      await db.quote.update({ where: { id: quote.id }, data: { validUntil: new Date(Date.now() - 1000), status: "SENT" } });
      expect((await getAdminQuote(db, manager, quote.id))!.status).toBe("EXPIRED");
      await expect(decideQuote(db, { kind: "staff", actor: manager }, quote.id, { accept: true })).rejects.toThrow(/expiré/);
      expect(await expireQuotes(db)).toBe(1);
      expect((await db.quote.findUniqueOrThrow({ where: { id: quote.id } })).status).toBe("EXPIRED");
    });
  });

  describe("une demande, une seule intervention", () => {
    it("accepter un devis clôt les autres devis de la demande ; plus d'acceptation ni d'envoi ensuite", async () => {
      const { request, quote } = await sentQuote(manager);
      const second = await createQuoteDraft(db, manager, request.id);
      await saveQuoteDraft(db, manager, second.id, { validUntil: dayIn(30), items: quoteLines });
      await sendQuote(db, manager, second.id);
      const draft = await createQuoteDraft(db, manager, request.id);
      await saveQuoteDraft(db, manager, draft.id, { validUntil: dayIn(30), items: quoteLines });

      await decideQuote(db, { kind: "staff", actor: manager }, quote.id, { accept: true });
      expect((await db.quote.findUniqueOrThrow({ where: { id: second.id } })).status).toBe("EXPIRED");
      await expect(decideQuote(db, { kind: "guest", token: accessToken("quote", second.id) }, second.id, { accept: true })).rejects.toMatchObject({ code: "CONFLICT" });
      await expect(sendQuote(db, manager, draft.id)).rejects.toThrow(/close/);
      expect(await db.intervention.count()).toBe(1);
    });

    it("une demande close sans suite rend ses devis envoyés inacceptables", async () => {
      const { request, quote } = await sentQuote(manager);
      await changeQuoteRequestStatus(db, manager, request.id, { status: "CANCELLED", note: "Client parti" });
      await expect(decideQuote(db, { kind: "guest", token: accessToken("quote", quote.id) }, quote.id, { accept: true })).rejects.toMatchObject({ code: "CONFLICT" });
      expect(await db.quoteRequest.findUniqueOrThrow({ where: { id: request.id } })).toMatchObject({ status: "CANCELLED" });
      expect(await db.intervention.count()).toBe(0);
    });

    it("en base : un devis envoyé est figé et une demande n'a qu'une intervention active", async () => {
      const { quote, request } = await sentQuote(manager);
      await expect(db.quoteItem.updateMany({ where: { quoteId: quote.id }, data: { unitPrice: 1, lineTotal: 1 } })).rejects.toThrow(/ne se modifient plus/);
      await expect(db.quoteItem.deleteMany({ where: { quoteId: quote.id } })).rejects.toThrow(/ne se modifient plus/);
      await expect(db.quote.update({ where: { id: quote.id }, data: { total: 1, subtotal: 1 } })).rejects.toThrow(/ne se modifie plus/);
      await decideQuote(db, { kind: "staff", actor: manager }, quote.id, { accept: true });
      const intervention = await db.intervention.findFirstOrThrow({ where: { quoteRequestId: request.id } });
      await expect(
        db.intervention.create({
          data: {
            number: "INT-TEST-1",
            customerId: intervention.customerId,
            quoteRequestId: request.id,
            contact: intervention.contact as object,
            address: intervention.address,
            problem: intervention.problem,
            amountDue: 1,
          },
        }),
      ).rejects.toThrow();
    });
  });
});
