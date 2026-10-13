import { execFileSync } from "node:child_process";

/**
 * Données nécessaires aux parcours (idempotent) : structure de base (rôles, catalogue,
 * services) puis données de démonstration « [DÉMO] » (refusées en production par le script).
 */
export default function globalSetup(): void {
  execFileSync("pnpm", ["-s", "db:seed"], { stdio: "inherit" });
  execFileSync("pnpm", ["-s", "db:seed:demo"], { stdio: "inherit" });
}
