"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getServerEnv } from "@/lib/env";
import { safeRedirectPath } from "@/lib/redirect";
import { getAuth } from "@/server/auth/auth";
import { clientIp } from "@/server/auth/client-ip";
import {
  requestPasswordReset,
  resetPassword,
  signIn,
  signOut,
  signUpCustomer,
  type RequestContext,
} from "@/server/auth/service";
import { AppError, ValidationError } from "@/server/errors";
import { logger } from "@/server/logger";
import { mergeCartAfterSignIn } from "@/server/modules/cart/session";

export interface FormState {
  error?: string;
  fieldErrors?: Record<string, string[] | undefined>;
  done?: boolean;
}

async function requestContext(): Promise<RequestContext> {
  const requestHeaders = await headers();
  return { headers: requestHeaders, ip: clientIp(requestHeaders, getServerEnv().TRUSTED_PROXY_HOPS) };
}

function toFormState(error: unknown): FormState {
  if (error instanceof ValidationError) {
    const details = error.details as { fieldErrors?: Record<string, string[]> } | undefined;
    return { error: "Vérifiez les champs signalés.", fieldErrors: details?.fieldErrors };
  }
  if (error instanceof AppError) return { error: error.message };
  logger.error("Erreur inattendue dans une action d'authentification", {
    error: error instanceof Error ? error.message : "inconnue",
  });
  return { error: "Une erreur est survenue. Réessayez dans un instant." };
}

const fields = (formData: FormData, names: string[]) =>
  Object.fromEntries(names.map((name) => [name, formData.get(name) ?? undefined]));

export async function signUpAction(_state: FormState, formData: FormData): Promise<FormState> {
  try {
    const { userId } = await signUpCustomer(getAuth(), fields(formData, ["name", "email", "phone", "password"]), await requestContext());
    await mergeCartAfterSignIn(userId);
  } catch (error) {
    return toFormState(error);
  }
  redirect("/compte");
}

export async function signInAction(_state: FormState, formData: FormData): Promise<FormState> {
  let destination: string;
  try {
    const { kind, userId } = await signIn(getAuth(), fields(formData, ["email", "password"]), await requestContext());
    await mergeCartAfterSignIn(userId);
    destination = safeRedirectPath(formData.get("suivant"), kind === "STAFF" ? "/admin" : "/compte");
  } catch (error) {
    return toFormState(error);
  }
  redirect(destination);
}

export async function signOutAction(): Promise<void> {
  await signOut(getAuth(), await requestContext());
  redirect("/");
}

export async function requestPasswordResetAction(_state: FormState, formData: FormData): Promise<FormState> {
  try {
    await requestPasswordReset(getAuth(), fields(formData, ["email"]), await requestContext());
  } catch (error) {
    return toFormState(error);
  }
  return { done: true };
}

export async function resetPasswordAction(_state: FormState, formData: FormData): Promise<FormState> {
  try {
    await resetPassword(getAuth(), fields(formData, ["token", "password"]), await requestContext());
  } catch (error) {
    return toFormState(error);
  }
  redirect("/connexion?reinitialise=1");
}
