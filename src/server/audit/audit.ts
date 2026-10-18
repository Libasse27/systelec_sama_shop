import "server-only";
import type { AuditResult, Prisma } from "@/generated/prisma/client";
import type { Db } from "@/server/db/client";
import { redact } from "./redact";

export interface AuditEvent {
  actorId: string | null;
  action: string;
  entityType?: string;
  entityId?: string;
  before?: unknown;
  after?: unknown;
  result?: AuditResult;
  ip?: string;
  correlationId?: string;
}

function toJson(value: unknown): Prisma.InputJsonValue | undefined {
  if (value === undefined || value === null) return undefined;
  return redact(value) as Prisma.InputJsonValue;
}

/**
 * Enregistre un événement d'audit. Passer le client de transaction pour que
 * l'événement soit atomique avec l'action auditée.
 */
export async function recordAudit(client: Db, event: AuditEvent): Promise<void> {
  await client.auditLog.create({
    data: {
      actorId: event.actorId,
      action: event.action,
      entityType: event.entityType,
      entityId: event.entityId,
      before: toJson(event.before),
      after: toJson(event.after),
      result: event.result ?? "SUCCESS",
      ip: event.ip,
      correlationId: event.correlationId,
    },
  });
}
