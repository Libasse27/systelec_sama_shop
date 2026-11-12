/**
 * Génère le secret client « Sign in with Apple » (APPLE_CLIENT_SECRET) : un JWT ES256 signé avec la clé
 * privée .p8 téléchargée depuis le compte Apple Developer. Valable 6 mois au plus (limite Apple) : le
 * régénérer avant son expiration, sans quoi l'application refuse de démarrer (src/lib/env.ts).
 * Aucune dépendance : node:crypto. La clé n'est jamais affichée ; seul le JWT est écrit sur la sortie.
 *
 * Usage (poste d'administration, jamais dans le dépôt ; clé .p8 en mode 600) :
 *   umask 077
 *   APPLE_TEAM_ID=… APPLE_KEY_ID=… APPLE_CLIENT_ID=… \
 *     pnpm exec tsx scripts/ops/apple-client-secret.ts chemin/AuthKey_XXXX.p8 [jours] > apple-client-secret.txt
 * Le JWT est écrit sur la sortie standard (à rediriger vers un fichier privé, pas à afficher) ; les messages
 * vont sur la sortie d'erreur.
 */
import { createPrivateKey, sign, type KeyObject } from "node:crypto";
import { readFileSync, statSync } from "node:fs";

const APPLE_AUDIENCE = "https://appleid.apple.com";
const MAX_DAYS = 180;
const DAY_SECONDS = 24 * 60 * 60;

interface AppleSecretInput {
  teamId: string;
  keyId: string;
  clientId: string;
  privateKey: KeyObject;
  days: number;
}

const base64url = (value: object): string => Buffer.from(JSON.stringify(value)).toString("base64url");

/** JWT ES256 (signature au format JOSE r||s, « ieee-p1363 »). */
function buildAppleClientSecret({ teamId, keyId, clientId, privateKey, days }: AppleSecretInput): string {
  if (!Number.isInteger(days) || days < 1 || days > MAX_DAYS) throw new Error(`Durée invalide : 1 à ${MAX_DAYS} jours.`);
  const iat = Math.floor(Date.now() / 1000);
  const header = base64url({ alg: "ES256", kid: keyId, typ: "JWT" });
  const payload = base64url({ iss: teamId, iat, exp: iat + days * DAY_SECONDS, aud: APPLE_AUDIENCE, sub: clientId });
  const signature = sign("sha256", Buffer.from(`${header}.${payload}`), { key: privateKey, dsaEncoding: "ieee-p1363" });
  return `${header}.${payload}.${signature.toString("base64url")}`;
}

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} requis (variable d'environnement).`);
  return value;
}

/** Clé lisible par le groupe ou les autres : avertissement (chmod 600), sans bloquer. */
function warnIfKeyExposed(keyPath: string): void {
  const GROUP_OR_OTHER = 0o077;
  if ((statSync(keyPath).mode & GROUP_OR_OTHER) !== 0) {
    process.stderr.write(`ATTENTION : ${keyPath} est lisible par d'autres utilisateurs : chmod 600 ${keyPath}\n`);
  }
}

function readInput(argv: readonly string[]): AppleSecretInput {
  const [keyPath, daysArg] = argv;
  if (!keyPath) throw new Error("Chemin de la clé .p8 requis (premier argument).");
  warnIfKeyExposed(keyPath);
  const privateKey = createPrivateKey(readFileSync(keyPath, "utf8"));
  if (privateKey.asymmetricKeyType !== "ec") throw new Error("La clé doit être une clé EC (fichier .p8 Apple).");
  return {
    teamId: required("APPLE_TEAM_ID"),
    keyId: required("APPLE_KEY_ID"),
    clientId: required("APPLE_CLIENT_ID"),
    privateKey,
    days: daysArg === undefined ? MAX_DAYS : Number(daysArg),
  };
}

function main(): void {
  const input = readInput(process.argv.slice(2));
  const secret = buildAppleClientSecret(input);
  const expires = new Date(Date.now() + input.days * DAY_SECONDS * 1000).toISOString().slice(0, 10);
  process.stderr.write(`Secret valable jusqu'au ${expires} : le reporter dans APPLE_CLIENT_SECRET (.env.production).\n`);
  process.stdout.write(`${secret}\n`);
}

try {
  main();
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : "Erreur inconnue"}\n`);
  process.exitCode = 1;
}
