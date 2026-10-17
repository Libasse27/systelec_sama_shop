import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader, Pagination, pageParam, stringParam } from "@/components/admin/admin-ui";
import { formatDateTime } from "@/lib/dates";
import { ROLE_DEFINITIONS } from "@/server/authz/roles";
import { requirePermission } from "@/server/auth/session";
import { db } from "@/server/db/client";
import { isRoleCode, listUsers } from "@/server/modules/users/service";

export const metadata: Metadata = { title: "Utilisateurs", robots: { index: false } };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const STATES = { actifs: false, desactives: true } as const;

export default async function UsersPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await requirePermission("users.manage", "/admin/utilisateurs");
  const params = await searchParams;
  const q = stringParam(params.q);
  const roleParam = stringParam(params.role);
  const role = roleParam === "CLIENT" || (roleParam && isRoleCode(roleParam)) ? roleParam : undefined;
  const stateParam = stringParam(params.etat);
  const state = stateParam === "actifs" || stateParam === "desactives" ? stateParam : undefined;
  const { rows, total, page, pageCount } = await listUsers(db, user, {
    q,
    role: role === "CLIENT" ? undefined : role,
    kind: role === "CLIENT" ? "CUSTOMER" : undefined,
    inactive: state ? STATES[state] : undefined,
    page: pageParam(params.page),
  });

  return (
    <>
      <PageHeader title="Utilisateurs" />
      <p className="-mt-4 mb-4 text-sm text-ink-muted">
        Les clients créent leur compte eux-mêmes. Attribuez un rôle du personnel depuis la fiche d&apos;un compte.
      </p>
      <form method="get" role="search" className="mb-4 flex flex-wrap items-end gap-3">
        <div className="flex min-w-48 flex-1 flex-col gap-1">
          <label htmlFor="recherche-utilisateurs" className="text-sm font-medium">
            Rechercher
          </label>
          <input id="recherche-utilisateurs" name="q" type="search" defaultValue={q} placeholder="Nom, e-mail ou téléphone" className="rounded-lg border border-line px-3 py-2" />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="filtre-role" className="text-sm font-medium">
            Rôle
          </label>
          <select id="filtre-role" name="role" defaultValue={role ?? ""} className="rounded-lg border border-line px-3 py-2">
            <option value="">Tous</option>
            <option value="CLIENT">Clients (sans rôle)</option>
            {ROLE_DEFINITIONS.map((definition) => (
              <option key={definition.code} value={definition.code}>
                {definition.label}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="filtre-etat" className="text-sm font-medium">
            État
          </label>
          <select id="filtre-etat" name="etat" defaultValue={state ?? ""} className="rounded-lg border border-line px-3 py-2">
            <option value="">Tous</option>
            <option value="actifs">Actifs</option>
            <option value="desactives">Désactivés</option>
          </select>
        </div>
        <button type="submit" className="rounded-lg border border-line px-4 py-2 text-sm font-semibold hover:bg-surface-muted">
          Filtrer
        </button>
      </form>
      <p className="mb-2 text-sm text-ink-muted">{total} compte(s)</p>
      {rows.length === 0 ? (
        <p className="rounded-xl border border-line bg-surface p-6 text-center text-ink-muted">Aucun compte.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-line bg-surface">
          <table className="w-full text-left text-sm">
            <thead className="bg-surface-muted text-xs uppercase text-ink-muted">
              <tr>
                <th scope="col" className="px-3 py-2">Compte</th>
                <th scope="col" className="px-3 py-2">Rôles</th>
                <th scope="col" className="px-3 py-2">État</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-t border-line">
                  <td className="px-3 py-2">
                    <Link href={`/admin/utilisateurs/${row.id}`} className="font-medium text-brand-blue underline-offset-2 hover:underline">
                      {row.name}
                    </Link>
                    <div className="break-all text-xs text-ink-muted">
                      {row.email}
                      {row.phone && ` · ${row.phone}`}
                    </div>
                  </td>
                  <td className="px-3 py-2">{row.roles.length > 0 ? row.roles.map((entry) => entry.label).join(", ") : <span className="text-ink-muted">Client</span>}</td>
                  <td className="px-3 py-2">
                    {row.isActive ? "Actif" : <span className="font-semibold text-red-800">Désactivé</span>}
                    <div className="text-xs text-ink-muted">Créé le {formatDateTime(row.createdAt)}</div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Pagination basePath="/admin/utilisateurs" params={{ q, role, etat: state }} page={page} pageCount={pageCount} />
    </>
  );
}
