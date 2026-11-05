/**
 * Liens de contact partagés (pied de page, page Contact, messagerie d'administration) : une seule
 * validation et une seule normalisation. Chaque fonction renvoie null quand la valeur n'est pas
 * utilisable : l'appelant n'émet alors aucun lien.
 */

/** Chiffres minimum d'un numéro joignable (les numéros sénégalais en comptent 9, sans indicatif). */
const MIN_PHONE_DIGITS = 8;
/** Longueur maximale d'un numéro international (E.164). */
const MAX_PHONE_DIGITS = 15;
/** Seuls caractères admis dans un numéro saisi : « + » initial, chiffres et séparateurs de présentation. */
const PHONE_SHAPE = /^\+?[\d\s.\-()]+$/;

/** Adresse sans caractère pouvant ajouter des paramètres d'en-tête (?, &, #, %), des destinataires (, ;) ou un saut de ligne. */
const MAIL_ADDRESS = /^[^\s@?&#%<>,;:"\\()[\]]+@[^\s@?&#%<>,;:"\\()[\]]+\.[^\s@?&#%<>,;:"\\()[\]]+$/;
const MAX_EMAIL_LENGTH = 254;

/** Chiffres du numéro (avec « + » initial éventuel), ou null si la forme ou la longueur est invalide. */
function phoneDigits(raw: string): { plus: boolean; digits: string } | null {
  const value = raw.trim();
  if (!PHONE_SHAPE.test(value)) return null;
  const digits = value.replace(/\D/g, "");
  if (digits.length < MIN_PHONE_DIGITS || digits.length > MAX_PHONE_DIGITS) return null;
  return { plus: value.startsWith("+"), digits };
}

/** Numéro composable (« tel: » : chiffres et « + » initial seulement) ; null si le numéro est inutilisable. */
export function telHref(phone: string): string | null {
  const parsed = phoneDigits(phone);
  return parsed ? `tel:${parsed.plus ? "+" : ""}${parsed.digits}` : null;
}

/**
 * Lien WhatsApp (wa.me attend l'indicatif et les chiffres seuls). Le numéro doit commencer par « + » ou « 00 » :
 * sans indicatif, wa.me lirait ses premiers chiffres comme un indicatif et viserait un autre abonné.
 */
export function whatsappHref(phone: string): string | null {
  const parsed = phoneDigits(phone);
  if (!parsed) return null;
  if (!parsed.plus && !parsed.digits.startsWith("00")) return null;
  const digits = parsed.plus ? parsed.digits : parsed.digits.slice(2);
  return digits.length >= MIN_PHONE_DIGITS ? `https://wa.me/${digits}` : null;
}

/** Lien « mailto: » ; null pour toute valeur pouvant injecter des paramètres ou des destinataires. */
export function mailtoHref(email: string): string | null {
  const value = email.trim();
  if (value.length > MAX_EMAIL_LENGTH || !MAIL_ADDRESS.test(value)) return null;
  return `mailto:${value}`;
}
