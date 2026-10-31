import { describe, expect, it } from "vitest";
import { CONTACT_SUBJECT_LABELS } from "@/lib/labels";
import { CONTACT_TEMPLATES, renderContactMessage } from "./contact-templates";

const data = { number: "MSG-2026-000001", subject: CONTACT_SUBJECT_LABELS.GENERAL };

describe("textes des notifications de contact", () => {
  it.each(CONTACT_TEMPLATES)("%s cite le numéro et le sujet du message", (template) => {
    const { subject, text } = renderContactMessage(template, data);
    expect(`${subject} ${text}`).toContain(data.number);
    expect(text).toContain(data.subject);
  });

  it("l'accusé de réception s'ouvre sur une formule neutre", () => {
    expect(renderContactMessage("contact.received", data).text.startsWith("Bonjour,\n")).toBe(true);
  });

  it("l'alerte au personnel renvoie vers la rubrique Messages de l'administration", () => {
    expect(renderContactMessage("contact.new_staff", data).text).toMatch(/rubrique Messages/);
  });

  it.each(CONTACT_TEMPLATES)("%s : texte brut sans balise, adresse ni lien, quel que soit le sujet", (template) => {
    for (const label of Object.values(CONTACT_SUBJECT_LABELS)) {
      const { subject, text } = renderContactMessage(template, { ...data, subject: label });
      expect(`${subject}\n${text}`).not.toMatch(/[<>]|:\/\/|www\.|@|\b[a-z0-9-]+\.(?:com|sn|net|org|fr)\b/i);
    }
  });
});
