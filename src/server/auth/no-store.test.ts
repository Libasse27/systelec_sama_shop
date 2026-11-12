import { describe, expect, it } from "vitest";
import { withNoStore } from "./no-store";

describe("réponse sans mise en cache", () => {
  it("ajoute no-store en gardant statut, Location et tous les Set-Cookie, sans modifier l'original", () => {
    const original = new Response(null, { status: 302, headers: { Location: "http://localhost:3000/connexion/sociale" } });
    original.headers.append("Set-Cookie", "better-auth.session_token=a; Path=/; HttpOnly");
    original.headers.append("Set-Cookie", "better-auth.state=; Max-Age=0; Path=/");

    const response = withNoStore(original);

    expect(response.status).toBe(302);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("location")).toBe("http://localhost:3000/connexion/sociale");
    expect(response.headers.getSetCookie()).toEqual([
      "better-auth.session_token=a; Path=/; HttpOnly",
      "better-auth.state=; Max-Age=0; Path=/",
    ]);
    expect(original.headers.get("cache-control")).toBeNull();
  });

  it("remplace une directive de cache existante", () => {
    const response = withNoStore(new Response("x", { headers: { "Cache-Control": "public, max-age=60" } }));
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
});
