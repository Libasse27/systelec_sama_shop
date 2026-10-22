import { describe, expect, it } from "vitest";
import { availability, conditionLabel, notificationStatusLabel, safeNotificationErrorCode, servicePriceLabel } from "./labels";

const normalizeSpaces = (text: string) => text.replace(/[  ]/g, " ");

describe("libellés boutique", () => {
  it("traduit l'état du produit", () => {
    expect(conditionLabel("REFURBISHED")).toBe("Reconditionné");
  });

  it("affiche la disponibilité réelle", () => {
    expect(availability(0)).toEqual({ level: "out", label: "Épuisé" });
    expect(availability(-2).level).toBe("out");
    expect(availability(1).label).toBe("Plus qu'un exemplaire");
    expect(availability(3)).toEqual({ level: "low", label: "Plus que 3 en stock" });
    expect(availability(40)).toEqual({ level: "in-stock", label: "En stock" });
  });

  it("n'invente jamais de tarif pour une prestation sur devis", () => {
    expect(servicePriceLabel("QUOTE_ONLY", null)).toBe("Sur devis");
    expect(normalizeSpaces(servicePriceLabel("FIXED", 15_000))).toBe("15 000 FCFA");
    expect(normalizeSpaces(servicePriceLabel("INDICATIVE", 25_000))).toBe("À partir de 25 000 FCFA");
  });
});

describe("libellés des notifications (fiche commande)", () => {
  const base = { attempts: 1, nextAttemptAt: null, error: null };
  // 12:30 UTC = 12:30 à Dakar (UTC+0, sans heure d'été).
  const retryAt = new Date("2026-10-19T12:30:00Z");

  it("envoyée : au premier essai, ou en précisant l'essai qui a réussi", () => {
    expect(notificationStatusLabel({ ...base, status: "SENT" })).toBe("envoyée");
    expect(notificationStatusLabel({ ...base, status: "SENT", attempts: 3 })).toBe("envoyée au 3e essai");
  });

  it("en attente : premier envoi, ou renvoi après des essais déjà tentés", () => {
    expect(notificationStatusLabel({ ...base, status: "PENDING", attempts: 0 })).toBe("en attente");
    expect(notificationStatusLabel({ ...base, status: "PENDING", attempts: 2 })).toBe("en attente de renvoi (2 essai(s) déjà tenté(s))");
  });

  it("sans fournisseur configuré", () => {
    expect(notificationStatusLabel({ ...base, status: "SKIPPED_NO_PROVIDER", attempts: 0 })).toBe("non envoyée (aucun fournisseur)");
  });

  it("échec avec nouvelle tentative : compteur, date de Dakar et catégorie sûre", () => {
    const label = notificationStatusLabel({ status: "FAILED", attempts: 2, nextAttemptAt: retryAt, error: "SMTP_CONNECTION_FAILURE" });
    expect(normalizeSpaces(label)).toBe("échec après 2 essai(s), nouvel essai prévu le 19/10/2026 12:30 — incident de connexion au fournisseur");
  });

  it("échec définitif : catégorie contrôlée ; toute ancienne erreur libre est cachée", () => {
    expect(notificationStatusLabel({ status: "FAILED", attempts: 2, nextAttemptAt: null, error: "SMTP_RECIPIENT_REJECTED" })).toBe(
      "échec définitif après 2 essai(s) — adresse destinataire refusée",
    );
    expect(notificationStatusLabel({ status: "FAILED", attempts: 1, nextAttemptAt: null, error: null })).toBe("échec définitif après 1 essai(s)");
    expect(notificationStatusLabel({ status: "FAILED", attempts: 4, nextAttemptAt: null, error: "server replied secret=legacy" })).toBe("échec définitif après 4 essai(s)");
  });

  it("une valeur d'erreur inconnue n'est jamais recopiée dans l'interface", () => {
    const secret = "smtp-user:token-internal-host@example.test";
    expect(notificationStatusLabel({ status: "FAILED", attempts: 1, nextAttemptAt: null, error: secret })).not.toContain(secret);
    expect(safeNotificationErrorCode(secret)).toBeNull();
    expect(safeNotificationErrorCode("SMTP_TEMPORARY_FAILURE")).toBe("SMTP_TEMPORARY_FAILURE");
    for (const inheritedKey of ["toString", "constructor", "__proto__"]) {
      expect(safeNotificationErrorCode(inheritedKey)).toBeNull();
      expect(notificationStatusLabel({ status: "FAILED", attempts: 1, nextAttemptAt: null, error: inheritedKey })).toBe("échec définitif après 1 essai(s)");
    }
  });

  it("présente les codes internes et d'abandon sans exposer de diagnostic", () => {
    expect(notificationStatusLabel({ status: "FAILED", attempts: 2, nextAttemptAt: null, error: "INTERNAL" })).toBe(
      "échec définitif après 2 essai(s) — incident interne, diagnostic réservé aux techniciens",
    );
    expect(notificationStatusLabel({ status: "FAILED", attempts: 4, nextAttemptAt: null, error: "ABANDONED" })).toBe(
      "échec définitif après 4 essai(s) — envoi abandonné après épuisement des tentatives",
    );
  });

  it("statut inconnu : affiché tel quel", () => {
    expect(notificationStatusLabel({ ...base, status: "ARCHIVED" })).toBe("ARCHIVED");
  });
});
