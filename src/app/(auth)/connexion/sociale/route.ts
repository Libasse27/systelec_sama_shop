import { NextResponse, type NextRequest } from "next/server";
import { getServerEnv } from "@/lib/env";
import { safeRedirectPath } from "@/lib/redirect";
import { getCurrentUser } from "@/server/auth/session";
import { mergeCartAfterSignIn } from "@/server/modules/cart/session";

export const dynamic = "force-dynamic";

/**
 * Arrivée après un retour OAuth réussi (session ouverte par Better Auth) : le panier visiteur rejoint
 * celui du compte, puis redirection vers la destination interne demandée ou l'espace client.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const appUrl = getServerEnv().APP_URL;
  const user = await getCurrentUser();
  if (!user) return NextResponse.redirect(new URL("/connexion?error=session_missing", appUrl), 303);
  await mergeCartAfterSignIn(user.id);
  const destination = safeRedirectPath(request.nextUrl.searchParams.get("suivant"), "/compte");
  return NextResponse.redirect(new URL(destination, appUrl), 303);
}
