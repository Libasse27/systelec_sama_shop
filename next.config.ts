import type { NextConfig } from "next";

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
  // Ignoré par les navigateurs en http (développement) ; actif derrière le TLS de production.
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  // La Content-Security-Policy (avec nonce par requête) est posée par src/proxy.ts.
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // Image Docker de production : serveur autonome (voir Dockerfile). Hors image (développement, E2E) :
  // sortie standard servie par « next start ».
  ...(process.env.NEXT_OUTPUT === "standalone" && { output: "standalone" as const }),
  // Tests E2E (e2e/run.ts) : build séparé, pour ne pas écraser celui du développement ou de la production locale.
  ...(process.env.NEXT_DIST_DIR === ".next-e2e" && { distDir: ".next-e2e" }),
  experimental: {
    // Téléversements : images de l'administration (5 Mo), imports CSV (2 Mo), photos d'un retour
    // envoyées par le client (3 × 2 Mo, plus les champs du formulaire).
    serverActions: { bodySizeLimit: "7mb" },
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
