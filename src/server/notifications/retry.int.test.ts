import { beforeEach, describe, expect, it, vi } from "vitest";
import { syncRolesAndPermissions } from "@/server/authz/sync";
import { db } from "@/server/db/client";
import { resetDatabase } from "../../../tests/setup/db";
import { actorWith } from "../../../tests/support/actors";
import { confirmedOrder, seedOrderCatalog } from "../../../tests/support/orders";
import { sendEmail } from "./mailer";
import { MAX_EMAIL_ATTEMPTS, retryNotifications } from "./queue";

vi.mock("./mailer", () => ({ sendEmail: vi.fn() }));
const send = vi.mocked(sendEmail);

const MINUTE = 60_000;
const NOW = new Date("2026-10-20T10:00:00Z");
const payload = { number: "CMD-2026-000001", customerName: "Awa", total: 50_000, fulfillment: "PICKUP" };
let orderId: string;

const smtpError = (message: string, responseCode?: number) => Object.assign(new Error(message), { responseCode });

/** Notification e-mail de la commande de test, dans l'état donné. */
async function notification(data: { status: "FAILED" | "PENDING" | "SENT" | "SKIPPED_NO_PROVIDER"; attempts?: number; nextAttemptAt?: Date | null; createdAt?: Date; channel?: "EMAIL" | "SMS" }) {
  return db.notification.create({
    data: { channel: "EMAIL", template: "order.placed", recipient: "awa@example.sn", payload, orderId, ...data },
  });
}
const row = (id: string) => db.notification.findUniqueOrThrow({ where: { id } });

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
      expect(current.error).toContain("421");
      expect(current.nextAttemptAt!.getTime() - Date.now()).toBeGreaterThan((delay - 1) * MINUTE);
      expect(current.nextAttemptAt!.getTime() - Date.now()).toBeLessThanOrEqual(delay * MINUTE);
      clock = current.nextAttemptAt!;
    }
    await retryNotifications(db, clock);
    expect(await row(failed.id)).toMatchObject({ status: "FAILED", attempts: MAX_EMAIL_ATTEMPTS, nextAttemptAt: null });
    expect(await retryNotifications(db, new Date(clock.getTime() + 24 * 60 * MINUTE))).toEqual({ sent: 0, failed: 0, skipped: 0 });
    expect(send).toHaveBeenCalledTimes(MAX_EMAIL_ATTEMPTS - 1);
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
