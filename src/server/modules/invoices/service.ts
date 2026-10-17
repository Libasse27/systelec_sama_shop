import "server-only";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { businessYear } from "@/lib/dates";
import { includedVat } from "@/lib/money";
import { recordAudit } from "@/server/audit/audit";
import { assertAnyPermission, assertPermission, type Actor } from "@/server/authz/service";
import type { Db } from "@/server/db/client";
import { AppError } from "@/server/errors";
import { lockOrderRow } from "@/server/modules/orders/lock";
import type { Contact, ShippingAddress } from "@/server/modules/orders/schemas";
import { canViewDocument, companyHeader, ownershipOf, type CompanyHeader, type DocumentViewer } from "@/server/modules/payments/queries";
import { lockInterventionRow } from "@/server/modules/payments/targets";
import { nextBusinessNumber } from "@/server/modules/sequences/service";
import { getSetting } from "@/server/modules/settings/service";

type Tx = Prisma.TransactionClient;

export interface InvoiceLine {
  label: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
}

export interface InvoiceCustomer {
  name: string;
  phone: string;
  email: string | null;
  /** Lieu d'intervention, adresse de livraison ou point de retrait. */
  address: string;
}

async function createInvoice(
  tx: Tx,
  actor: Actor,
  target: { interventionId: string } | { orderId: string },
  lines: InvoiceLine[],
  customer: InvoiceCustomer,
  total: number,
): Promise<{ number: string }> {
  const number = await nextBusinessNumber(tx, "invoice", businessYear());
  const invoice = await tx.invoice.create({
    data: {
      number,
      ...target,
      lines: lines as unknown as Prisma.InputJsonValue,
      customer: customer as unknown as Prisma.InputJsonValue,
      total,
      issuedById: actor.id,
    },
    select: { id: true },
  });
  await recordAudit(tx, { actorId: actor.id, action: "invoice.issue", entityType: "Invoice", entityId: invoice.id, after: { number, ...target, total } });
  return { number };
}

/**
 * Émet la facture d'une intervention terminée (interventions.manage) : lignes du devis
 * accepté, ou une ligne unique au montant convenu. Lignes et client sont figés ; une seule
 * facture par intervention ; la facture n'est jamais modifiée (ajout seul en base).
 */
export async function issueInvoice(client: PrismaClient, actor: Actor, interventionId: string): Promise<{ number: string }> {
  await assertPermission(client, actor, "interventions.manage");
  return client.$transaction(async (tx) => {
    await lockInterventionRow(tx, interventionId);
    const intervention = await tx.intervention.findUniqueOrThrow({
      where: { id: interventionId },
      select: {
        number: true,
        status: true,
        amountDue: true,
        contact: true,
        address: true,
        invoice: { select: { number: true } },
        service: { select: { name: true } },
        quote: { select: { items: { orderBy: { position: "asc" }, select: { label: true, quantity: true, unitPrice: true, lineTotal: true } } } },
      },
    });
    if (intervention.invoice) throw new AppError("CONFLICT", `Facture déjà émise : ${intervention.invoice.number}.`);
    if (intervention.status !== "DONE") throw new AppError("CONFLICT", "La facture s'émet une fois l'intervention terminée.");
    const lines: InvoiceLine[] =
      intervention.quote && intervention.quote.items.length > 0
        ? intervention.quote.items
        : [{ label: intervention.service?.name ?? `Intervention ${intervention.number}`, quantity: 1, unitPrice: intervention.amountDue, lineTotal: intervention.amountDue }];
    const contact = intervention.contact as unknown as Contact;
    const customer: InvoiceCustomer = { name: contact.name, phone: contact.phone, email: contact.email, address: intervention.address };
    return createInvoice(tx, actor, { interventionId }, lines, customer, intervention.amountDue);
  });
}

const addressOf = (shipping: ShippingAddress | null, pickup: { name: string; address: string } | null): string => {
  if (shipping) return `Livraison : ${[shipping.line1, shipping.district, shipping.city].join(", ")}${shipping.landmark ? ` (${shipping.landmark})` : ""}`;
  return pickup ? `Retrait : ${pickup.name}, ${pickup.address}` : "";
};

/**
 * Émet la facture d'une commande soldée (orders.update ou payments.correct) : articles aux prix
 * figés, frais de livraison et remise. Unique, figée, en ajout seul ; la base refuse aussi une
 * commande annulée ou non soldée. Un retour ultérieur ne la modifie pas (avoir : phase 10).
 */
export async function issueOrderInvoice(client: PrismaClient, actor: Actor, orderId: string): Promise<{ number: string }> {
  await assertAnyPermission(client, actor, ["orders.update", "payments.correct"]);
  return client.$transaction(async (tx) => {
    await lockOrderRow(tx, orderId);
    const order = await tx.order.findUniqueOrThrow({
      where: { id: orderId },
      select: {
        status: true,
        total: true,
        amountPaid: true,
        refundedAmount: true,
        deliveryFee: true,
        discountTotal: true,
        contact: true,
        shippingAddress: true,
        pickupPoint: { select: { name: true, address: true } },
        invoice: { select: { number: true } },
        items: { orderBy: { id: "asc" }, select: { productName: true, variantName: true, quantity: true, unitPrice: true, lineTotal: true } },
      },
    });
    if (order.invoice) throw new AppError("CONFLICT", `Facture déjà émise : ${order.invoice.number}.`);
    if (order.status === "CANCELLED") throw new AppError("CONFLICT", "Une commande annulée ne se facture pas.");
    if (order.amountPaid + order.refundedAmount < order.total) throw new AppError("CONFLICT", "La facture s'émet une fois la commande soldée.");
    const lines: InvoiceLine[] = order.items.map((item) => ({
      label: `${item.productName} — ${item.variantName}`,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      lineTotal: item.lineTotal,
    }));
    if (order.deliveryFee > 0) lines.push({ label: "Frais de livraison", quantity: 1, unitPrice: order.deliveryFee, lineTotal: order.deliveryFee });
    if (order.discountTotal > 0) lines.push({ label: "Remise", quantity: 1, unitPrice: -order.discountTotal, lineTotal: -order.discountTotal });
    const contact = order.contact as unknown as Contact;
    const customer: InvoiceCustomer = {
      name: contact.name,
      phone: contact.phone,
      email: contact.email,
      address: addressOf(order.shippingAddress as unknown as ShippingAddress | null, order.pickupPoint),
    };
    return createInvoice(tx, actor, { orderId }, lines, customer, order.total);
  });
}

export interface InvoiceData {
  number: string;
  issuedAt: Date;
  /** Document facturé : « Commande » ou « Intervention », et son numéro. */
  document: { label: string; number: string };
  quoteNumber: string | null;
  lines: InvoiceLine[];
  total: number;
  /** Réglé par le client (remboursements non déduits). */
  amountPaid: number;
  /** Remboursé depuis, suite à un retour. */
  refunded: number;
  /** TVA incluse, si son détail est activé (D6). */
  vat: { rate: number; amount: number } | null;
  customer: InvoiceCustomer;
  company: CompanyHeader;
}

const INVOICE_OWNER_SELECT = {
  number: true,
  issuedAt: true,
  lines: true,
  customer: true,
  total: true,
  order: { select: { id: true, number: true, createdAt: true, amountPaid: true, refundedAmount: true, customer: { select: { userId: true } } } },
  intervention: {
    select: {
      number: true,
      amountPaid: true,
      customer: { select: { userId: true } },
      quote: { select: { id: true, number: true, createdAt: true } },
      quoteRequest: { select: { id: true, createdAt: true } },
    },
  },
} satisfies Prisma.InvoiceSelect;

/**
 * Facture, pour le personnel autorisé, le titulaire du compte, ou l'invité muni du lien de sa
 * commande (ou de son devis / sa demande pour une intervention). Sinon null (réponse 404).
 */
export async function getInvoice(client: Db, viewer: DocumentViewer, number: string): Promise<InvoiceData | null> {
  const invoice = await client.invoice.findUnique({ where: { number }, select: INVOICE_OWNER_SELECT });
  if (!invoice) return null;
  const { order, intervention } = invoice;
  const staff = order ? (["orders.read", "payments.read"] as const) : (["interventions.read", "interventions.manage", "payments.read"] as const);
  if (!canViewDocument(viewer, ownershipOf(order, intervention), staff)) return null;
  const tax = await getSetting("tax", client);
  const base = {
    number: invoice.number,
    issuedAt: invoice.issuedAt,
    lines: invoice.lines as unknown as InvoiceLine[],
    total: invoice.total,
    vat: tax.vatDetailEnabled ? { rate: tax.vatRate, amount: includedVat(invoice.total, tax.vatRate) } : null,
    customer: invoice.customer as unknown as InvoiceCustomer,
    company: await companyHeader(client),
  };
  if (order) {
    return { ...base, document: { label: "Commande", number: order.number }, quoteNumber: null, amountPaid: order.amountPaid + order.refundedAmount, refunded: order.refundedAmount };
  }
  if (!intervention) return null;
  return { ...base, document: { label: "Intervention", number: intervention.number }, quoteNumber: intervention.quote?.number ?? null, amountPaid: intervention.amountPaid, refunded: 0 };
}
