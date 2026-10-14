import "server-only";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { businessYear } from "@/lib/dates";
import { recordAudit } from "@/server/audit/audit";
import { assertPermission, type Actor } from "@/server/authz/service";
import type { Db } from "@/server/db/client";
import { AppError } from "@/server/errors";
import type { Contact } from "@/server/modules/orders/schemas";
import { canViewDocument, companyHeader, ownershipOf, type CompanyHeader, type DocumentViewer } from "@/server/modules/payments/queries";
import { lockInterventionRow } from "@/server/modules/payments/targets";
import { nextBusinessNumber } from "@/server/modules/sequences/service";

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
  address: string;
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
        problem: true,
        invoice: { select: { number: true } },
        service: { select: { name: true } },
        quote: { select: { number: true, items: { orderBy: { position: "asc" }, select: { label: true, quantity: true, unitPrice: true, lineTotal: true } } } },
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
    const number = await nextBusinessNumber(tx, "invoice", businessYear());
    const invoice = await tx.invoice.create({
      data: {
        number,
        interventionId,
        lines: lines as unknown as Prisma.InputJsonValue,
        customer: customer as unknown as Prisma.InputJsonValue,
        total: intervention.amountDue,
        issuedById: actor.id,
      },
      select: { id: true },
    });
    await recordAudit(tx, { actorId: actor.id, action: "invoice.issue", entityType: "Invoice", entityId: invoice.id, after: { number, interventionId, total: intervention.amountDue } });
    return { number };
  });
}

export interface InvoiceData {
  number: string;
  issuedAt: Date;
  interventionNumber: string;
  quoteNumber: string | null;
  completedAt: Date | null;
  lines: InvoiceLine[];
  total: number;
  amountPaid: number;
  customer: InvoiceCustomer;
  company: CompanyHeader;
}

/** Facture, pour le personnel autorisé, le titulaire du compte, ou l'invité muni du lien de son devis (sinon null). */
export async function getInvoice(client: Db, viewer: DocumentViewer, number: string): Promise<InvoiceData | null> {
  const invoice = await client.invoice.findUnique({
    where: { number },
    select: {
      number: true,
      issuedAt: true,
      lines: true,
      customer: true,
      total: true,
      intervention: {
        select: {
          number: true,
          completedAt: true,
          amountPaid: true,
          customer: { select: { userId: true } },
          quote: { select: { id: true, number: true, createdAt: true } },
          quoteRequest: { select: { id: true, createdAt: true } },
        },
      },
    },
  });
  if (!invoice) return null;
  const owner = ownershipOf(null, invoice.intervention);
  if (!canViewDocument(viewer, owner, ["interventions.read", "interventions.manage", "payments.read"])) return null;
  return {
    number: invoice.number,
    issuedAt: invoice.issuedAt,
    interventionNumber: invoice.intervention.number,
    quoteNumber: invoice.intervention.quote?.number ?? null,
    completedAt: invoice.intervention.completedAt,
    lines: invoice.lines as unknown as InvoiceLine[],
    total: invoice.total,
    amountPaid: invoice.intervention.amountPaid,
    customer: invoice.customer as unknown as InvoiceCustomer,
    company: await companyHeader(client),
  };
}
