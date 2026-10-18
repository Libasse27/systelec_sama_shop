import "server-only";
import { getServerEnv } from "@/lib/env";
import { logger } from "@/server/logger";

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
}

export type EmailResult = { sent: true } | { sent: false; reason: "NOT_CONFIGURED" };

export function isEmailConfigured(): boolean {
  return getServerEnv().SMTP_HOST !== undefined;
}

/**
 * Point d'envoi unique des e-mails. Tant qu'aucun fournisseur SMTP n'est configuré
 * (décision D11), rien n'est envoyé ni simulé : l'échec est explicite et journalisé.
 */
export async function sendEmail(message: EmailMessage): Promise<EmailResult> {
  if (!isEmailConfigured()) {
    logger.warn("E-mail non envoyé : aucun fournisseur SMTP configuré", { subject: message.subject });
    return { sent: false, reason: "NOT_CONFIGURED" };
  }
  // L'adaptateur SMTP sera branché ici dès que le fournisseur sera choisi (D11).
  logger.error("Fournisseur SMTP configuré mais adaptateur non encore implémenté", { subject: message.subject });
  return { sent: false, reason: "NOT_CONFIGURED" };
}
