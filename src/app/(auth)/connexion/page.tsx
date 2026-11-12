import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { SignInForm } from "@/components/auth/auth-forms";
import { FormError } from "@/components/auth/form-parts";
import { SocialSignIn } from "@/components/auth/social-sign-in";
import { BRAND } from "@/lib/brand";
import { safeRedirectPath } from "@/lib/redirect";
import { getCurrentUser } from "@/server/auth/session";
import { socialErrorMessage } from "@/server/auth/social-errors";
import { activeSocialProviders } from "@/server/auth/active-providers";
import { SOCIAL_PROVIDER_IDS } from "@/server/auth/social-providers";

export const metadata: Metadata = { title: "Connexion", robots: { index: false } };

interface Props {
  // `error` : code posé par le retour d'une connexion sociale ; error_description n'est jamais lu.
  searchParams: Promise<{ suivant?: string; reinitialise?: string; error?: string | string[] }>;
}

export default async function SignInPage({ searchParams }: Props) {
  const { suivant, reinitialise, error } = await searchParams;
  const user = await getCurrentUser();
  if (user) redirect(safeRedirectPath(suivant, user.kind === "STAFF" ? "/admin" : "/compte"));
  const next = safeRedirectPath(suivant, "");
  const socialError = socialErrorMessage(error);

  return (
    <>
      <h1 className="text-2xl font-bold">Connexion</h1>
      <p className="mt-2 text-sm text-ink-muted">Accédez à votre compte {BRAND.shop.name}.</p>
      {reinitialise && (
        <p role="status" className="mt-4 rounded-lg bg-surface p-3 text-sm">
          Mot de passe modifié. Connectez-vous avec votre nouveau mot de passe.
        </p>
      )}
      {socialError && (
        <div className="mt-4">
          <FormError message={socialError} />
        </div>
      )}
      <div className="mt-6">
        <SignInForm next={next || undefined} />
      </div>
      <SocialSignIn providers={SOCIAL_PROVIDER_IDS} active={activeSocialProviders()} next={next || undefined} />
      <p className="mt-6 border-t border-line pt-6 text-sm">
        Pas encore de compte ?{" "}
        <Link href="/inscription" className="font-medium text-brand-blue underline">
          Créer un compte
        </Link>
      </p>
    </>
  );
}
