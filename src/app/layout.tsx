import type { Metadata, Viewport } from "next";
import { SiteHeader } from "@/components/layout/site-header";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "SYSTELEC SAMA-SHOP",
    template: "%s | SYSTELEC SAMA-SHOP",
  },
  description:
    "Équipements informatiques, réseaux, électronique, électricité et sécurité, et services techniques au Sénégal. Paiement en espèces uniquement.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#0b1f3a",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="fr">
      <body className="min-h-dvh antialiased">
        <SiteHeader />
        {children}
      </body>
    </html>
  );
}
