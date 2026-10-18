import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Règle non négociable (cahier des charges §3.1) : aucun paiement électronique.
 * Ce test échoue si une dépendance ou du code de paiement en ligne apparaît.
 */
const ROOT = process.cwd();

const FORBIDDEN_PACKAGES = [
  "stripe",
  "paypal",
  "braintree",
  "adyen",
  "square",
  "mollie",
  "paystack",
  "flutterwave",
  "cinetpay",
  "paydunya",
  "wave",
  "orange-money",
  "kkiapay",
  "fedapay",
];

const FORBIDDEN_CODE = /stripe|paypal|braintree|paystack|flutterwave|cinetpay|paydunya|kkiapay|fedapay|orange[\s_-]?money|wave[\s_-]?(api|pay|checkout)|checkout[\s_-]?session|card[\s_-]?number|\bcvv\b|\biban\b/i;

/** Fichiers autorisés à mentionner ces termes (listes de détection / masquage). */
const ALLOWED_FILES = new Set(["tests/policy/no-electronic-payment.test.ts", "src/server/audit/redact.ts", "src/server/modules/settings/schemas.test.ts"]);

const SCANNED_DIRS = ["src", "prisma"];
const SCANNED_EXTENSIONS = /\.(ts|tsx|js|mjs|prisma|sql)$/;

function listFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (name === "generated" || name === "node_modules") return [];
    return statSync(path).isDirectory() ? listFiles(path) : [path];
  });
}

describe("absence de mécanisme de paiement électronique", () => {
  it("aucune dépendance de passerelle de paiement", () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as Record<string, Record<string, string>>;
    const deps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
    const offenders = deps.filter((dep) => FORBIDDEN_PACKAGES.some((bad) => dep.toLowerCase().includes(bad)));
    expect(offenders).toEqual([]);
  });

  it("aucun code de paiement en ligne dans src/ et prisma/", () => {
    const offenders = SCANNED_DIRS.flatMap((dir) => listFiles(join(ROOT, dir)))
      .filter((file) => SCANNED_EXTENSIONS.test(file))
      .map((file) => relative(ROOT, file))
      .filter((file) => !ALLOWED_FILES.has(file))
      .filter((file) => FORBIDDEN_CODE.test(readFileSync(join(ROOT, file), "utf8")));
    expect(offenders).toEqual([]);
  });
});
