import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { SignUpForm } from "@/components/auth/auth-forms";
import { SocialSignIn } from "@/components/auth/social-sign-in";
import { BRAND } from "@/lib/brand";
import { getCurrentUser } from "@/server/auth/session";
import { activeSocialProviders } from "@/server/auth/active-providers";
import { SOCIAL_PROVIDER_IDS } from "@/server/auth/social-providers";

export const metadata: Metadata = { title: "Créer un compte", robots: { index: false } };

export default async function SignUpPage() {
  if (await getCurrentUser()) redirect("/compte");
  return (
    <>
      <h1 className="text-2xl font-bold">Créer un compte</h1>
      <p className="mt-2 text-sm text-ink-muted">
        Rejoignez {BRAND.shop.name} pour suivre vos commandes et vos demandes de devis.
      </p>
      <div className="mt-6">
        <SignUpForm />
      </div>
      <SocialSignIn providers={SOCIAL_PROVIDER_IDS} active={activeSocialProviders()} />
      <p className="mt-6 border-t border-line pt-6 text-sm">
        Déjà inscrit ?{" "}
        <Link href="/connexion" className="font-medium text-brand-blue underline">
          Se connecter
        </Link>
      </p>
    </>
  );
}
