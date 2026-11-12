import { getAuth } from "@/server/auth/auth";
import { activeSocialProviders } from "@/server/auth/active-providers";
import { withNoStore } from "@/server/auth/no-store";
import { isAllowedOAuthCallback } from "@/server/auth/social-providers";

export const dynamic = "force-dynamic";

interface CallbackContext {
  params: Promise<{ provider: string }>;
}

/**
 * Seule route HTTP Better Auth exposée : le retour d'un fournisseur de connexion sociale ACTIF
 * (GET ; POST pour Apple uniquement, réponse en form_post). Tout le reste répond 404 : il n'existe pas
 * de route générique /api/auth/[...all]. Réponse jamais mise en cache (cookie de session, redirection).
 */
async function handle(request: Request, { params }: CallbackContext): Promise<Response> {
  const { provider } = await params;
  if (!isAllowedOAuthCallback(provider, request.method, activeSocialProviders())) {
    return new Response("Introuvable", { status: 404, headers: { "Cache-Control": "no-store" } });
  }
  return withNoStore(await getAuth().handler(request));
}

export const GET = handle;
export const POST = handle;
