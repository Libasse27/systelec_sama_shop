import "server-only";
import { randomUUID } from "node:crypto";
import type { Prisma, PrismaClient, ReturnStatus, ReturnVerificationKind } from "@/generated/prisma/client";
import { CUSTOMER_RETURN_REASON_LABELS } from "@/lib/labels";
import type { Db } from "@/server/db/client";
import { isUniqueViolation } from "@/server/db/errors";
import { AppError } from "@/server/errors";
import { lockOrderRow } from "@/server/modules/orders/lock";
import { guestLinkAllows } from "@/server/modules/orders/queries";
import { dispatchNotifications } from "@/server/notifications/queue";
import { checkReturnPhotos, discardReturnPhotos, RETURN_PHOTO_LIMITS, storeReturnPhotos } from "@/server/storage/return-photos";
import type { FileStorage } from "@/server/storage/storage";
import { parseInput } from "@/server/validation";
import { customerConcernedBy, OPEN_RETURN_STATUSES } from "./policy";
import { customerAnswerSchema, customerReturnSchema } from "./schemas";
import { insertReturn, recordCustomerAnswer, type RecordedReturn, type StoredPhoto } from "./service";

/**
 * Retours déclarés par le client lui-même (phase 10, décision 2), depuis « Mon compte » ou son lien de
 * suivi personnel (jeton signé de la commande). Sécurité :
 * - seule une commande du client (compte) ou de ce lien (invité) est accessible ; sinon « introuvable »,
 *   sans rien révéler ;
 * - photos contrôlées (format réel, taille, nombre), stockées en privé ;
 * - envois limités par connexion et par commande ;
 * - une déclaration ne déclenche jamais de remboursement : un responsable examine et décide.
 */

/** Accès du client : son compte, ou le jeton du lien de suivi d'une commande invitée. */
export type CustomerAccess = { userId: string } | { userId: null; token: string | undefined };

export interface CustomerContext {
  access: CustomerAccess;
  ip?: string;
}

/** Limites anti-abus des envois du client (déclarations et réponses). */
export const CUSTOMER_RETURN_LIMITS = {
  perIpPerHour: 10,
  /** Connexion sans adresse IP fiable (pas de proxy de confiance) : une enveloppe commune, jamais aucune limite. */
  unknownIpPerHour: 60,
  /** Demandes déclarées par le client encore à l'examen, par commande. */
  openPerOrder: 2,
} as const;

const CUSTOMER_ACTIONS = ["return.customer_declare", "return.customer_answer"];

interface AccessibleOrder {
  id: string;
  number: string;
  status: string;
}

/** Commande accessible à ce client, ou null (même réponse qu'une commande inexistante). */
async function accessibleOrder(client: Db, access: CustomerAccess, number: string): Promise<AccessibleOrder | null> {
  if (access.userId !== null) {
    return client.order.findFirst({ where: { number, customer: { userId: access.userId } }, select: { id: true, number: true, status: true } });
  }
  const order = await client.order.findFirst({ where: { number, customer: { userId: null } }, select: { id: true, number: true, status: true, createdAt: true } });
  return order && guestLinkAllows(order, access.token) ? order : null;
}

async function requireOrder(client: Db, access: CustomerAccess, number: string): Promise<AccessibleOrder> {
  const order = await accessibleOrder(client, access, number);
  if (!order) throw new AppError("NOT_FOUND", "Commande introuvable.");
  return order;
}

/**
 * Quotas atomiques. Le comptage puis l'écriture (ligne d'audit, retour) se font dans UNE transaction,
 * après des verrous pris toujours dans le même ordre (aucun interblocage) :
 * 1. verrou consultatif de la connexion (pg_advisory_xact_lock, clé « IP » ou « IP inconnue ») : les
 *    envois simultanés d'une même connexion, sur une ou plusieurs commandes, passent l'un après l'autre ;
 * 2. verrou de la ligne de la commande (lockOrderRow) : idem pour les demandes d'une même commande.
 * En lecture validée (niveau par défaut), chaque comptage fait après l'obtention du verrou voit les
 * envois validés par la transaction précédente : la limite ne peut pas être dépassée. Les connexions
 * différentes ne s'attendent pas. Les vérifications faites avant la transaction ne servent qu'à
 * refuser tôt (sans lire les photos).
 */
async function lockConnectionQuota(tx: Prisma.TransactionClient, ip: string | undefined): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`returns-customer:${ip ?? "ip-inconnue"}`}))`;
}

async function assertWithinLimits(client: Db, ip: string | undefined): Promise<void> {
  const since = new Date(Date.now() - 60 * 60_000);
  const recent = await client.auditLog.count({ where: { action: { in: CUSTOMER_ACTIONS }, ip: ip ?? null, createdAt: { gte: since } } });
  if (recent >= (ip ? CUSTOMER_RETURN_LIMITS.perIpPerHour : CUSTOMER_RETURN_LIMITS.unknownIpPerHour)) {
    throw new AppError("RATE_LIMITED", "Trop d'envois depuis cette connexion. Réessayez plus tard ou contactez-nous.");
  }
}

/** Photos fournies telles quelles, ou lues seulement après les contrôles d'accès et de limites. */
export type PhotoSource = readonly Uint8Array[] | (() => Promise<Uint8Array[]>);

const loadPhotos = async (source: PhotoSource): Promise<readonly Uint8Array[]> => (typeof source === "function" ? source() : source);

async function assertOpenRequestsBelowLimit(client: Db, orderId: string): Promise<void> {
  const open = await client.return.count({ where: { orderId, declaredBy: "CUSTOMER", status: { in: [...OPEN_RETURN_STATUSES] } } });
  if (open >= CUSTOMER_RETURN_LIMITS.openPerOrder) {
    throw new AppError("RATE_LIMITED", "Des demandes de retour sont déjà en cours d'examen pour cette commande : nous revenons vers vous.");
  }
}

/**
 * Déclaration d'un retour par le client : commande remise (livrée ou retirée), articles et quantités,
 * motif, description, jusqu'à 3 photos. Même délai commercial de 48 h que le personnel (hors délai :
 * enregistré et signalé, jamais refusé). Idempotent (même clé : même retour, au même client).
 */
export async function declareCustomerReturn(
  client: PrismaClient,
  storage: FileStorage,
  context: CustomerContext,
  orderNumber: string,
  input: unknown,
  files: PhotoSource,
): Promise<RecordedReturn> {
  const order = await requireOrder(client, context.access, orderNumber);
  const { idempotencyKey, category, description, items } = parseInput(customerReturnSchema, input, "Demande de retour");
  const replay = await client.return.findUnique({ where: { idempotencyKey }, select: { id: true, number: true, orderId: true, declaredBy: true, lateDeclaration: true } });
  if (replay) {
    if (replay.orderId !== order.id || replay.declaredBy !== "CUSTOMER") throw new AppError("CONFLICT", "Cette demande a déjà été envoyée.");
    return { id: replay.id, number: replay.number, replayed: true, lateDeclaration: replay.lateDeclaration };
  }
  await assertWithinLimits(client, context.ip);
  await assertOpenRequestsBelowLimit(client, order.id);
  const photos = checkReturnPhotos(await loadPhotos(files));

  const returnId = randomUUID().replaceAll("-", "");
  const stored = await storeReturnPhotos(storage, returnId, photos);
  try {
    const created = await client.$transaction(async (tx) => {
      await lockConnectionQuota(tx, context.ip);
      await assertWithinLimits(tx, context.ip);
      await lockOrderRow(tx, order.id);
      // Revérifié sous verrou : deux déclarations simultanées ne dépassent pas la limite.
      await assertOpenRequestsBelowLimit(tx, order.id);
      return insertReturn(tx, {
        id: returnId,
        orderId: order.id,
        idempotencyKey,
        reason: `${CUSTOMER_RETURN_REASON_LABELS[category]} : ${description}`,
        items,
        declarer: { kind: "customer", userId: context.access.userId, ip: context.ip },
        photos: stored,
      });
    });
    await dispatchNotifications(client, { returnId: created.id });
    return { ...created, replayed: false };
  } catch (error) {
    await discardReturnPhotos(storage, stored);
    if (isUniqueViolation(error)) throw new AppError("CONFLICT", "Cette demande a déjà été envoyée.");
    throw error;
  }
}

/** Réponse du client à une vérification qui l'attend (texte et jusqu'à 3 photos). */
export async function answerCustomerVerification(
  client: PrismaClient,
  storage: FileStorage,
  context: CustomerContext,
  orderNumber: string,
  returnNumber: string,
  input: unknown,
  files: PhotoSource,
): Promise<void> {
  const order = await requireOrder(client, context.access, orderNumber);
  const target = await client.return.findFirst({
    where: { number: returnNumber, orderId: order.id },
    select: { id: true, status: true, events: { where: { type: "VERIFICATION_REQUESTED" }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 1, select: { verificationKind: true } } },
  });
  if (!target) throw new AppError("NOT_FOUND", "Retour introuvable.");
  const { response } = parseInput(customerAnswerSchema, input, "Réponse");
  await assertWithinLimits(client, context.ip);
  // Contrôle rapide avant de lire et stocker les photos (revérifié sous verrou par recordCustomerAnswer).
  const kind = target.events[0]?.verificationKind;
  if (target.status !== "VERIFICATION" || !kind || !customerConcernedBy(kind)) {
    throw new AppError("CONFLICT", "Aucune information n'est attendue de votre part sur ce retour.");
  }
  const photos = checkReturnPhotos(await loadPhotos(files));
  const stored: StoredPhoto[] = await storeReturnPhotos(storage, target.id, photos);
  try {
    await client.$transaction(async (tx) => {
      await lockConnectionQuota(tx, context.ip);
      await assertWithinLimits(tx, context.ip);
      await lockOrderRow(tx, order.id);
      await recordCustomerAnswer(tx, target.id, { response, userId: context.access.userId, ip: context.ip, photos: stored, maxPhotosPerReturn: RETURN_PHOTO_LIMITS.perReturn });
    });
  } catch (error) {
    await discardReturnPhotos(storage, stored);
    throw error;
  }
}

export interface CustomerReturnLine {
  orderItemId: string;
  productName: string;
  variantName: string;
  /** Encore retournable (retours non refusés déduits). */
  remaining: number;
}

export interface CustomerReturnView {
  number: string;
  status: ReturnStatus;
  createdAt: Date;
  reason: string;
  lateDeclaration: boolean;
  declaredByCustomer: boolean;
  photos: number;
  items: { productName: string; variantName: string; quantity: number }[];
  /** Décision : motif communiqué seulement en cas de refus ; montant prévu en cas d'acceptation. */
  decision: { outcome: "ACCEPTED" | "REJECTED"; note: string | null; refundAmount: number } | null;
  refunded: boolean;
  /** Vérification qui attend une réponse du client (photos, facture, informations). */
  pendingRequest: { kind: ReturnVerificationKind; request: string } | null;
}

/**
 * Retours d'une commande vus par son client (compte ou lien de suivi) : statut, décision, information
 * attendue ; et ce qui peut encore être retourné. Aucune donnée interne (notes du personnel, auteurs).
 * null si la commande n'est pas accessible à ce client.
 */
export async function getCustomerReturns(
  client: Db,
  access: CustomerAccess,
  orderNumber: string,
): Promise<{ canDeclare: boolean; returnable: CustomerReturnLine[]; returns: CustomerReturnView[] } | null> {
  const order = await accessibleOrder(client, access, orderNumber);
  if (!order) return null;
  const [rows, items] = await Promise.all([
    client.return.findMany({
      where: { orderId: order.id },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: {
        number: true,
        status: true,
        createdAt: true,
        reason: true,
        lateDeclaration: true,
        declaredBy: true,
        decisionNote: true,
        refundAmount: true,
        decidedAt: true,
        refundedAt: true,
        _count: { select: { attachments: true } },
        items: { orderBy: { id: "asc" }, select: { quantity: true, orderItem: { select: { productName: true, variantName: true } } } },
        events: { where: { type: "VERIFICATION_REQUESTED" }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 1, select: { comment: true, verificationKind: true } },
      },
    }),
    client.orderItem.findMany({
      where: { orderId: order.id },
      orderBy: { id: "asc" },
      select: { id: true, productName: true, variantName: true, quantity: true, returnItems: { where: { return: { status: { not: "REJECTED" } } }, select: { quantity: true } } },
    }),
  ]);
  const returnable = items.map(({ id, quantity, returnItems, productName, variantName }) => ({
    orderItemId: id,
    productName,
    variantName,
    remaining: quantity - returnItems.reduce((sum, line) => sum + line.quantity, 0),
  }));
  return {
    canDeclare: order.status === "CLOSED" && returnable.some((line) => line.remaining > 0),
    returnable,
    returns: rows.map((row) => {
      const request = row.events[0];
      return {
        number: row.number,
        status: row.status,
        createdAt: row.createdAt,
        reason: row.reason,
        lateDeclaration: row.lateDeclaration,
        declaredByCustomer: row.declaredBy === "CUSTOMER",
        photos: row._count.attachments,
        items: row.items.map(({ quantity, orderItem }) => ({ quantity, ...orderItem })),
        decision: row.decidedAt
          ? { outcome: row.status === "REJECTED" ? "REJECTED" : "ACCEPTED", note: row.status === "REJECTED" ? row.decisionNote : null, refundAmount: row.refundAmount }
          : null,
        refunded: row.refundedAt !== null,
        pendingRequest:
          row.status === "VERIFICATION" && request?.verificationKind && customerConcernedBy(request.verificationKind)
            ? { kind: request.verificationKind, request: request.comment ?? "" }
            : null,
      };
    }),
  };
}
