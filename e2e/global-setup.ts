import { execFileSync } from "node:child_process";

/** Rôles et permissions présents avant les parcours (idempotent, aucune donnée de démo). */
export default function globalSetup(): void {
  execFileSync("pnpm", ["-s", "db:seed"], { stdio: "inherit" });
}
