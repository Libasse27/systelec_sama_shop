import { describe, expect, it } from "vitest";
import { addBusinessHours, isBusinessDay, isoWeekday, type BusinessHours } from "./business-hours";

/** Lundi à samedi, 8 h – 18 h (valeur par défaut). */
const DEFAULT: BusinessHours = { days: [1, 2, 3, 4, 5, 6], ranges: [{ start: "08:00", end: "18:00" }] };
/** Lundi à vendredi, 8 h – 13 h et 15 h – 18 h (pause de mi-journée). */
const SPLIT: BusinessHours = { days: [1, 2, 3, 4, 5], ranges: [{ start: "15:00", end: "18:00" }, { start: "08:00", end: "13:00" }] };

// Dakar = UTC+0 : les heures ci-dessous sont des heures locales.
const at = (iso: string) => new Date(`${iso}Z`);

describe("heures ouvrables (Dakar)", () => {
  it("jour ISO : lundi 1 … dimanche 7", () => {
    expect(isoWeekday(at("2026-10-19T10:00:00"))).toBe(1); // lundi
    expect(isoWeekday(at("2026-10-18T10:00:00"))).toBe(7); // dimanche
  });

  it("dans la journée : les heures s'ajoutent jusqu'à la fermeture puis reprennent le lendemain", () => {
    expect(addBusinessHours(at("2026-10-19T09:00:00"), 2, DEFAULT)).toEqual(at("2026-10-19T11:00:00"));
    // Lundi 9 h + 24 h ouvrables : 9 h lundi, 10 h mardi, reste 5 h mercredi → mercredi 13 h.
    expect(addBusinessHours(at("2026-10-19T09:00:00"), 24, DEFAULT)).toEqual(at("2026-10-21T13:00:00"));
  });

  it("soirée et nuit : le décompte commence à l'ouverture suivante", () => {
    // Mardi 20 h : rien avant mercredi 8 h ; 24 h → vendredi 12 h (10 + 10 + 4).
    expect(addBusinessHours(at("2026-10-20T20:00:00"), 24, DEFAULT)).toEqual(at("2026-10-23T12:00:00"));
    // Mercredi 6 h du matin : départ à 8 h.
    expect(addBusinessHours(at("2026-10-21T06:00:00"), 1, DEFAULT)).toEqual(at("2026-10-21T09:00:00"));
  });

  it("week-end : le dimanche n'est pas ouvré, le samedi l'est par défaut", () => {
    // Samedi 16 h : 2 h samedi, dimanche fermé, lundi 8 h + 22 h → lundi 10 h, mardi 10 h, mercredi 10 h.
    expect(addBusinessHours(at("2026-10-24T16:00:00"), 24, DEFAULT)).toEqual(at("2026-10-28T10:00:00"));
    // Déclaré un dimanche : rien ne court avant lundi 8 h.
    expect(addBusinessHours(at("2026-10-25T11:00:00"), 3, DEFAULT)).toEqual(at("2026-10-26T11:00:00"));
    // Sans le samedi : vendredi 17 h + 2 h → lundi 9 h.
    expect(addBusinessHours(at("2026-10-23T17:00:00"), 2, SPLIT)).toEqual(at("2026-10-26T09:00:00"));
  });

  it("plages multiples (pause de mi-journée), données dans le désordre", () => {
    // Lundi 12 h : 1 h jusqu'à 13 h, pause, reprise à 15 h → 2 h ouvrables à 16 h.
    expect(addBusinessHours(at("2026-10-19T12:00:00"), 2, SPLIT)).toEqual(at("2026-10-19T16:00:00"));
    // Pendant la pause : départ à 15 h.
    expect(addBusinessHours(at("2026-10-19T14:00:00"), 1, SPLIT)).toEqual(at("2026-10-19T16:00:00"));
    // 24 h ouvrables à 8 h par jour : 3 jours pleins.
    expect(addBusinessHours(at("2026-10-19T08:00:00"), 24, SPLIT)).toEqual(at("2026-10-21T18:00:00"));
  });

  it("une limite tombant exactement sur une fermeture reste dans la journée", () => {
    expect(addBusinessHours(at("2026-10-19T08:00:00"), 10, DEFAULT)).toEqual(at("2026-10-19T18:00:00"));
  });

  describe("jours fériés (calendrier administrable, phase 10)", () => {
    /** Lundi à vendredi, 9 h – 17 h (horaires paramétrables), mardi 20 et mercredi 21 fériés. */
    const WITH_HOLIDAYS: BusinessHours = { days: [1, 2, 3, 4, 5], ranges: [{ start: "09:00", end: "17:00" }], holidays: ["2026-10-20", "2026-10-21"] };

    it("un jour férié ouvrable n'est pas compté : le décompte saute au jour ouvré suivant", () => {
      // Lundi 16 h + 2 h : 1 h lundi, mardi et mercredi fériés, jeudi 9 h + 1 h → jeudi 10 h.
      expect(addBusinessHours(at("2026-10-19T16:00:00"), 2, WITH_HOLIDAYS)).toEqual(at("2026-10-22T10:00:00"));
    });

    it("demande reçue un jour férié : rien ne court avant l'ouverture du jour ouvré suivant", () => {
      expect(addBusinessHours(at("2026-10-20T10:00:00"), 1, WITH_HOLIDAYS)).toEqual(at("2026-10-22T10:00:00"));
    });

    it("vendredi 16 h + 24 heures ouvrables : ni samedi ni dimanche, puis lundi férié sauté", () => {
      const schedule: BusinessHours = { days: [1, 2, 3, 4, 5], ranges: [{ start: "09:00", end: "17:00" }], holidays: ["2026-10-26"] };
      // 1 h vendredi, week-end, lundi 26 férié, mardi 8 h, mercredi 8 h, jeudi 7 h → jeudi 16 h.
      expect(addBusinessHours(at("2026-10-23T16:00:00"), 24, schedule)).toEqual(at("2026-10-29T16:00:00"));
      // Sans jour férié : lundi 8 h, mardi 8 h, mercredi 7 h → mercredi 16 h.
      expect(addBusinessHours(at("2026-10-23T16:00:00"), 24, { ...schedule, holidays: [] })).toEqual(at("2026-10-28T16:00:00"));
    });

    it("un jour férié tombant un jour non ouvrable ne change rien ; changement de jour à minuit", () => {
      const sunday: BusinessHours = { ...WITH_HOLIDAYS, holidays: ["2026-10-25"] };
      expect(addBusinessHours(at("2026-10-23T16:00:00"), 2, sunday)).toEqual(at("2026-10-26T10:00:00"));
      // 23 h 59 la veille d'un férié : départ au jour ouvré suivant le férié.
      expect(addBusinessHours(at("2026-10-19T23:59:00"), 1, WITH_HOLIDAYS)).toEqual(at("2026-10-22T10:00:00"));
    });

    it("isBusinessDay : jour ouvrable et non férié", () => {
      expect(isBusinessDay(at("2026-10-19T12:00:00"), WITH_HOLIDAYS)).toBe(true);
      expect(isBusinessDay(at("2026-10-20T12:00:00"), WITH_HOLIDAYS)).toBe(false);
      expect(isBusinessDay(at("2026-10-24T12:00:00"), WITH_HOLIDAYS)).toBe(false);
    });
  });

  it("refuse un nombre d'heures invalide et un paramètre sans jour ouvrable", () => {
    expect(() => addBusinessHours(at("2026-10-19T08:00:00"), Number.NaN, DEFAULT)).toThrow();
    expect(() => addBusinessHours(at("2026-10-19T08:00:00"), 1, { days: [], ranges: DEFAULT.ranges })).toThrow(/aucune plage/);
  });
});
