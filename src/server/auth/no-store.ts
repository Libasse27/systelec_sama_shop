/**
 * Copie d'une réponse avec Cache-Control: no-store (aucun intermédiaire ni navigateur ne garde la réponse
 * du retour OAuth). En-têtes copiés, jamais modifiés en place : Set-Cookie (multiples) et Location intacts.
 */
export function withNoStore(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set("Cache-Control", "no-store");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
