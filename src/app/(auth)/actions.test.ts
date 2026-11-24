import { beforeEach, describe, expect, it, vi } from "vitest";

const { redirect, signUpCustomer, mergeCartAfterSignIn } = vi.hoisted(() => ({
  redirect: vi.fn(),
  signUpCustomer: vi.fn(),
  mergeCartAfterSignIn: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  redirect: (path: string) => {
    redirect(path);
    throw new Error(`redirect:${path}`);
  },
}));
vi.mock("next/headers", () => ({ headers: vi.fn(async () => new Headers()) }));
vi.mock("@/lib/env", () => ({ getServerEnv: () => ({ TRUSTED_PROXY_HOPS: 0 }) }));
vi.mock("@/server/auth/auth", () => ({ getAuth: () => ({}) }));
vi.mock("@/server/auth/service", () => ({
  requestPasswordReset: vi.fn(),
  resetPassword: vi.fn(),
  signIn: vi.fn(),
  signOut: vi.fn(),
  signUpCustomer,
}));
vi.mock("@/server/modules/cart/session", () => ({ mergeCartAfterSignIn }));
vi.mock("@/server/logger", () => ({ logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } }));

import { signUpAction } from "./actions";

const MISMATCH_MESSAGE = "Les mots de passe ne correspondent pas";
const valid = { name: "Awa Diop", email: "awa.diop@example.sn", phone: "+221 77 000 00 00", password: "motdepasse-solide" };

function formOf(values: Record<string, FormDataEntryValue>): FormData {
  const formData = new FormData();
  for (const [key, value] of Object.entries(values)) formData.set(key, value);
  return formData;
}

const aFile = () => new File(["x"], "mot-de-passe.txt", { type: "text/plain" });

describe("signUpAction : confirmation du mot de passe", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    signUpCustomer.mockResolvedValue({ userId: "user-1" });
    mergeCartAfterSignIn.mockResolvedValue(undefined);
  });

  it("refuse une confirmation différente sans appeler le service ni fusionner le panier", async () => {
    const state = await signUpAction({}, formOf({ ...valid, passwordConfirmation: "autre-mot-de-passe" }));

    expect(signUpCustomer).not.toHaveBeenCalled();
    expect(mergeCartAfterSignIn).not.toHaveBeenCalled();
    expect(redirect).not.toHaveBeenCalled();
    expect(state.fieldErrors?.passwordConfirmation).toEqual([MISMATCH_MESSAGE]);
  });

  it("refuse une confirmation vide sans appeler le service", async () => {
    const state = await signUpAction({}, formOf({ ...valid, passwordConfirmation: "" }));

    expect(signUpCustomer).not.toHaveBeenCalled();
    expect(mergeCartAfterSignIn).not.toHaveBeenCalled();
    expect(state.fieldErrors?.passwordConfirmation).toBeDefined();
  });

  it("refuse une confirmation absente sans appeler le service", async () => {
    const state = await signUpAction({}, formOf(valid));

    expect(signUpCustomer).not.toHaveBeenCalled();
    expect(mergeCartAfterSignIn).not.toHaveBeenCalled();
    expect(state.fieldErrors?.passwordConfirmation).toBeDefined();
  });

  it("refuse un fichier comme mot de passe, sans lever d'exception", async () => {
    const state = await signUpAction({}, formOf({ ...valid, password: aFile(), passwordConfirmation: valid.password }));

    expect(signUpCustomer).not.toHaveBeenCalled();
    expect(mergeCartAfterSignIn).not.toHaveBeenCalled();
    expect(state.error).toBeDefined();
  });

  it("refuse un fichier comme confirmation, sans lever d'exception", async () => {
    const state = await signUpAction({}, formOf({ ...valid, passwordConfirmation: aFile() }));

    expect(signUpCustomer).not.toHaveBeenCalled();
    expect(mergeCartAfterSignIn).not.toHaveBeenCalled();
    expect(state.error).toBeDefined();
  });

  it("transmet au service les seuls champs d'inscription quand la confirmation correspond", async () => {
    await expect(signUpAction({}, formOf({ ...valid, passwordConfirmation: valid.password }))).rejects.toThrow("redirect:/compte");

    expect(signUpCustomer).toHaveBeenCalledTimes(1);
    const input = signUpCustomer.mock.calls[0]?.[1];
    expect(input).toEqual(valid);
    expect(input).not.toHaveProperty("passwordConfirmation");
    expect(mergeCartAfterSignIn).toHaveBeenCalledWith("user-1");
  });
});
