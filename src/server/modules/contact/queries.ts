import "server-only";
import type { ContactMessageStatus, Prisma } from "@/generated/prisma/client";
import { assertPermission, type Actor } from "@/server/authz/service";
import type { Db } from "@/server/db/client";

export const ADMIN_MESSAGES_PAGE_SIZE = 30;

const LIST_SELECT = {
  id: true,
  number: true,
  status: true,
  subject: true,
  name: true,
  email: true,
  phone: true,
  createdAt: true,
} as const satisfies Prisma.ContactMessageSelect;

export type AdminContactMessageRow = Prisma.ContactMessageGetPayload<{ select: typeof LIST_SELECT }>;

/** Boîte des messages : nouveaux d'abord, puis les plus récents (permission messages.manage). */
export async function listContactMessages(
  client: Db,
  actor: Actor,
  options: { status?: ContactMessageStatus; q?: string; page?: number } = {},
): Promise<{ rows: AdminContactMessageRow[]; total: number; page: number; pageCount: number }> {
  await assertPermission(client, actor, "messages.manage");
  const q = options.q?.trim().slice(0, 100);
  const where: Prisma.ContactMessageWhereInput = {
    ...(options.status ? { status: options.status } : {}),
    ...(q
      ? {
          OR: [
            { number: { contains: q, mode: "insensitive" } },
            { name: { contains: q, mode: "insensitive" } },
            { email: { contains: q, mode: "insensitive" } },
            { phone: { contains: q } },
            { reference: { contains: q, mode: "insensitive" } },
          ],
        }
      : {}),
  };
  const total = await client.contactMessage.count({ where });
  const pageCount = Math.max(1, Math.ceil(total / ADMIN_MESSAGES_PAGE_SIZE));
  const page = Math.min(Math.max(1, Math.trunc(options.page ?? 1)), pageCount);
  const rows = await client.contactMessage.findMany({
    where,
    // NEW < IN_PROGRESS < CLOSED dans l'ordre de l'énumération : les nouveaux d'abord.
    orderBy: [{ status: "asc" }, { createdAt: "desc" }, { id: "desc" }],
    skip: (page - 1) * ADMIN_MESSAGES_PAGE_SIZE,
    take: ADMIN_MESSAGES_PAGE_SIZE,
    select: LIST_SELECT,
  });
  return { rows, total, page, pageCount };
}

export async function getContactMessage(client: Db, actor: Actor, id: string) {
  await assertPermission(client, actor, "messages.manage");
  return client.contactMessage.findUnique({
    where: { id },
    select: { ...LIST_SELECT, reference: true, message: true, internalNotes: true, closedAt: true, userId: true },
  });
}
