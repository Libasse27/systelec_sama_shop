import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sendMail = vi.fn();
const createTransport = vi.fn(() => ({ sendMail }));
vi.mock("nodemailer", () => ({ default: { createTransport } }));

const BASE = { DATABASE_URL: "postgresql://user:pass@localhost:5432/db", AUTH_SECRET: "x".repeat(32) };
const SMTP = { SMTP_HOST: "smtp-relay.brevo.com", SMTP_PORT: "587", SMTP_USER: "compte", SMTP_PASSWORD: "cle-smtp-secrete-123", SMTP_FROM: "Boutique <contact@systelec.sn>" };
const MESSAGE = { to: "client@example.sn", subject: "Commande CMD-2026-000001 reçue", text: "Bonjour" };

/** Module rechargé à chaque test : configuration et transport sont mis en cache au premier appel. */
async function loadMailer(env: Record<string, string>) {
  vi.resetModules();
  vi.unstubAllEnvs();
  for (const [key, value] of Object.entries({ ...BASE, ...env })) vi.stubEnv(key, value);
  return import("./mailer");
}

describe("envoi d'e-mails (SMTP)", () => {
  beforeEach(() => {
    sendMail.mockReset();
    createTransport.mockClear();
  });
  afterEach(() => vi.unstubAllEnvs());

  it("sans fournisseur : rien n'est envoyé ni simulé, l'absence est explicite", async () => {
    const { sendEmail, isEmailConfigured } = await loadMailer({ SMTP_HOST: "" });
    expect(isEmailConfigured()).toBe(false);
    await expect(sendEmail(MESSAGE)).resolves.toEqual({ sent: false, reason: "NOT_CONFIGURED" });
    expect(createTransport).not.toHaveBeenCalled();
  });

  it("avec fournisseur : envoie depuis l'expéditeur configuré, un seul transport réutilisé", async () => {
    sendMail.mockResolvedValue({ messageId: "<1@brevo>" });
    const { sendEmail } = await loadMailer(SMTP);
    await expect(sendEmail(MESSAGE)).resolves.toEqual({ sent: true });
    await sendEmail({ ...MESSAGE, to: "autre@example.sn" });
    expect(sendMail).toHaveBeenNthCalledWith(1, { from: SMTP.SMTP_FROM, ...MESSAGE });
    expect(createTransport).toHaveBeenCalledTimes(1);
  });

  it("échec SMTP : seule une catégorie sûre et le code de réponse structuré remontent", async () => {
    sendMail.mockRejectedValue(new Error("535 Authentication failed"));
    const { sendEmail } = await loadMailer(SMTP);
    await expect(sendEmail(MESSAGE)).rejects.toMatchObject({ message: "UNKNOWN", category: "UNKNOWN", failureCode: "UNKNOWN" });
  });

  it("classe les erreurs internes et inconnues sans les présenter comme des échecs SMTP", async () => {
    const { classifyNotificationFailure } = await loadMailer(SMTP);
    const internal = classifyNotificationFailure(new Error("database password/internal host"));
    const unknown = classifyNotificationFailure({ responseCode: 550, code: "EAUTH" });
    expect(internal).toMatchObject({ category: "INTERNAL", failureCode: "INTERNAL", message: "INTERNAL" });
    expect(unknown).toMatchObject({ category: "UNKNOWN", failureCode: "UNKNOWN", message: "UNKNOWN" });
  });

  it("classe les erreurs structurées sans recopier les messages SMTP arbitraires", async () => {
    const cases = [
      { responseCode: 535, code: "EAUTH", label: "AUTH_FAILED" },
      { responseCode: 550, label: "RECIPIENT_REJECTED" },
      { responseCode: 421, label: "TEMPORARY" },
      { code: "ECONNREFUSED", label: "CONNECTION" },
      { code: "ETIMEDOUT", label: "CONNECTION" },
      { label: "UNKNOWN" },
    ];
    const password = SMTP.SMTP_PASSWORD;
    const padded = Buffer.from(password).toString("base64");
    const authPlain = Buffer.from([0, ...Buffer.from(SMTP.SMTP_USER), 0, ...Buffer.from(password)]).toString("base64");
    expect(Buffer.from(authPlain, "base64").includes(0)).toBe(true);
    const unusualMessages = [
      `535 AUTH LOGIN ${SMTP.SMTP_USER} ${password} ${padded}`,
      `535 AUTH PLAIN ${authPlain}`,
      `535 auth login ${SMTP.SMTP_USER.toUpperCase()} ${password.toUpperCase()} ${padded.toLowerCase()}`,
      `535 encoded ${padded.replace(/=+$/, "")} recipient client@example.sn host 10.0.0.8 token=abc`,
      `535\r\n${password}\n${SMTP.SMTP_USER}\tinternal.example`,
    ];

    for (const [index, testCase] of cases.entries()) {
      const original = Object.assign(new Error(unusualMessages[index % unusualMessages.length]), {
        ...(testCase.responseCode ? { responseCode: testCase.responseCode } : {}),
        ...(testCase.code ? { code: testCase.code } : {}),
      });
      sendMail.mockRejectedValueOnce(original);
      const { sendEmail } = await loadMailer(SMTP);
      let caught: unknown;
      try {
        await sendEmail(MESSAGE);
      } catch (error) {
        caught = error;
      }
      expect(caught).toMatchObject({ category: testCase.label });
      expect(String(caught)).not.toContain(password);
      expect(String(caught)).not.toContain(SMTP.SMTP_USER);
      expect(String(caught)).not.toContain(SMTP.SMTP_USER.toUpperCase());
      expect(String(caught)).not.toContain(padded);
      expect(String(caught)).not.toContain(padded.replace(/=+$/, ""));
      expect(String(caught)).not.toContain(authPlain);
      expect(String(caught)).not.toContain("client@example.sn");
      expect(String(caught)).not.toContain("10.0.0.8");
      expect(String(caught)).not.toContain("token=abc");
    }
  });

  it("transport : STARTTLS exigé en production, TLS implicite sur 465, délais bornés", async () => {
    const { smtpTransportOptions } = await loadMailer({});
    const config = { SMTP_HOST: "smtp-relay.brevo.com", SMTP_PORT: 587, SMTP_USER: "compte", SMTP_PASSWORD: "cle" };
    expect(smtpTransportOptions({ ...config, APP_ENV: "production" })).toMatchObject({
      host: "smtp-relay.brevo.com", port: 587, secure: false, requireTLS: true, auth: { user: "compte", pass: "cle" },
      connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 20_000,
    });
    expect(smtpTransportOptions({ ...config, SMTP_PORT: 465, APP_ENV: "production" })).toMatchObject({ secure: true, requireTLS: false });
    // Serveur de test local sans TLS (développement) ; sans identifiants, aucune authentification.
    expect(smtpTransportOptions({ ...config, SMTP_USER: undefined, SMTP_PASSWORD: undefined, APP_ENV: "development" })).toMatchObject({ requireTLS: false, auth: undefined });
  });
});
