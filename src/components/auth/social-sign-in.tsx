"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { socialSignInAction, type FormState } from "@/app/(auth)/actions";
import { SOCIAL_PROVIDER_LABELS, type SocialProviderId } from "@/server/auth/social-providers";
import { ProviderIcon } from "./brand-icons";
import { FormError } from "./form-parts";

const initial: FormState = {};

const BUTTON_BASE =
  "flex min-h-11 w-full items-center justify-center gap-3 rounded-lg border border-line px-4 py-2.5 font-medium";

interface SocialSignInProps {
  /** Tous les fournisseurs proposés, dans l'ordre d'affichage. */
  providers: readonly SocialProviderId[];
  /** Fournisseurs actifs, calculés côté serveur (seule information transmise : actif ou non). */
  active: readonly SocialProviderId[];
  /** Destination interne après connexion, déjà validée par la page. */
  next?: string;
}

const providerLabel = (provider: SocialProviderId) => `Continuer avec ${SOCIAL_PROVIDER_LABELS[provider]}`;

function ProviderButton({ provider }: { provider: SocialProviderId }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      aria-busy={pending || undefined}
      className={`${BUTTON_BASE} bg-surface hover:bg-line/30 disabled:opacity-60`}
    >
      <ProviderIcon provider={provider} />
      <span>{providerLabel(provider)}</span>
    </button>
  );
}

/** Fournisseur non configuré : bouton visible mais inactif (aucun formulaire, aucune action serveur). */
function UnavailableProviderButton({ provider }: { provider: SocialProviderId }) {
  return (
    <button
      type="button"
      disabled
      aria-disabled="true"
      aria-label={`${providerLabel(provider)} (bientôt disponible)`}
      className={`${BUTTON_BASE} cursor-not-allowed bg-surface text-ink-muted`}
    >
      <span className="grayscale" aria-hidden="true">
        <ProviderIcon provider={provider} />
      </span>
      <span>{providerLabel(provider)}</span>
      <span className="text-xs font-normal">Bientôt disponible</span>
    </button>
  );
}

/**
 * Boutons « Continuer avec … » (clients uniquement), toujours affichés dans l'ordre fixe :
 * un formulaire par fournisseur actif, un bouton désactivé « Bientôt disponible » pour les autres.
 */
export function SocialSignIn({ providers, active, next }: SocialSignInProps) {
  const [state, action] = useActionState(socialSignInAction, initial);
  return (
    <section aria-labelledby="social-sign-in-title" className="mt-6 flex flex-col gap-3">
      <h2 id="social-sign-in-title" className="flex items-center gap-3 text-sm text-ink-muted">
        <span className="h-px flex-1 bg-line" aria-hidden="true" />
        Ou continuer avec
        <span className="h-px flex-1 bg-line" aria-hidden="true" />
      </h2>
      <FormError message={state.error} />
      {providers.map((provider) =>
        active.includes(provider) ? (
          <form key={provider} action={action}>
            <input type="hidden" name="provider" value={provider} />
            {next && <input type="hidden" name="suivant" value={next} />}
            <ProviderButton provider={provider} />
          </form>
        ) : (
          <UnavailableProviderButton key={provider} provider={provider} />
        ),
      )}
    </section>
  );
}
