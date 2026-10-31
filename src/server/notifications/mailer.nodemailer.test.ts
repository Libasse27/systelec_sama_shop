import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { passwordResetRequestSchema, signInSchema } from "@/server/auth/schemas";
import { contactMessageSchema } from "@/server/modules/contact/schemas";
import { contactSchema } from "@/server/modules/orders/schemas";

interface DeliveredMail {
  envelope: { from: string; to: string[] };
  message: string;
}

// Vrai nodemailer : seul le transport SMTP est remplacé par son jsonTransport (aucune connexion). La
// composition du message et l'analyse des adresses sont donc celles de la version installée.
const delivered = vi.hoisted(() => [] as DeliveredMail[]);
vi.mock("nodemailer", async (importOriginal) => {
  const { default: nodemailer } = await importOriginal<typeof import("nodemailer")>();
  const createTransport = () => {
    const transport = nodemailer.createTransport({ jsonTransport: true });
    return {
      sendMail: async (message: Parameters<typeof transport.sendMail>[0]) => {
        const info = await transport.sendMail(message);
        delivered.push(info as unknown as DeliveredMail);
        return info;
      },
    };
  };
  return { default: { ...nodemailer, createTransport } };
});

const BASE = { DATABASE_URL: "postgresql://user:pass@localhost:5432/db", AUTH_SECRET: "x".repeat(32) };
const SMTP = { SMTP_HOST: "smtp-relay.brevo.com", SMTP_PORT: "587", SMTP_USER: "compte", SMTP_PASSWORD: "cle-smtp-secrete-123", SMTP_FROM: "Boutique <contact@systelec.sn>" };

/** Module rechargé à chaque test : configuration et transport sont mis en cache au premier appel. */
async function loadMailer() {
  vi.resetModules();
  vi.unstubAllEnvs();
  for (const [key, value] of Object.entries({ ...BASE, ...SMTP })) vi.stubEnv(key, value);
  return import("./mailer");
}

/** Adresses de la classe d'attaque « analyseur d'adresses » : partie locale entre guillemets, liste, commentaire, encoded-word, en-tête injecté. */
const MALICIOUS_ADDRESSES = [
  '"a@evil.com" <victim@ok.com>',
  "x@ok.com,attacker@evil.com",
  '"x@evil.com"@ok.com',
  '"a>b"@ok.com',
  "a@ok.com;b@evil.com",
  "a@ok.com\r\nBcc: z@evil.com",
  "=?utf-8?q?x=40evil.com?=@ok.com",
  "Nom <a@ok.com>",
  "<a@ok.com>",
  "a@ok.com (c@evil.com)",
  "a@ok.com((x)evil.com)",
  '"a,b"@ok.com',
  "a b@ok.com",
  "user@[127.0.0.1]",
];

const contactMessage = (email: string) => ({
  idempotencyKey: randomUUID(),
  name: "Awa Diop",
  email,
  phone: "",
  subject: "GENERAL",
  reference: "",
  message: "Bonjour, avez-vous ce produit en stock ?",
  website: "",
});

/** Chaque schéma qui reçoit une adresse destinataire d'e-mail, réduit à son champ e-mail. */
const RECIPIENT_SCHEMAS = [
  { name: "formulaire de contact", parse: (email: string) => contactMessageSchema.safeParse(contactMessage(email)) },
  { name: "demande de réinitialisation", parse: (email: string) => passwordResetRequestSchema.safeParse({ email }) },
  { name: "connexion", parse: (email: string) => signInSchema.safeParse({ email, password: "x" }) },
  { name: "commande (contact client)", parse: (email: string) => contactSchema.safeParse({ name: "Awa Diop", phone: "77 123 45 67", email }) },
];

describe("envoi d'e-mails avec le vrai nodemailer (jsonTransport)", () => {
  beforeEach(() => {
    delivered.length = 0;
  });
  afterEach(() => vi.unstubAllEnvs());

  it("compose le message attendu : expéditeur configuré, un seul destinataire, texte brut accentué", async () => {
    const { sendEmail } = await loadMailer();
    const text = "Bonjour Awa,\nvotre commande est reçue : 15 000 FCFA.\n\nÀ bientôt, l'équipe.";

    await expect(sendEmail({ to: "awa.diop@example.sn", subject: "Commande CMD-2026-000001 reçue", text })).resolves.toEqual({ sent: true });

    expect(delivered).toHaveLength(1);
    const { envelope, message } = delivered[0]!;
    expect(envelope).toEqual({ from: "contact@systelec.sn", to: ["awa.diop@example.sn"] });
    const parsed = JSON.parse(message);
    expect(parsed).toMatchObject({
      from: { address: "contact@systelec.sn", name: "Boutique" },
      to: [{ address: "awa.diop@example.sn" }],
      subject: "Commande CMD-2026-000001 reçue",
      text,
    });
    expect(parsed.html).toBeUndefined();
  });

  it("une adresse validée par les schémas reste un seul destinataire pour nodemailer", async () => {
    const { sendEmail } = await loadMailer();
    const email = passwordResetRequestSchema.parse({ email: "  Awa+Commande@Example.SN " }).email;

    await sendEmail({ to: email, subject: "Réinitialisation", text: "Lien" });

    expect(delivered[0]?.envelope.to).toEqual(["awa+commande@example.sn"]);
  });

  describe("adresses piégées : refusées par la validation, avant tout envoi", () => {
    it.each(RECIPIENT_SCHEMAS)("$name : une adresse légitime est acceptée", ({ parse }) => {
      expect(parse("awa.diop@example.sn").success).toBe(true);
    });

    for (const { name, parse } of RECIPIENT_SCHEMAS) {
      it.each(MALICIOUS_ADDRESSES)(`${name} : %j refusée sur le champ e-mail`, (email) => {
        const result = parse(email);
        expect(result.success).toBe(false);
        expect(result.error?.issues.some((issue) => issue.path.at(-1) === "email")).toBe(true);
      });
    }
  });
});
