import { describe, expect, it } from "vitest";
import { listingHref, parseListingParams } from "./listing-params";

describe("paramètres de liste", () => {
  it("applique les valeurs par défaut", () => {
    expect(parseListingParams({})).toEqual({
      q: undefined,
      tri: "pertinence",
      page: 1,
      min: undefined,
      max: undefined,
      dispo: false,
      marque: undefined,
    });
  });

  it("ignore les valeurs invalides au lieu d'échouer", () => {
    const params = parseListingParams({ tri: "inconnu", page: "-3", min: "abc", marque: "<script>", q: "   " });
    expect(params).toMatchObject({ tri: "pertinence", page: 1, min: undefined, marque: undefined, q: undefined });
  });

  it("lit les filtres valides et remet les bornes de prix dans l'ordre", () => {
    const params = parseListingParams({
      q: " routeur ",
      tri: "prix-croissant",
      page: "2",
      min: "90000",
      max: "10000",
      dispo: "1",
      marque: "netdemo",
    });
    expect(params).toEqual({
      q: "routeur",
      tri: "prix-croissant",
      page: 2,
      min: 10_000,
      max: 90_000,
      dispo: true,
      marque: "netdemo",
    });
  });

  it("traite un champ de prix vide (formulaire soumis sans valeur) comme l'absence de borne", () => {
    const params = parseListingParams({ min: "", max: "", dispo: "1", marque: "" });
    expect(params).toMatchObject({ min: undefined, max: undefined, dispo: true, marque: undefined });
  });

  it("retire l'octet NUL de la recherche (refusé par PostgreSQL)", () => {
    expect(parseListingParams({ q: "rou\u0000teur" }).q).toBe("routeur");
    expect(parseListingParams({ q: "\u0000" }).q).toBeUndefined();
  });

  it("prend la première valeur d'un paramètre répété", () => {
    expect(parseListingParams({ page: ["3", "9"] }).page).toBe(3);
  });

  it("construit des liens de pagination et de tri stables", () => {
    const params = parseListingParams({ q: "câble", dispo: "1", page: "2" });
    expect(listingHref("/recherche", params, { page: 3 })).toBe("/recherche?q=c%C3%A2ble&dispo=1&page=3");
    expect(listingHref("/recherche", params, { tri: "prix-decroissant", page: 1 })).toBe(
      "/recherche?q=c%C3%A2ble&tri=prix-decroissant&dispo=1",
    );
    expect(listingHref("/categories/routeurs", parseListingParams({}), {})).toBe("/categories/routeurs");
  });
});
