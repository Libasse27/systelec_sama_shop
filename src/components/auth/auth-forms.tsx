"use client";

import Link from "next/link";
import { useActionState } from "react";
import {
  requestPasswordResetAction,
  resetPasswordAction,
  signInAction,
  signUpAction,
  type FormState,
} from "@/app/(auth)/actions";
import { Field, FormError, SubmitButton } from "./form-parts";

const initial: FormState = {};
const PASSWORD_HINT = "10 caractères minimum.";

export function SignInForm({ next }: { next?: string }) {
  const [state, action] = useActionState(signInAction, initial);
  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <FormError message={state.error} />
      {next && <input type="hidden" name="suivant" value={next} />}
      <Field name="email" label="E-mail" type="email" autoComplete="email" errors={state.fieldErrors?.email} />
      <Field
        name="password"
        label="Mot de passe"
        type="password"
        autoComplete="current-password"
        errors={state.fieldErrors?.password}
      />
      <SubmitButton>Se connecter</SubmitButton>
      <Link href="/mot-de-passe-oublie" className="text-sm text-brand-blue underline">
        Mot de passe oublié ?
      </Link>
    </form>
  );
}

export function SignUpForm() {
  const [state, action] = useActionState(signUpAction, initial);
  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <FormError message={state.error} />
      <Field name="name" label="Nom complet" autoComplete="name" errors={state.fieldErrors?.name} />
      <Field name="email" label="E-mail" type="email" autoComplete="email" errors={state.fieldErrors?.email} />
      <Field
        name="phone"
        label="Téléphone"
        type="tel"
        autoComplete="tel"
        required={false}
        hint="Pour vous joindre au sujet de vos commandes."
        errors={state.fieldErrors?.phone}
      />
      <Field
        name="password"
        label="Mot de passe"
        type="password"
        autoComplete="new-password"
        hint={PASSWORD_HINT}
        errors={state.fieldErrors?.password}
      />
      <SubmitButton>Créer mon compte</SubmitButton>
    </form>
  );
}

export function ForgotPasswordForm() {
  const [state, action] = useActionState(requestPasswordResetAction, initial);
  if (state.done) {
    return (
      <p role="status" className="rounded-lg bg-surface p-4 text-sm">
        Si un compte correspond à cette adresse, un lien de réinitialisation vous a été transmis. Sans nouvelles,
        contactez la boutique.
      </p>
    );
  }
  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <FormError message={state.error} />
      <Field name="email" label="E-mail" type="email" autoComplete="email" errors={state.fieldErrors?.email} />
      <SubmitButton>Recevoir un lien</SubmitButton>
    </form>
  );
}

export function ResetPasswordForm({ token }: { token: string }) {
  const [state, action] = useActionState(resetPasswordAction, initial);
  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <FormError message={state.error} />
      <input type="hidden" name="token" value={token} />
      <Field
        name="password"
        label="Nouveau mot de passe"
        type="password"
        autoComplete="new-password"
        hint={PASSWORD_HINT}
        errors={state.fieldErrors?.password}
      />
      <SubmitButton>Enregistrer</SubmitButton>
    </form>
  );
}
