import type { Metadata, Viewport } from "next";
import { SiteFooter } from "@/components/layout/site-footer";
import { SiteHeader } from "@/components/layout/site-header";
import { BRAND } from "@/lib/brand";
import { getServerEnv } from "@/lib/env";
import "./globals.css";

export function generateMetadata(): Metadata {
  return {
    // Base des URL canoniques et Open Graph relatives.
    metadataBase: new URL(getServerEnv().APP_URL),
    title: {
      default: `${BRAND.shop.name}, la boutique de ${BRAND.group.name}`,
      template: `%s | ${BRAND.shop.name}`,
    },
    description: `${BRAND.shop.tagline} Équipements informatiques, réseaux, électronique, électricité et sécurité, et services techniques au Sénégal. Paiement en espèces uniquement.`,
    applicationName: BRAND.shop.name,
    openGraph: { siteName: BRAND.shop.name, locale: "fr_SN", type: "website" },
  };
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#0b1f3a",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="fr">
      <body className="flex min-h-dvh flex-col antialiased">
        <a href="#contenu" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-white focus:px-3 focus:py-2">
          Aller au contenu
        </a>
        <SiteHeader />
        <div id="contenu" className="flex-1">
          {children}
        </div>
        <SiteFooter />
      </body>
    </html>
  );
}
