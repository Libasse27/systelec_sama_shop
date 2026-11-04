/**
 * Moyens de paiement acceptés. Orange Money et Wave sont réglés par le client depuis son téléphone,
 * puis ENREGISTRÉS À LA MAIN par le personnel : aucune passerelle ni API de paiement dans l'application.
 * Seul endroit du code applicatif qui nomme ces moyens (voir tests/policy/no-electronic-payment.test.ts).
 */
export const PAYMENT_METHODS = ["CASH", "ORANGE_MONEY", "WAVE"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

/** Moyens enregistrés à la main d'après un transfert sur téléphone : tout sauf les espèces. */
export const isMobilePaymentMethod = (method: PaymentMethod): boolean => method !== "CASH";

export const TRANSACTION_REFERENCE_PATTERN = /^[A-Z0-9._-]{4,64}$/;

/** Référence de transaction saisie : espaces retirés, majuscules ; vide ou absente → null. */
export function normalizeTransactionReference(value: string | null | undefined): string | null {
  return value?.replace(/\s+/g, "").toUpperCase() || null;
}

/**
 * Clé de comparaison d'une référence : forme normalisée sans point, tiret ni tiret bas, pour que TX-123, TX.123 et
 * TX123 désignent le même transfert. Sert uniquement à détecter les doublons : la référence reste stockée et
 * affichée telle que saisie (normalisée), pour le rapprochement à l'œil avec le relevé de l'opérateur.
 */
export function transactionReferenceKey(value: string | null | undefined): string {
  return normalizeTransactionReference(value)?.replace(/[._-]/g, "") ?? "";
}

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  CASH: "Espèces",
  ORANGE_MONEY: "Orange Money",
  WAVE: "Wave",
};

export const PAYMENT_METHOD_OPTIONS = PAYMENT_METHODS.map((value) => ({ value, label: PAYMENT_METHOD_LABELS[value] }));

/** Pictogrammes (public/icones) ; celui d'Orange Money est deux fois plus large que haut. */
export const PAYMENT_METHOD_ICONS = {
  CASH: { name: "especes", sizeClass: "size-5" },
  ORANGE_MONEY: { name: "orange-money", sizeClass: "h-5 w-10" },
  WAVE: { name: "wave", sizeClass: "size-5" },
} as const satisfies Record<PaymentMethod, { name: string; sizeClass: string }>;

export type PaymentIconName = (typeof PAYMENT_METHOD_ICONS)[PaymentMethod]["name"];

const PAYMENT_METHOD_PHRASES: Record<PaymentMethod, string> = {
  CASH: "en espèces",
  ORANGE_MONEY: "par Orange Money",
  WAVE: "par Wave",
};

/** Tournure pour une phrase. Sans moyen : message mis en file avant l'ajout du champ, donc des espèces. */
export const paymentMethodPhrase = (method: PaymentMethod = "CASH"): string => PAYMENT_METHOD_PHRASES[method];

export const ACCEPTED_PAYMENT_METHODS = "en espèces, par Orange Money ou par Wave";

/** Valeur « paymentAccepted » de schema.org (données structurées de l'accueil). */
export const SCHEMA_ORG_PAYMENT_ACCEPTED = "Cash, Orange Money, Wave";

export const PAYMENT_NOTICE = `Paiement ${ACCEPTED_PAYMENT_METHODS}, à la livraison ou au retrait.`;
