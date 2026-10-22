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

export type NotificationFailureCode =
  | "SMTP_AUTHENTICATION_FAILED"
  | "SMTP_RECIPIENT_REJECTED"
  | "SMTP_TEMPORARY_FAILURE"
  | "SMTP_CONNECTION_FAILURE"
  | "SMTP_DELIVERY_FAILURE"
  | "INTERNAL"
  | "UNKNOWN";

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
 * simulé : l'absence est journalisée et rendue explicite. Un échec d'envoi LÈVE une EmailSendError,
 * pour que l'appelant le trace (notification FAILED) au lieu de le croire envoyé.
 */
export async function sendEmail(message: EmailMessage): Promise<EmailResult> {
  if (!isEmailConfigured()) {
    logger.warn("E-mail non envoyé : aucun fournisseur SMTP configuré", { subject: message.subject });
    return { sent: false, reason: "NOT_CONFIGURED" };
  }
  try {
    await getTransport().sendMail({ from: getServerEnv().SMTP_FROM, to: message.to, subject: message.subject, text: message.text });
  } catch (error) {
    throw classifyNotificationFailure(error, "smtp");
  }
  return { sent: true };
}

/**
 * Catégories d'échec d'envoi : SEULE information conservée (base, journaux, administration). Le texte
 * renvoyé par le serveur SMTP n'est jamais repris : il peut contenir des identifiants, des jetons
 * d'authentification, des adresses ou des détails d'infrastructure, sous des formes qu'aucun masquage
 * ne garantit de reconnaître (casse, encodages, jetons AUTH PLAIN…).
 */
export const EMAIL_FAILURE_CATEGORIES = ["RECIPIENT_REJECTED", "AUTH_FAILED", "TEMPORARY", "CONNECTION", "MESSAGE_REJECTED", "UNKNOWN", "INTERNAL"] as const;
export type EmailFailureCategory = (typeof EMAIL_FAILURE_CATEGORIES)[number];

/** Refus du destinataire (boîte inexistante, adresse invalide) : définitifs, jamais renvoyés. */
const RECIPIENT_REJECTED_CODES = new Set([550, 551, 553]);
/** Authentification refusée ou exigée : configuration SMTP à vérifier. */
const AUTH_FAILED_CODES = new Set([530, 534, 535, 538]);
/** Codes nodemailer d'un serveur injoignable ou d'une connexion rompue. */
const CONNECTION_ERROR_CODES = new Set(["ECONNECTION", "ECONNREFUSED", "ECONNRESET", "EHOSTUNREACH", "ENOTFOUND", "EAI_AGAIN", "ESOCKET", "ETIMEDOUT", "EDNS", "ETLS", "EREQUIRETLS"]);
const MESSAGE_ERROR_CODES = new Set(["EENVELOPE", "EMESSAGE"]);
/** Forme d'un code d'erreur nodemailer ou système (ECONNECTION, EAUTH…) : rien d'autre n'est repris. */
const ERROR_CODE_SHAPE = /^E[A-Z]{2,15}$/;

/** Échec d'envoi sans texte du serveur : catégorie, code de réponse SMTP (nombre) et code nodemailer (forme contrôlée). */
export class EmailSendError extends Error {
  readonly failureCode: NotificationFailureCode;
  constructor(
    readonly category: EmailFailureCategory,
    readonly responseCode?: number,
    readonly errorCode?: string,
  ) {
    super(responseCode ? `${category} (${responseCode})` : category);
    this.name = "EmailSendError";
    this.failureCode = FAILURE_CODES[category];
  }
}

function failureCategory(errorCode: string | undefined, responseCode: number | undefined): EmailFailureCategory {
  if (responseCode !== undefined && RECIPIENT_REJECTED_CODES.has(responseCode)) return "RECIPIENT_REJECTED";
  if (errorCode === "EAUTH" || (responseCode !== undefined && AUTH_FAILED_CODES.has(responseCode))) return "AUTH_FAILED";
  if (responseCode !== undefined && responseCode >= 400 && responseCode < 500) return "TEMPORARY";
  if (errorCode !== undefined && CONNECTION_ERROR_CODES.has(errorCode)) return "CONNECTION";
  if ((responseCode !== undefined && responseCode >= 500) || (errorCode !== undefined && MESSAGE_ERROR_CODES.has(errorCode))) return "MESSAGE_REJECTED";
  return "UNKNOWN";
}

const FAILURE_CODES: Record<EmailFailureCategory, NotificationFailureCode> = {
  RECIPIENT_REJECTED: "SMTP_RECIPIENT_REJECTED",
  AUTH_FAILED: "SMTP_AUTHENTICATION_FAILED",
  TEMPORARY: "SMTP_TEMPORARY_FAILURE",
  CONNECTION: "SMTP_CONNECTION_FAILURE",
  MESSAGE_REJECTED: "SMTP_DELIVERY_FAILURE",
  UNKNOWN: "UNKNOWN",
  INTERNAL: "INTERNAL",
};

/** Unique classifier. SMTP origin is explicit at the transport boundary; arbitrary internal errors
 * never inherit SMTP codes, and raw messages are never inspected or retained. */
export function classifyNotificationFailure(error: unknown, source: "smtp" | "internal" = "internal"): EmailSendError {
  if (error instanceof EmailSendError) return error;
  if (source === "internal") return new EmailSendError(error instanceof Error ? "INTERNAL" : "UNKNOWN");
  const { code, responseCode } = (typeof error === "object" && error !== null ? error : {}) as { code?: unknown; responseCode?: unknown };
  const normalizedCode = typeof code === "string" ? code.toUpperCase() : "";
  const errorCode = ERROR_CODE_SHAPE.test(normalizedCode) ? normalizedCode : undefined;
  const reply = typeof responseCode === "number" && Number.isInteger(responseCode) && responseCode >= 200 && responseCode <= 599 ? responseCode : undefined;
  return new EmailSendError(failureCategory(errorCode, reply), reply, errorCode);
}
