import type { Metadata } from "next";
import { requireUser } from "@/server/auth/session";

export const metadata: Metadata = { title: "Mon compte", robots: { index: false } };

export default async function AccountPage() {
  const user = await requireUser("/compte");
  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <h1 className="text-2xl font-bold">Mon compte</h1>
      <dl className="mt-6 grid gap-3 rounded-xl border border-line bg-surface p-5 sm:grid-cols-[10rem_1fr]">
        <dt className="text-sm text-ink-muted">Nom</dt>
        <dd className="font-medium">{user.name}</dd>
        <dt className="text-sm text-ink-muted">E-mail</dt>
        <dd className="font-medium">{user.email}</dd>
      </dl>
      <p className="mt-6 text-sm text-ink-muted">
        Vos commandes, adresses et demandes de devis apparaîtront ici dès l&apos;ouverture de la boutique.
      </p>
    </main>
  );
}
