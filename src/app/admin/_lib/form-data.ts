/** Lecture des champs de formulaire avant validation Zod côté service (aucune règle métier ici). */

export function text(formData: FormData, name: string): string | undefined {
  const value = formData.get(name);
  return typeof value === "string" ? value : undefined;
}

/** Entier saisi (espaces de milliers tolérés) ; undefined si vide, NaN si illisible (rejeté par Zod). */
export function int(formData: FormData, name: string): number | undefined {
  const value = text(formData, name)?.replace(/[\s  ]/g, "");
  if (!value) return undefined;
  return /^-?\d+$/.test(value) ? Number(value) : Number.NaN;
}

/** Entier facultatif : null si le champ est vide (efface la valeur). */
export function optionalInt(formData: FormData, name: string): number | null {
  return int(formData, name) ?? null;
}

export function checkbox(formData: FormData, name: string): boolean {
  return formData.get(name) === "on";
}

/** Lignes « Libellé : valeur » (caractéristiques, attributs). Une ligne sans « : » est signalée par Zod. */
export function labelValueLines(value: string | undefined): { label: string; value: string }[] {
  return (value ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const separator = line.indexOf(":");
      return separator === -1
        ? { label: line, value: "" }
        : { label: line.slice(0, separator).trim(), value: line.slice(separator + 1).trim() };
    });
}

export const toLabelValueText = (items: readonly { label: string; value: string }[]): string =>
  items.map((item) => `${item.label} : ${item.value}`).join("\n");
