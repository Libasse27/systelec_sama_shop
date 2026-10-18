import { recordAudit } from "@/server/audit/audit";
import { getCurrentUser } from "@/server/auth/session";
import { db } from "@/server/db/client";
import { getStorage } from "@/server/storage/storage";

export const dynamic = "force-dynamic";

const notFound = () => new Response("Introuvable", { status: 404, headers: { "Cache-Control": "no-store" } });

/**
 * Photo jointe à un retour par le client (phase 10, décision 2) : donnée personnelle, servie seulement
 * au personnel qui consulte les retours (orders.read), jamais mise en cache partagé, consultation
 * journalisée. Tout autre cas : 404.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string; photoId: string }> }) {
  const { id, photoId } = await params;
  const user = await getCurrentUser();
  if (!user?.permissions.has("orders.read")) return notFound();
  const photo = await db.returnAttachment.findFirst({ where: { id: photoId, returnId: id }, select: { storageKey: true, contentType: true } });
  if (!photo) return notFound();
  const bytes = await getStorage().read(photo.storageKey);
  if (!bytes) return notFound();
  await recordAudit(db, { actorId: user.id, action: "return.photo.view", entityType: "ReturnAttachment", entityId: photoId, after: { returnId: id } });
  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": photo.contentType,
      "Cache-Control": "private, no-store",
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "X-Content-Type-Options": "nosniff",
      "X-Robots-Tag": "noindex",
    },
  });
}
