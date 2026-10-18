import Link from "next/link";

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-xl flex-col items-center justify-center gap-4 px-4 text-center">
      <p className="text-sm font-semibold text-brand-blue">Erreur 404</p>
      <h1 className="text-2xl font-bold">Page introuvable</h1>
      <p className="text-ink-muted">La page demandée n&apos;existe pas ou a été déplacée.</p>
      <Link href="/" className="rounded-lg bg-brand-blue px-4 py-2 font-medium text-white hover:bg-brand-blue-dark">
        Retour à l&apos;accueil
      </Link>
    </main>
  );
}
