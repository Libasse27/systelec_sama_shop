import type { Metadata, Viewport } from "next";
import { AnnouncementBar } from "@/components/layout/announcement-bar";
import { SiteFooter } from "@/components/layout/site-footer";
import { SiteHeader } from "@/components/layout/site-header";
import { BRAND } from "@/lib/brand";
import { getServerEnv } from "@/lib/env";
import { ACCEPTED_PAYMENT_METHODS } from "@/lib/payment-methods";
import "./globals.css";

export function generateMetadata(): Metadata {
  return {
    // Base des URL canoniques et Open Graph relatives.
    metadataBase: new URL(getServerEnv().APP_URL),
    title: {
      default: `${BRAND.shop.name}, la boutique de ${BRAND.group.name}`,
      template: `%s | ${BRAND.shop.name}`,
    },
    description: `${BRAND.shop.tagline} Équipements informatiques, réseaux, électronique, électricité et sécurité, et services techniques au Sénégal. Paiement ${ACCEPTED_PAYMENT_METHODS}.`,
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
    <html lang="fr" className="scroll-pt-36 lg:scroll-pt-24">
      <body className="flex min-h-dvh flex-col antialiased">
        <a href="#contenu" className="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-white focus:px-3 focus:py-2">
          Aller au contenu
        </a>
        <AnnouncementBar />
        <SiteHeader />
        <div id="contenu" className="flex-1">
          {children}
        </div>
        <SiteFooter />
      </body>
    </html>
  );
}
