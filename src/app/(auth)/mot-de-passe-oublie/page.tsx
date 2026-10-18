import type { Metadata } from "next";
import { ForgotPasswordForm } from "@/components/auth/auth-forms";

export const metadata: Metadata = { title: "Mot de passe oublié", robots: { index: false } };

export default function ForgotPasswordPage() {
  return (
    <>
      <h1 className="text-2xl font-bold">Mot de passe oublié</h1>
      <p className="mt-2 text-sm text-ink-muted">Indiquez l&apos;e-mail de votre compte.</p>
      <div className="mt-6">
        <ForgotPasswordForm />
      </div>
    </>
  );
}
