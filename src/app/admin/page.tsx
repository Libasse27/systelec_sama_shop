import type { Metadata } from "next";
import { findRoleDefinition } from "@/server/authz/roles";
import { requirePermission } from "@/server/auth/session";

export const metadata: Metadata = { title: "Administration", robots: { index: false } };

export default async function AdminHomePage() {
  // Garde dans la page (et non seulement dans un layout, qui n'est pas réévalué à chaque navigation).
  const user = await requirePermission("admin.access", "/admin");
  const roleLabels = user.roles.map((code) => findRoleDefinition(code)?.label ?? code);

  return (
    <main className="mx-auto max-w-6xl px-4 py-10">
      <h1 className="text-2xl font-bold">Administration</h1>
      <p className="mt-2 text-ink-muted">
        Bonjour {user.name}. Rôle{roleLabels.length > 1 ? "s" : ""} : {roleLabels.join(", ")}.
      </p>
      <section aria-labelledby="droits" className="mt-8 rounded-xl border border-line bg-surface p-5">
        <h2 id="droits" className="font-semibold">
          Vos autorisations
        </h2>
        <ul className="mt-3 flex flex-wrap gap-2">
          {[...user.permissions].sort().map((permission) => (
            <li key={permission} className="rounded-md bg-surface-muted px-2 py-1 font-mono text-xs">
              {permission}
            </li>
          ))}
        </ul>
        <p className="mt-4 text-sm text-ink-muted">
          Les modules (catalogue, stock, commandes, encaissements, services) arrivent dans les phases suivantes.
        </p>
      </section>
    </main>
  );
}
