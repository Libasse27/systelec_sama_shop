import { beforeEach, describe, expect, it, vi } from "vitest";
import { notificationStatusLabel } from "@/lib/labels";
import { syncRolesAndPermissions } from "@/server/authz/sync";
import { db } from "@/server/db/client";
import { resetDatabase } from "../../../tests/setup/db";
import { actorWith } from "../../../tests/support/actors";
import { confirmedOrder, seedOrderCatalog } from "../../../tests/support/orders";
import { getAdminOrder } from "@/server/modules/orders/queries";
import { EmailSendError, sendEmail } from "./mailer";
import { dispatchNotifications, MAX_EMAIL_ATTEMPTS, retryNotifications } from "./queue";

vi.mock("./mailer", async (importOriginal) => ({ ...(await importOriginal<typeof import("./mailer")>()), sendEmail: vi.fn() }));
const send = vi.mocked(sendEmail);

const MINUTE = 60_000;
const NOW = new Date("2026-10-20T10:00:00Z");
const payload = { number: "CMD-2026-000001", customerName: "Awa", total: 50_000, fulfillment: "PICKUP" };
let orderId: string;

const smtpError = (_message: string, responseCode?: number) =>
  new EmailSendError(responseCode === 550 ? "RECIPIENT_REJECTED" : "TEMPORARY", responseCode);

/** Notification e-mail de la commande de test, dans l'état donné. */
async function notification(data: { status: "FAILED" | "PENDING" | "SENT" | "SKIPPED_NO_PROVIDER"; attempts?: number; nextAttemptAt?: Date | null; createdAt?: Date; sentAt?: Date | null; channel?: "EMAIL" | "SMS" }) {
  return db.notification.create({
    data: { channel: "EMAIL", template: "order.placed", recipient: "awa@example.sn", payload, orderId, ...data },
  });
}
const row = (id: string) => db.notification.findUniqueOrThrow({ where: { id } });

let heldCalls = 0;
/** Client dont la première mise à jour de notification attend `gate` (ordre d'exécution imposé entre deux passages). */
function heldClient(gate: Promise<void>): typeof db {
  heldCalls = 0;
  const notifications = new Proxy(db.notification, {
    get(target, property) {
      const value = Reflect.get(target, property) as unknown;
      if (property !== "updateMany" || typeof value !== "function") return typeof value === "function" ? value.bind(target) : value;
      return async (...args: unknown[]) => {
        heldCalls += 1;
        if (heldCalls === 1) await gate;
        return (value as (...a: unknown[]) => unknown).apply(target, args);
      };
    },
  });
  return new Proxy(db, { get: (target, property) => (property === "notification" ? notifications : Reflect.get(target, property)) });
}

describe("renvoi automatique des e-mails en échec (PostgreSQL)", () => {
  beforeEach(async () => {
    await resetDatabase();
    await syncRolesAndPermissions(db);
    const fixtures = await seedOrderCatalog();
    // Notifications de la commande de test elle-même : sans fournisseur (SKIPPED), hors du renvoi.
    send.mockResolvedValue({ sent: false, reason: "NOT_CONFIGURED" });
    orderId = (await confirmedOrder(fixtures, await actorWith("ORDER_MANAGER"))).id;
    send.mockReset();
  });

  it("renvoie un échec arrivé à échéance : envoyé, essai compté, cause effacée", async () => {
    send.mockResolvedValue({ sent: true });
    const failed = await notification({ status: "FAILED", attempts: 1, nextAttemptAt: new Date(NOW.getTime() - MINUTE) });
    await db.notification.update({ where: { id: failed.id }, data: { error: "connect ECONNREFUSED" } });

    expect(await retryNotifications(db, NOW)).toEqual({ sent: 1, failed: 0, skipped: 0 });
    expect(await row(failed.id)).toMatchObject({ status: "SENT", attempts: 2, nextAttemptAt: null, error: null });
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ to: "awa@example.sn", subject: "Commande CMD-2026-000001 reçue" }));
  });

  it("nouvel échec : essais à 15 min, 1 h puis 4 h, abandon définitif au 4e envoi", async () => {
    send.mockRejectedValue(smtpError("421 Service temporairement indisponible", 421));
    const failed = await notification({ status: "FAILED", attempts: 1, nextAttemptAt: NOW });
    const expectedDelays = [60, 240];
    let clock = NOW;
    for (const delay of expectedDelays) {
      expect(await retryNotifications(db, clock)).toEqual({ sent: 0, failed: 1, skipped: 0 });
      const current = await row(failed.id);
      expect(current.status).toBe("FAILED");
      expect(current.error).toBe("SMTP_TEMPORARY_FAILURE");
      expect(current.nextAttemptAt!.getTime() - Date.now()).toBeGreaterThan((delay - 1) * MINUTE);
      expect(current.nextAttemptAt!.getTime() - Date.now()).toBeLessThanOrEqual(delay * MINUTE);
      clock = current.nextAttemptAt!;
    }
    await retryNotifications(db, clock);
    expect(await row(failed.id)).toMatchObject({ status: "FAILED", attempts: MAX_EMAIL_ATTEMPTS, nextAttemptAt: null });
    expect(await retryNotifications(db, new Date(clock.getTime() + 24 * 60 * MINUTE))).toEqual({ sent: 0, failed: 0, skipped: 0 });
    expect(send).toHaveBeenCalledTimes(MAX_EMAIL_ATTEMPTS - 1);
  });

  it("fiche commande : la requête fournit essais, prochain essai et catégorie sûre conforme à l'état en base", async () => {
    send.mockRejectedValueOnce(smtpError("421 Service temporairement indisponible", 421)).mockRejectedValueOnce(smtpError("550 5.1.1 Mailbox unavailable", 550));
    // Un seul passage, dans l'ordre de création : 421 (temporaire) puis 550 (définitif).
    const scheduled = await notification({ status: "FAILED", attempts: 1, nextAttemptAt: NOW, createdAt: new Date(NOW.getTime() - 2 * MINUTE) });
    const definitive = await notification({ status: "FAILED", attempts: 1, nextAttemptAt: NOW, createdAt: new Date(NOW.getTime() - MINUTE) });
    expect(await retryNotifications(db, NOW)).toEqual({ sent: 0, failed: 2, skipped: 0 });

    const view = await getAdminOrder(db, await actorWith("ORDER_MANAGER"), orderId);
    const byId = new Map((await db.notification.findMany({ where: { orderId } })).map((row) => [row.id, row]));
    const shown = view!.notifications.map((entry) => ({ ...entry, label: notificationStatusLabel(entry) }));
    const scheduledRow = byId.get(scheduled.id)!;
    expect(shown).toContainEqual(expect.objectContaining({ status: "FAILED", attempts: 2, nextAttemptAt: scheduledRow.nextAttemptAt, error: "SMTP_TEMPORARY_FAILURE" }));
    expect(shown.map((entry) => entry.label)).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^échec après 2 essai\(s\), nouvel essai prévu le .+ — incident temporaire du fournisseur$/),
        "échec définitif après 2 essai(s) — adresse destinataire refusée",
        "non envoyée (aucun fournisseur)",
      ]),
    );
    expect(byId.get(definitive.id)).toMatchObject({ status: "FAILED", nextAttemptAt: null });
  });

  it("refus définitif du destinataire (550) : jamais renvoyé", async () => {
    send.mockRejectedValue(smtpError("550 Mailbox unavailable", 550));
    const failed = await notification({ status: "FAILED", attempts: 1, nextAttemptAt: NOW });
    await retryNotifications(db, NOW);
    expect(await row(failed.id)).toMatchObject({ status: "FAILED", attempts: 2, nextAttemptAt: null });
  });

  it("ne touche ni aux échecs pas encore dus, ni aux abandons, ni aux SMS, envoyés ou sans fournisseur", async () => {
    const untouched = await Promise.all([
      notification({ status: "FAILED", attempts: 1, nextAttemptAt: new Date(NOW.getTime() + MINUTE) }),
      notification({ status: "FAILED", attempts: 1, nextAttemptAt: null }),
      notification({ status: "SKIPPED_NO_PROVIDER", channel: "SMS", createdAt: new Date(NOW.getTime() - 60 * MINUTE) }),
      notification({ status: "SKIPPED_NO_PROVIDER", createdAt: new Date(NOW.getTime() - 60 * MINUTE) }),
      notification({ status: "SENT", attempts: 1, createdAt: new Date(NOW.getTime() - 60 * MINUTE) }),
    ]);
    expect(await retryNotifications(db, NOW)).toEqual({ sent: 0, failed: 0, skipped: 0 });
    expect(send).not.toHaveBeenCalled();
    for (const before of untouched) expect(await row(before.id)).toMatchObject({ status: before.status, attempts: before.attempts });
  });

  it("rattrape un e-mail resté en attente sans envoi depuis plus de 10 minutes, ni un récent ni un périmé (plus de 24 h)", async () => {
    send.mockResolvedValue({ sent: true });
    const orphan = await notification({ status: "PENDING", createdAt: new Date(NOW.getTime() - 11 * MINUTE) });
    const recent = await notification({ status: "PENDING", createdAt: new Date(NOW.getTime() - 2 * MINUTE) });
    const stale = await notification({ status: "PENDING", createdAt: new Date(NOW.getTime() - 25 * 60 * MINUTE) });
    expect(await retryNotifications(db, NOW)).toEqual({ sent: 1, failed: 0, skipped: 0 });
    expect(await row(orphan.id)).toMatchObject({ status: "SENT", attempts: 1 });
    expect(await row(recent.id)).toMatchObject({ status: "PENDING", attempts: 0 });
    expect(await row(stale.id)).toMatchObject({ status: "PENDING", attempts: 0 });
  });

  it("réservation abandonnée (processus arrêté pendant l'envoi) : rattrapée après 10 min, ni avant, ni au-delà de 24 h", async () => {
    send.mockResolvedValue({ sent: true });
    const abandoned = await notification({ status: "PENDING", attempts: 1, sentAt: new Date(NOW.getTime() - 11 * MINUTE), createdAt: new Date(NOW.getTime() - 12 * MINUTE) });
    const inFlight = await notification({ status: "PENDING", attempts: 1, sentAt: new Date(NOW.getTime() - 2 * MINUTE), createdAt: new Date(NOW.getTime() - 12 * MINUTE) });
    const stale = await notification({ status: "PENDING", attempts: 1, sentAt: new Date(NOW.getTime() - 25 * 60 * MINUTE), createdAt: new Date(NOW.getTime() - 25 * 60 * MINUTE) });
    expect(await retryNotifications(db, NOW)).toEqual({ sent: 1, failed: 0, skipped: 0 });
    expect(await row(abandoned.id)).toMatchObject({ status: "SENT", attempts: 2 });
    expect(await row(inFlight.id)).toMatchObject({ status: "PENDING", attempts: 1 });
    expect(await row(stale.id)).toMatchObject({ status: "PENDING", attempts: 1 });
  });

  it("jamais plus de 4 envois : une réservation abandonnée au 4e envoi passe en échec définitif sans renvoi", async () => {
    const exhausted = await notification({ status: "PENDING", attempts: MAX_EMAIL_ATTEMPTS, sentAt: new Date(NOW.getTime() - 11 * MINUTE), createdAt: new Date(NOW.getTime() - 5 * 60 * MINUTE) });
    expect(await retryNotifications(db, NOW)).toEqual({ sent: 0, failed: 1, skipped: 0 });
    expect(send).not.toHaveBeenCalled();
    expect(await row(exhausted.id)).toMatchObject({ status: "FAILED", attempts: MAX_EMAIL_ATTEMPTS, nextAttemptAt: null, sentAt: null, error: "ABANDONED" });
  });

  it("stocke INTERNAL pour une exception de rendu ou de traitement, jamais un code SMTP", async () => {
    send.mockRejectedValue(new Error("internal host or credential detail"));
    const pending = await notification({ status: "FAILED", attempts: 1, nextAttemptAt: NOW });
    await retryNotifications(db, NOW);
    expect(await row(pending.id)).toMatchObject({ status: "FAILED", error: "INTERNAL" });
  });

  it("deux travailleurs sur la même notification en attente (envoi initial) : une seule réservation, un seul envoi", async () => {
    send.mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
      return { sent: true };
    });
    // Éligible au rattrapage (plus de 10 min) : envoi initial et tâche planifiée se disputent la même ligne, horloge réelle.
    const pending = await notification({ status: "PENDING", createdAt: new Date(Date.now() - 11 * MINUTE) });
    await Promise.all([dispatchNotifications(db, { orderId }), dispatchNotifications(db, { orderId }), retryNotifications(db), retryNotifications(db)]);
    expect(send).toHaveBeenCalledTimes(1);
    expect(await row(pending.id)).toMatchObject({ status: "SENT", attempts: 1 });
  });

  it("deux passages sur une réservation abandonnée, le second lisant avant la reprise du premier : un seul renvoi", async () => {
    const abandoned = await notification({ status: "PENDING", attempts: 1, sentAt: new Date(NOW.getTime() - 11 * MINUTE), createdAt: new Date(NOW.getTime() - 12 * MINUTE) });
    // Passage B : lit la ligne (réservation abandonnée), puis sa mise à jour est retenue jusqu'à ce que A envoie.
    let openGate!: () => void;
    const gate = new Promise<void>((resolve) => (openGate = resolve));
    const passB = retryNotifications(heldClient(gate), NOW);
    await vi.waitFor(() => expect(heldCalls).toBe(1));
    let passBDone = Promise.resolve<unknown>(undefined);
    send.mockImplementation(async () => {
      if (send.mock.calls.length === 1) {
        // A a repris la ligne et l'envoie : B tente alors de la reprendre à son tour.
        openGate();
        passBDone = passB;
        await passB;
      }
      return { sent: true };
    });
    await retryNotifications(db, NOW);
    await passBDone;
    expect(send).toHaveBeenCalledTimes(1);
    expect(await row(abandoned.id)).toMatchObject({ status: "SENT", attempts: 2 });
  });

  it("un échec déjà renvoyé par un passage n'est pas rouvert par un second passage qui l'avait lu avant", async () => {
    send.mockResolvedValue({ sent: true });
    const failed = await notification({ status: "FAILED", attempts: 1, nextAttemptAt: NOW });
    let openGate!: () => void;
    const gate = new Promise<void>((resolve) => (openGate = resolve));
    const passB = retryNotifications(heldClient(gate), NOW);
    await vi.waitFor(() => expect(heldCalls).toBe(1));
    expect(await retryNotifications(db, NOW)).toEqual({ sent: 1, failed: 0, skipped: 0 });
    openGate();
    expect(await passB).toEqual({ sent: 0, failed: 0, skipped: 0 });
    expect(send).toHaveBeenCalledTimes(1);
    expect(await row(failed.id)).toMatchObject({ status: "SENT", attempts: 2, nextAttemptAt: null });
  });

  it("deux passages simultanés : chaque e-mail n'est envoyé qu'une fois", async () => {
    send.mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
      return { sent: true };
    });
    for (let index = 0; index < 3; index += 1) await notification({ status: "FAILED", attempts: 1, nextAttemptAt: NOW });
    const reports = await Promise.all([retryNotifications(db, NOW), retryNotifications(db, NOW)]);
    expect(reports[0]!.sent + reports[1]!.sent).toBe(3);
    expect(send).toHaveBeenCalledTimes(3);
  });

  it("en base : un prochain essai n'existe que pour un échec, et le nombre d'essais reste positif", async () => {
    const sent = await notification({ status: "SENT", attempts: 1 });
    await expect(db.notification.update({ where: { id: sent.id }, data: { nextAttemptAt: NOW } })).rejects.toThrow(/notifications_retry_check/);
    await expect(db.notification.update({ where: { id: sent.id }, data: { attempts: -1 } })).rejects.toThrow(/notifications_attempts_check/);
  });
});
