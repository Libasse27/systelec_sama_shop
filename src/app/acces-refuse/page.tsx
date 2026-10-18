import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Accès refusé", robots: { index: false } };

export default function AccessDeniedPage() {
  return (
    <main className="mx-auto flex max-w-xl flex-col items-center gap-4 px-4 py-16 text-center">
      <p className="text-sm font-semibold text-brand-blue">Erreur 403</p>
      <h1 className="text-2xl font-bold">Accès refusé</h1>
      <p className="text-ink-muted">Votre compte ne dispose pas des autorisations nécessaires pour cette page.</p>
      <Link href="/" className="rounded-lg bg-brand-blue px-4 py-2 font-medium text-white hover:bg-brand-blue-dark">
        Retour à l&apos;accueil
      </Link>
    </main>
  );
}
