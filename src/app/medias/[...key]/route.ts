import { IMAGE_TYPES, type ImageExtension } from "@/server/storage/image-type";
import { getStorage, isValidStorageKey } from "@/server/storage/storage";

/** Images téléversées depuis l'administration. Noms aléatoires : mise en cache longue durée. */
export async function GET(_request: Request, { params }: { params: Promise<{ key: string[] }> }) {
  const key = (await params).key.join("/");
  if (!isValidStorageKey(key)) return new Response("Introuvable", { status: 404 });
  const bytes = await getStorage().read(key);
  if (!bytes) return new Response("Introuvable", { status: 404 });
  const extension = key.slice(key.lastIndexOf(".") + 1) as ImageExtension;
  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": IMAGE_TYPES[extension],
      "Cache-Control": "public, max-age=31536000, immutable",
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
