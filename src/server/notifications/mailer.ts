import "server-only";
import nodemailer from "nodemailer";
import { getServerEnv, type ServerEnv } from "@/lib/env";
import { logger } from "@/server/logger";

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
}

export type EmailResult = { sent: true } | { sent: false; reason: "NOT_CONFIGURED" };

/** Port SMTP à TLS implicite (SMTPS) ; les autres (587, 25…) passent en TLS par STARTTLS. */
const IMPLICIT_TLS_PORT = 465;
/**
 * Délais bornés : l'envoi a lieu pendant la requête, après la transaction (dispatchNotifications) ;
 * un fournisseur injoignable ne doit pas bloquer la page plus de quelques secondes.
 */
const SMTP_TIMEOUTS = { connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 20_000 } as const;

type SmtpConfig = Pick<ServerEnv, "APP_ENV" | "SMTP_HOST" | "SMTP_PORT" | "SMTP_USER" | "SMTP_PASSWORD">;

/** Options du transport SMTP (fournisseur quelconque : Brevo, hébergeur…), sans connexion ouverte. */
export function smtpTransportOptions(config: SmtpConfig) {
  const port = config.SMTP_PORT!;
  const implicitTls = port === IMPLICIT_TLS_PORT;
  return {
    host: config.SMTP_HOST!,
    port,
    secure: implicitTls,
    // En production, jamais d'envoi en clair : STARTTLS exigé (identifiants et contenu chiffrés).
    requireTLS: !implicitTls && config.APP_ENV === "production",
    auth: config.SMTP_USER ? { user: config.SMTP_USER, pass: config.SMTP_PASSWORD ?? "" } : undefined,
    ...SMTP_TIMEOUTS,
  };
}

let transport: ReturnType<typeof nodemailer.createTransport> | undefined;

function getTransport() {
  transport ??= nodemailer.createTransport(smtpTransportOptions(getServerEnv()));
  return transport;
}

export function isEmailConfigured(): boolean {
  return getServerEnv().SMTP_HOST !== undefined;
}

/**
 * Point d'envoi unique des e-mails (décision D11). Sans fournisseur configuré, rien n'est envoyé ni
 * simulé : l'absence est journalisée et rendue explicite. Un échec d'envoi LÈVE une erreur, pour que
 * l'appelant le trace (notification FAILED) au lieu de le croire envoyé.
 */
export async function sendEmail(message: EmailMessage): Promise<EmailResult> {
  if (!isEmailConfigured()) {
    logger.warn("E-mail non envoyé : aucun fournisseur SMTP configuré", { subject: message.subject });
    return { sent: false, reason: "NOT_CONFIGURED" };
  }
  const env = getServerEnv();
  try {
    await getTransport().sendMail({ from: env.SMTP_FROM, to: message.to, subject: message.subject, text: message.text });
  } catch (error) {
    throw redactSmtpError(error, env.SMTP_PASSWORD);
  }
  return { sent: true };
}

/**
 * Erreur d'envoi sans secret : la clé SMTP (en clair ou en base64, forme de l'authentification SMTP)
 * est masquée si le serveur la renvoyait dans sa réponse. Le code SMTP est conservé : il décide du renvoi.
 */
export function redactSmtpError(error: unknown, password: string | undefined): Error {
  const message = error instanceof Error ? error.message : "Échec d'envoi SMTP";
  const secrets = password ? [password, Buffer.from(password).toString("base64")] : [];
  const redacted = secrets.reduce((text, secret) => text.split(secret).join("***"), message);
  const responseCode = (error as { responseCode?: unknown } | null)?.responseCode;
  return Object.assign(new Error(redacted), typeof responseCode === "number" ? { responseCode } : {});
}
