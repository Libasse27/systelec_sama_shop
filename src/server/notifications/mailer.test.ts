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

  it("échec du fournisseur : l'erreur remonte (notification tracée en échec par l'appelant)", async () => {
    sendMail.mockRejectedValue(new Error("535 Authentication failed"));
    const { sendEmail } = await loadMailer(SMTP);
    await expect(sendEmail(MESSAGE)).rejects.toThrow(/535/);
  });

  it("erreur du fournisseur sans secret : clé SMTP masquée (en clair et en base64), code SMTP conservé", async () => {
    const echoed = `535 Authentication failed for compte:${SMTP.SMTP_PASSWORD} (${Buffer.from(SMTP.SMTP_PASSWORD).toString("base64")})`;
    sendMail.mockRejectedValue(Object.assign(new Error(echoed), { responseCode: 535 }));
    const { sendEmail } = await loadMailer({ ...SMTP, SMTP_PASSWORD: SMTP.SMTP_PASSWORD });
    await expect(sendEmail(MESSAGE)).rejects.toMatchObject({ message: "535 Authentication failed for compte:*** (***)", responseCode: 535 });
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
