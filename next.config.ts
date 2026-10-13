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
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
