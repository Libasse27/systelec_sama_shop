/**
 * Montants en francs CFA (XOF). Le XOF n'a pas de sous-unité : tous les montants
 * sont des entiers. Aucun calcul monétaire ne doit utiliser de valeur décimale persistée.
 *
 * Règle d'arrondi unique : à l'entier le plus proche, demi vers le haut (0,5 → 1).
 */
export type Fcfa = number;

export const CURRENCY_CODE = "XOF";
export const CURRENCY_LABEL = "FCFA";

export function assertFcfa(amount: number): Fcfa {
  if (!Number.isSafeInteger(amount)) {
    throw new RangeError(`Montant FCFA invalide (entier attendu) : ${amount}`);
  }
  return amount;
}

export function roundFcfa(value: number): Fcfa {
  if (!Number.isFinite(value)) throw new RangeError(`Valeur non finie : ${value}`);
  const rounded = value >= 0 ? Math.floor(value + 0.5) : -Math.floor(-value + 0.5);
  return rounded === 0 ? 0 : rounded; // normalise -0
}

/** Pourcentage d'un montant (ex. remise de 12,5 %), arrondi selon la règle unique. */
export function percentOf(amount: Fcfa, percent: number): Fcfa {
  assertFcfa(amount);
  if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
    throw new RangeError(`Pourcentage hors limites (0–100) : ${percent}`);
  }
  return roundFcfa((amount * percent) / 100);
}

export function lineTotal(unitPrice: Fcfa, quantity: number): Fcfa {
  assertFcfa(unitPrice);
  if (!Number.isSafeInteger(quantity) || quantity < 0) {
    throw new RangeError(`Quantité invalide : ${quantity}`);
  }
  return assertFcfa(unitPrice * quantity);
}

export function sumFcfa(amounts: readonly Fcfa[]): Fcfa {
  return assertFcfa(amounts.reduce((total, amount) => total + assertFcfa(amount), 0));
}

const fcfaFormatter = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 });

/** Formate pour l'affichage : « 125 000 FCFA ». */
export function formatFcfa(amount: Fcfa): string {
  return `${fcfaFormatter.format(assertFcfa(amount))} ${CURRENCY_LABEL}`;
}

/**
 * TVA incluse dans un prix TTC (prix saisis TTC, D6) : TTC × taux / (100 + taux), arrondie
 * selon la règle unique. Exemple : 118 000 FCFA à 18 % contiennent 18 000 FCFA de TVA.
 */
export function includedVat(totalTtc: Fcfa, ratePercent: number): Fcfa {
  assertFcfa(totalTtc);
  if (!Number.isFinite(ratePercent) || ratePercent < 0 || ratePercent > 100) {
    throw new RangeError(`Taux de TVA hors limites (0–100) : ${ratePercent}`);
  }
  return roundFcfa((totalTtc * ratePercent) / (100 + ratePercent));
}
