import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { SignInForm } from "@/components/auth/auth-forms";
import { safeRedirectPath } from "@/lib/redirect";
import { getCurrentUser } from "@/server/auth/session";

export const metadata: Metadata = { title: "Connexion", robots: { index: false } };

interface Props {
  searchParams: Promise<{ suivant?: string; reinitialise?: string }>;
}

export default async function SignInPage({ searchParams }: Props) {
  const { suivant, reinitialise } = await searchParams;
  const user = await getCurrentUser();
  if (user) redirect(safeRedirectPath(suivant, user.kind === "STAFF" ? "/admin" : "/compte"));
  const next = safeRedirectPath(suivant, "");

  return (
    <>
      <h1 className="text-2xl font-bold">Connexion</h1>
      {reinitialise && (
        <p role="status" className="mt-4 rounded-lg bg-surface p-3 text-sm">
          Mot de passe modifié. Connectez-vous avec votre nouveau mot de passe.
        </p>
      )}
      <div className="mt-6">
        <SignInForm next={next || undefined} />
      </div>
      <p className="mt-6 text-sm">
        Pas encore de compte ?{" "}
        <Link href="/inscription" className="font-medium text-brand-blue underline">
          Créer un compte
        </Link>
      </p>
    </>
  );
}
