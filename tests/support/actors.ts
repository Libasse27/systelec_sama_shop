import { randomUUID } from "node:crypto";
import { loadAccess, type Actor } from "@/server/authz/service";
import { db } from "@/server/db/client";

/** Membre du personnel portant un seul rôle (les rôles doivent être synchronisés). */
export async function actorWith(role: string): Promise<Actor> {
  const id = randomUUID();
  await db.user.create({
    data: { id, name: role, email: `${id}@test.sn`, kind: "STAFF", roles: { create: { role: { connect: { code: role } } } } },
  });
  return { id, ...(await loadAccess(db, id)) };
}
