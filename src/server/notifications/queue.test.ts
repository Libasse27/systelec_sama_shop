import { afterEach, describe, expect, it, vi } from "vitest";
import type { Db } from "@/server/db/client";

const { sendEmail } = vi.hoisted(() => ({ sendEmail: vi.fn() }));
vi.mock("./mailer", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./mailer")>()),
  sendEmail,
}));

import { dispatchNotifications } from "./queue";
import { EmailSendError } from "./mailer";

const notification = {
  id: "notification-id",
  template: "order.placed",
  recipient: "client@example.sn",
  payload: { number: "CMD-2026-000001", customerName: "Client", total: 1000, fulfillment: "PICKUP" },
  attempts: 0,
};

function client(findMany: ReturnType<typeof vi.fn>): Db {
  return {
    notification: {
      findMany,
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      update: vi.fn().mockResolvedValue({}),
    },
  } as unknown as Db;
}

describe("diagnostics du worker de notifications", () => {
  afterEach(() => {
    sendEmail.mockReset();
    vi.restoreAllMocks();
  });

  it("journalise les erreurs internes sans message ni chemin local, avec des frames utiles", async () => {
    const output = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const failure = Object.assign(new Error("mot de passe secret dans le message"), {
      stack: "Error: mot de passe secret dans le message\n    at runQuery (/srv/app/query.ts:41:9)",
    });
    await dispatchNotifications(client(vi.fn().mockRejectedValue(failure)), { orderId: "order-id" });

    const line = String(output.mock.calls[0]?.[0]);
    expect(line).toContain('"failureCode":"INTERNAL"');
    expect(line).toContain('"errorName":"Error"');
    expect(line).toContain("runQuery (query.ts:41:9)");
    expect(line).not.toContain("mot de passe secret");
    expect(line).not.toContain("/srv/app");
  });

  it("ne journalise ni le message SMTP brut ni les identifiants inclus dedans", async () => {
    const output = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const smtpSecret = "AUTH LOGIN user-secret pass-secret token=abc";
    sendEmail.mockRejectedValue(new EmailSendError("AUTH_FAILED", 535));
    const db = client(vi.fn().mockResolvedValue([notification]));

    await dispatchNotifications(db, { orderId: "order-id" });

    const line = String(output.mock.calls[0]?.[0]);
    expect(line).toContain('"failureCode":"SMTP_AUTHENTICATION_FAILED"');
    expect(line).not.toContain(smtpSecret);
    expect(line).not.toContain("pass-secret");
    expect(line).not.toContain('"stackFrames"');
  });
});
