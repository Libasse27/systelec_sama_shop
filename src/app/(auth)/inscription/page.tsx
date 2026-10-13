import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { SignUpForm } from "@/components/auth/auth-forms";
import { getCurrentUser } from "@/server/auth/session";

export const metadata: Metadata = { title: "Créer un compte", robots: { index: false } };

export default async function SignUpPage() {
  if (await getCurrentUser()) redirect("/compte");
  return (
    <>
      <h1 className="text-2xl font-bold">Créer un compte</h1>
      <p className="mt-2 text-sm text-ink-muted">Suivez vos commandes et vos demandes de devis.</p>
      <div className="mt-6">
        <SignUpForm />
      </div>
      <p className="mt-6 text-sm">
        Déjà inscrit ?{" "}
        <Link href="/connexion" className="font-medium text-brand-blue underline">
          Se connecter
        </Link>
      </p>
    </>
  );
}
