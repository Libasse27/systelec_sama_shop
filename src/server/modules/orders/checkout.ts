import "server-only";
import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import { businessYear } from "@/lib/dates";
import { recordAudit } from "@/server/audit/audit";
import { AppError } from "@/server/errors";
import { loadCategoryIndex } from "@/server/modules/catalog/queries";
import type { CartOwner } from "@/server/modules/cart/service";
import { lockStock, reserveStock } from "@/server/modules/inventory/reservations";
import { nextBusinessNumber } from "@/server/modules/sequences/service";
import { getSetting } from "@/server/modules/settings/service";
import { dispatchOrderNotifications, queueOrderNotifications } from "@/server/notifications/order-notifications";
import { parseInput } from "@/server/validation";
import { orderAccessToken } from "./access-token";
import { assertOrderAllowed } from "./limits";
import { paymentStatusFor } from "@/server/modules/payments/balance";
import { computeOrderTotals } from "./pricing";
import { checkoutSchema, type Contact } from "./schemas";

type Tx = Prisma.TransactionClient;

const CHECKOUT_TIMEOUT_MS = 20_000;
const HOUR_MS = 3600 * 1000;

export interface CheckoutContext {
  /** Compte connecté, ou null pour une commande invitée. */
  userId: string | null;
  cart: CartOwner;
  /** IP du client (limitation anti-abus), si elle est fiable. */
  ip?: string;
}

export interface PlacedOrder {
  id: string;
  number: string;
  /** Lien de suivi pour un invité (null pour un compte : l'historique suffit). */
  accessToken: string | null;
  /** Vrai si la commande existait déjà (double soumission). */
  replayed: boolean;
}

interface Fulfillment {
  method: "DELIVERY" | "PICKUP";
  deliveryZoneId: string | null;
  pickupPointId: string | null;
  delivery: { fee: number; freeAbove: number | null } | null;
}

async function resolveFulfillment(tx: Tx, input: ReturnType<typeof checkoutSchema.parse>["fulfillment"]): Promise<Fulfillment> {
  if (input.method === "DELIVERY") {
    const zone = await tx.deliveryZone.findFirst({ where: { id: input.deliveryZoneId, isActive: true }, select: { id: true, fee: true, freeAbove: true } });
    if (!zone) throw new AppError("CONFLICT", "Cette zone de livraison n'est plus disponible : choisissez-en une autre.");
    return { method: "DELIVERY", deliveryZoneId: zone.id, pickupPointId: null, delivery: { fee: zone.fee, freeAbove: zone.freeAbove } };
  }
  const point = await tx.pickupPoint.findFirst({ where: { id: input.pickupPointId, isActive: true }, select: { id: true } });
  if (!point) throw new AppError("CONFLICT", "Ce point de retrait n'est plus disponible : choisissez-en un autre.");
  return { method: "PICKUP", deliveryZoneId: null, pickupPointId: point.id, delivery: null };
}

/** Client de la commande : la fiche du compte (coordonnées mises à jour), ou une fiche invitée. */
async function resolveCustomer(tx: Tx, userId: string | null, contact: Contact): Promise<string> {
  const data = { name: contact.name, phone: contact.phone, email: contact.email };
  if (!userId) return (await tx.customer.create({ data, select: { id: true } })).id;
  return (await tx.customer.upsert({ where: { userId }, create: { ...data, userId }, update: data, select: { id: true } })).id;
}

const guestCartHash = (context: CheckoutContext): string | null => ("tokenHash" in context.cart ? context.cart.tokenHash : null);

/**
 * Commande déjà créée avec cette clé : renvoyée seulement au même demandeur (même compte, ou
 * pour un invité le navigateur qui détient le panier d'origine). Sinon, le lien de suivi d'un
 * autre client pourrait être obtenu avec sa seule clé.
 */
async function findReplay(client: PrismaClient | Tx, idempotencyKey: string, context: CheckoutContext): Promise<PlacedOrder | null> {
  const existing = await client.order.findUnique({
    where: { idempotencyKey },
    select: { id: true, number: true, guestCartHash: true, customer: { select: { userId: true } } },
  });
  if (!existing) return null;
  const sameOwner = context.userId
    ? existing.customer.userId === context.userId
    : existing.customer.userId === null && existing.guestCartHash !== null && existing.guestCartHash === guestCartHash(context);
  if (!sameOwner) throw new AppError("CONFLICT", "Cette commande a déjà été envoyée.");
  return { id: existing.id, number: existing.number, accessToken: context.userId ? null : orderAccessToken(existing.id), replayed: true };
}

const isUniqueViolation = (error: unknown) => error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";

/**
 * Passe la commande du panier, en une transaction :
 * - le total est recalculé sur les prix en base (jamais ceux du navigateur) ;
 * - le stock des lignes est verrouillé puis RÉSERVÉ (aucune survente possible) ;
 * - la clé d'idempotence (unique) empêche les doublons, même en cas de double clic simultané ;
 * - prix, noms et coordonnées sont figés ; le panier est vidé ; les notifications sont enregistrées.
 */
export async function placeOrder(client: PrismaClient, context: CheckoutContext, input: unknown): Promise<PlacedOrder> {
  const checkout = parseInput(checkoutSchema, input, "Commande");
  const commerce = await getSetting("commerce", client);
  if (!context.userId && !commerce.guestCheckoutEnabled) {
    throw new AppError("UNAUTHENTICATED", "Connectez-vous ou créez un compte pour commander.");
  }
  const replay = await findReplay(client, checkout.idempotencyKey, context);
  if (replay) return replay;
  await assertOrderAllowed(client, context.ip, checkout.contact.phone);

  let placed: { id: string; number: string } | { replayOf: true };
  try {
    placed = await client.$transaction((tx) => createOrder(tx, context, checkout, commerce.stockReservationHours), {
      timeout: CHECKOUT_TIMEOUT_MS,
    });
  } catch (error) {
    // Deux soumissions simultanées : la seconde bute sur la clé unique et rejoue la première.
    if (isUniqueViolation(error)) {
      const concurrent = await findReplay(client, checkout.idempotencyKey, context);
      if (concurrent) return concurrent;
    }
    throw error;
  }
  if ("replayOf" in placed) {
    const concurrent = await findReplay(client, checkout.idempotencyKey, context);
    if (concurrent) return concurrent;
    throw new AppError("CONFLICT", "Votre panier est vide.");
  }
  await dispatchOrderNotifications(client, placed.id);
  return { ...placed, accessToken: context.userId ? null : orderAccessToken(placed.id), replayed: false };
}

async function createOrder(
  tx: Tx,
  context: CheckoutContext,
  checkout: ReturnType<typeof checkoutSchema.parse>,
  reservationHours: number,
): Promise<{ id: string; number: string } | { replayOf: true }> {
  // Verrou sur le panier AVANT de lire ses articles : deux soumissions du même panier (deux
  // onglets, deux clés) s'exécutent l'une après l'autre ; la seconde trouve le panier vidé.
  const owner = "userId" in context.cart ? Prisma.sql`"userId" = ${context.cart.userId}` : Prisma.sql`"tokenHash" = ${context.cart.tokenHash}`;
  const [locked] = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM carts WHERE ${owner} FOR UPDATE`;
  // Même clé soumise en parallèle : la première a abouti pendant l'attente du verrou.
  if (await tx.order.findUnique({ where: { idempotencyKey: checkout.idempotencyKey }, select: { id: true } })) return { replayOf: true };
  const cart = locked
    ? await tx.cart.findUnique({ where: { id: locked.id }, select: { id: true, expiresAt: true, items: { select: { variantId: true, quantity: true } } } })
    : null;
  if (!cart || cart.expiresAt < new Date() || cart.items.length === 0) {
    throw new AppError("CONFLICT", "Votre panier est vide.");
  }
  const fulfillment = await resolveFulfillment(tx, checkout.fulfillment);
  const levels = await lockStock(tx, cart.items.map((item) => item.variantId));

  const variants = await tx.productVariant.findMany({
    where: { id: { in: cart.items.map((item) => item.variantId) } },
    select: {
      id: true,
      sku: true,
      name: true,
      price: true,
      costPrice: true,
      isActive: true,
      product: { select: { name: true, status: true, categoryId: true } },
    },
  });
  const byId = new Map(variants.map((variant) => [variant.id, variant]));
  const index = await loadCategoryIndex(tx);
  const problems: string[] = [];
  const lines = cart.items.map((item) => {
    const variant = byId.get(item.variantId);
    const level = levels.get(item.variantId);
    if (!variant || !variant.isActive || variant.product.status !== "PUBLISHED" || !index.byId.has(variant.product.categoryId)) {
      problems.push(`${variant?.product.name ?? "Un article"} n'est plus disponible à la vente.`);
      return null;
    }
    const available = (level?.onHand ?? 0) - (level?.reserved ?? 0);
    if (item.quantity > available) {
      problems.push(`${variant.product.name} : ${Math.max(0, available)} unité(s) disponible(s) pour ${item.quantity} demandée(s).`);
      return null;
    }
    return { item, variant };
  });
  if (problems.length > 0) throw new AppError("CONFLICT", `Votre panier doit être ajusté. ${problems.join(" ")}`);
  const valid = lines.filter((line) => line !== null);

  const totals = computeOrderTotals(
    valid.map(({ item, variant }) => ({ unitPrice: variant.price, quantity: item.quantity })),
    fulfillment.delivery,
  );
  if (checkout.expectedSubtotal !== undefined && checkout.expectedSubtotal !== totals.subtotal) {
    throw new AppError("CONFLICT", "Les prix de votre panier ont changé. Vérifiez le nouveau total avant de confirmer.");
  }

  const customerId = await resolveCustomer(tx, context.userId, checkout.contact);
  const number = await nextBusinessNumber(tx, "order", businessYear());
  const address = checkout.fulfillment.method === "DELIVERY" ? checkout.fulfillment.address : null;
  const order = await tx.order.create({
    data: {
      number,
      customerId,
      idempotencyKey: checkout.idempotencyKey,
      guestCartHash: guestCartHash(context),
      fulfillmentMethod: fulfillment.method,
      contact: checkout.contact,
      shippingAddress: address ?? Prisma.DbNull,
      deliveryZoneId: fulfillment.deliveryZoneId,
      pickupPointId: fulfillment.pickupPointId,
      ...totals,
      // Commande à 0 FCFA : rien à encaisser, elle est soldée dès sa création.
      paymentStatus: paymentStatusFor(totals.total, 0),
      notes: checkout.notes,
      reservedUntil: new Date(Date.now() + reservationHours * HOUR_MS),
      items: {
        create: valid.map(({ item, variant }) => ({
          variantId: variant.id,
          productName: variant.product.name,
          variantName: variant.name,
          sku: variant.sku,
          unitPrice: variant.price,
          quantity: item.quantity,
          lineTotal: variant.price * item.quantity,
          unitCost: variant.costPrice,
        })),
      },
      history: { create: { to: "PENDING_CONFIRMATION", actorId: context.userId, comment: "Commande passée en ligne" } },
    },
    select: { id: true, number: true },
  });

  for (const { item } of valid) {
    await reserveStock(tx, levels, {
      variantId: item.variantId,
      quantity: item.quantity,
      orderId: order.id,
      reason: `Réservation commande ${number}`,
      actorId: context.userId,
    });
  }
  await tx.cartItem.deleteMany({ where: { cartId: cart.id } });

  const message = { number, customerName: checkout.contact.name, total: totals.total, fulfillment: fulfillment.method };
  await queueOrderNotifications(tx, order.id, "order.placed", message, { email: checkout.contact.email, phone: checkout.contact.phone });
  const company = await getSetting("company", tx);
  await queueOrderNotifications(tx, order.id, "order.new_staff", message, { email: company.email, phone: null });
  await recordAudit(tx, {
    actorId: context.userId,
    action: "order.create",
    entityType: "Order",
    entityId: order.id,
    ip: context.ip,
    after: { number, total: totals.total, items: valid.length, method: fulfillment.method },
  });
  return order;
}
