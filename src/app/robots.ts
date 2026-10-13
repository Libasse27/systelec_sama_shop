import type { MetadataRoute } from "next";
import { getServerEnv } from "@/lib/env";
import { absoluteUrl } from "@/server/storefront";

export const dynamic = "force-dynamic";

const PRIVATE_PATHS = [
  "/admin",
  "/compte",
  "/connexion",
  "/inscription",
  "/mot-de-passe-oublie",
  "/reinitialiser-mot-de-passe",
  "/acces-refuse",
  "/api/",
];

export default function robots(): MetadataRoute.Robots {
  // Hors production (préproduction, démo), rien n'est indexé.
  if (getServerEnv().APP_ENV !== "production") {
    return { rules: [{ userAgent: "*", disallow: "/" }] };
  }
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: PRIVATE_PATHS }],
    sitemap: absoluteUrl("/sitemap.xml"),
  };
}
