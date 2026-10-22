import { formatDateTime } from "./dates";
import { formatFcfa } from "./money";

type Condition = "NEW" | "REFURBISHED" | "USED";
type PricingMode = "FIXED" | "INDICATIVE" | "QUOTE_ONLY";

export const LOW_STOCK_THRESHOLD = 5;

const CONDITION_LABELS: Record<Condition, string> = {
  NEW: "Neuf",
  REFURBISHED: "Reconditionné",
  USED: "Occasion",
};

export function conditionLabel(condition: Condition): string {
  return CONDITION_LABELS[condition];
}

export type AvailabilityLevel = "in-stock" | "low" | "out";

/** Disponibilité réelle affichée au client (le stock exact n'est montré que s'il est faible). */
export function availability(available: number): { level: AvailabilityLevel; label: string } {
  if (available <= 0) return { level: "out", label: "Épuisé" };
  if (available <= LOW_STOCK_THRESHOLD) {
    return { level: "low", label: available === 1 ? "Plus qu'un exemplaire" : `Plus que ${available} en stock` };
  }
  return { level: "in-stock", label: "En stock" };
}

/** Libellé de tarif d'un service : jamais de prix inventé pour une prestation sur devis. */
export function servicePriceLabel(pricingMode: PricingMode, price: number | null): string {
  if (pricingMode === "QUOTE_ONLY" || price === null) return "Sur devis";
  return pricingMode === "INDICATIVE" ? `À partir de ${formatFcfa(price)}` : formatFcfa(price);
}

type ProductStatus = "DRAFT" | "PUBLISHED" | "ARCHIVED";

export const PRODUCT_STATUS_LABELS: Record<ProductStatus, string> = {
  DRAFT: "Brouillon",
  PUBLISHED: "Publié",
  ARCHIVED: "Archivé",
};

type MovementType = "IN" | "OUT" | "ADJUSTMENT" | "RESERVE" | "RELEASE" | "SALE" | "RETURN";

export const MOVEMENT_TYPE_LABELS: Record<MovementType, string> = {
  IN: "Entrée",
  OUT: "Sortie",
  ADJUSTMENT: "Inventaire",
  RESERVE: "Réservation",
  RELEASE: "Libération",
  SALE: "Vente",
  RETURN: "Retour",
};

export const CONDITION_OPTIONS = Object.entries(CONDITION_LABELS).map(([value, label]) => ({ value, label }));

type OrderStatus = "PENDING_CONFIRMATION" | "CONFIRMED" | "PREPARING" | "READY_FOR_PICKUP" | "READY_TO_SHIP" | "CANCELLED" | "CLOSED";

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  PENDING_CONFIRMATION: "En attente de confirmation",
  CONFIRMED: "Confirmée",
  PREPARING: "En préparation",
  READY_FOR_PICKUP: "Prête au retrait",
  READY_TO_SHIP: "Prête à livrer",
  CANCELLED: "Annulée",
  CLOSED: "Remise au client",
};

type PaymentStatus = "UNPAID" | "PARTIALLY_PAID" | "PAID" | "TO_VERIFY" | "REFUND_PENDING" | "REFUNDED";

export const PAYMENT_STATUS_LABELS: Record<PaymentStatus, string> = {
  UNPAID: "Non payée",
  PARTIALLY_PAID: "Partiellement payée",
  PAID: "Payée",
  TO_VERIFY: "À vérifier",
  REFUND_PENDING: "Remboursement en attente",
  REFUNDED: "Remboursement effectué",
};

export const FULFILLMENT_LABELS = { DELIVERY: "Livraison à domicile", PICKUP: "Retrait en boutique" } as const;

export const QUOTE_REQUEST_STATUS_LABELS = {
  NEW: "Nouvelle",
  IN_REVIEW: "En cours d'étude",
  QUOTED: "Devis envoyé",
  ACCEPTED: "Acceptée",
  CANCELLED: "Close sans suite",
} as const;

export const QUOTE_STATUS_LABELS = {
  DRAFT: "Brouillon",
  SENT: "Envoyé, en attente de réponse",
  ACCEPTED: "Accepté",
  REFUSED: "Refusé",
  EXPIRED: "Expiré",
} as const;

export const QUOTE_ITEM_KIND_LABELS = { MATERIAL: "Matériel", LABOR: "Main-d'œuvre", TRAVEL: "Déplacement", OTHER: "Autre" } as const;

export const URGENCY_LABELS = { NORMAL: "Normale", URGENT: "Urgente" } as const;

export const INTERVENTION_STATUS_LABELS = {
  TO_SCHEDULE: "À planifier",
  SCHEDULED: "Planifiée",
  IN_PROGRESS: "En cours",
  DONE: "Terminée",
  CANCELLED: "Annulée",
} as const;

export const DELIVERY_STATUS_LABELS = {
  ASSIGNED: "Livreur assigné",
  IN_TRANSIT: "En cours de livraison",
  DELIVERED: "Livrée",
  FAILED: "Échec de livraison",
} as const;

export const RETURN_STATUS_LABELS = {
  RECEIVED: "À vérifier",
  VERIFICATION: "Vérification demandée",
  REFUND_PENDING: "Remboursement à verser",
  COMPLETED: "Traité",
  REJECTED: "Refusé",
} as const;

export const RETURN_VERIFICATION_KIND_LABELS = {
  INSPECTION: "Inspection physique",
  PHOTOS: "Photos",
  INVOICE: "Facture ou preuve d'achat",
  INFORMATION: "Informations complémentaires",
} as const;

export const RETURN_EXCEPTION_GROUND_LABELS = {
  WARRANTY: "Garantie",
  HIDDEN_DEFECT: "Vice caché",
  LEGAL_OBLIGATION: "Obligation légale",
  OTHER: "Autre motif",
} as const;

export const RETURN_EVENT_LABELS = {
  DECLARED: "Retour déclaré",
  VERIFICATION_REQUESTED: "Vérification demandée",
  VERIFICATION_ANSWERED: "Réponse à la vérification",
  ACCEPTED: "Retour accepté",
  REJECTED: "Retour refusé",
  REFUNDED: "Remboursement versé",
  OVERDUE_NOTIFIED: "Délai de traitement dépassé : administrateur alerté",
  VERIFICATION_REMINDED: "Relance : vérification sans réponse",
  VERIFICATION_ESCALATED: "Escalade aux administrateurs : vérification sans réponse",
} as const;

export const CUSTOMER_RETURN_REASON_LABELS = {
  DAMAGED: "Produit endommagé",
  DEFECTIVE: "Produit défectueux ou en panne",
  NOT_CONFORMING: "Produit non conforme à la commande",
  OTHER: "Autre motif",
} as const;

/** Statut d'un retour tel que le client le voit (phase 10, décision 2). */
export const RETURN_CUSTOMER_STATUS_LABELS = {
  RECEIVED: "Demande reçue, en cours d'examen",
  VERIFICATION: "Informations demandées",
  REFUND_PENDING: "Acceptée : remboursement en préparation",
  COMPLETED: "Traitée",
  REJECTED: "Refusée",
} as const;

export const COURIER_KIND_LABELS = {
  INTERNAL: "Livreur interne (compte)",
  EXTERNAL: "Transporteur externe",
} as const;

/** État d'une notification tel que l'enregistre la file d'envoi (src/server/notifications/queue.ts). */
export interface NotificationState {
  status: string;
  attempts: number;
  nextAttemptAt: Date | null;
  error: string | null;
}

/** Seules les catégories contrôlées sont visibles ; les anciennes erreurs libres restent masquées. */
const FAILURE_LABELS: Record<string, string> = {
  SMTP_AUTHENTICATION_FAILED: "incident d'authentification fournisseur",
  SMTP_RECIPIENT_REJECTED: "adresse destinataire refusée",
  SMTP_TEMPORARY_FAILURE: "incident temporaire du fournisseur",
  SMTP_CONNECTION_FAILURE: "incident de connexion au fournisseur",
  SMTP_DELIVERY_FAILURE: "incident d'envoi du fournisseur",
  INTERNAL: "incident interne, diagnostic réservé aux techniciens",
  UNKNOWN: "incident de notification",
  ABANDONED: "envoi abandonné après épuisement des tentatives",
};

function failureLabel(error: string | null): string {
  const label = error && Object.hasOwn(FAILURE_LABELS, error) ? FAILURE_LABELS[error] : undefined;
  return label ? ` — ${label}` : "";
}

/** Réduit les erreurs stockées, y compris les anciennes chaînes libres, à la liste sûre connue. */
export function safeNotificationErrorCode(error: string | null): string | null {
  return error && Object.hasOwn(FAILURE_LABELS, error) ? error : null;
}

/** Libellé d'une notification sur la fiche commande : statut, essais, prochain essai (heure de Dakar), cause d'un échec. */
export function notificationStatusLabel(notification: NotificationState): string {
  const { status, attempts, nextAttemptAt, error } = notification;
  switch (status) {
    case "SENT":
      return attempts > 1 ? `envoyée au ${attempts}e essai` : "envoyée";
    case "PENDING":
      return attempts > 0 ? `en attente de renvoi (${attempts} essai(s) déjà tenté(s))` : "en attente";
    case "SKIPPED_NO_PROVIDER":
      return "non envoyée (aucun fournisseur)";
    case "FAILED":
      return nextAttemptAt
        ? `échec après ${attempts} essai(s), nouvel essai prévu le ${formatDateTime(nextAttemptAt)}${failureLabel(error)}`
        : `échec définitif après ${attempts} essai(s)${failureLabel(error)}`;
    default:
      return status;
  }
}
