import type { Metadata } from "next";
import Link from "next/link";
import { ResetPasswordForm } from "@/components/auth/auth-forms";

export const metadata: Metadata = { title: "Nouveau mot de passe", robots: { index: false } };

interface Props {
  searchParams: Promise<{ token?: string }>;
}

export default async function ResetPasswordPage({ searchParams }: Props) {
  const { token } = await searchParams;
  return (
    <>
      <h1 className="text-2xl font-bold">Nouveau mot de passe</h1>
      <div className="mt-6">
        {token ? (
          <ResetPasswordForm token={token} />
        ) : (
          <p className="text-sm">
            Lien incomplet.{" "}
            <Link href="/mot-de-passe-oublie" className="text-brand-blue underline">
              Faire une nouvelle demande
            </Link>
          </p>
        )}
      </div>
    </>
  );
}
