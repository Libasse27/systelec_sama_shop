import { describe, expect, it } from "vitest";
import { clientIp, ipNetwork } from "./client-ip";

const withForwardedFor = (value: string) => new Headers({ "x-forwarded-for": value });

describe("clientIp", () => {
  it("prend l'entrée ajoutée par le proxy de confiance (la dernière), pas celle du client", () => {
    expect(clientIp(withForwardedFor("1.2.3.4, 203.0.113.7"), 1)).toBe("203.0.113.7");
    expect(clientIp(withForwardedFor("1.2.3.4, 203.0.113.7, 10.0.0.2"), 2)).toBe("203.0.113.7");
  });

  it("ignore l'en-tête sans proxy de confiance", () => {
    expect(clientIp(withForwardedFor("203.0.113.7"), 0)).toBeUndefined();
  });

  it("rejette une valeur qui n'est pas une adresse IP", () => {
    expect(clientIp(withForwardedFor("pas-une-ip"), 1)).toBeUndefined();
    expect(clientIp(withForwardedFor("x".repeat(500)), 1)).toBeUndefined();
    expect(clientIp(new Headers(), 1)).toBeUndefined();
  });

  it("accepte l'IPv6", () => {
    expect(clientIp(withForwardedFor("2001:db8::1"), 1)).toBe("2001:db8::1");
  });
});

describe("réseau d'une adresse (journaux techniques)", () => {
  it("tronque l'IPv4 à son /24", () => {
    expect(ipNetwork("203.0.113.7")).toBe("203.0.113.0/24");
    expect(ipNetwork("::ffff:198.51.100.23")).toBe("198.51.100.0/24");
  });

  it("tronque l'IPv6 à son /48, forme compressée comprise", () => {
    expect(ipNetwork("2001:db8:abcd:12::1")).toBe("2001:db8:abcd::/48");
    expect(ipNetwork("2001:db8::1")).toBe("2001:db8:0::/48");
    expect(ipNetwork("::1")).toBe("0:0:0::/48");
  });

  it("ne renvoie rien pour une valeur absente ou invalide", () => {
    expect(ipNetwork(undefined)).toBeUndefined();
    expect(ipNetwork("pas-une-ip")).toBeUndefined();
  });
});
