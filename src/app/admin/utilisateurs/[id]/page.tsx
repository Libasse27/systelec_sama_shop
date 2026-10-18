import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader, Section } from "@/components/admin/admin-ui";
import { ActionForm, SelectField, SubmitButton, TextField } from "@/components/forms/form-controls";
import { formatDateTime } from "@/lib/dates";
import { SUPER_ADMIN } from "@/server/authz/roles";
import { requirePermission } from "@/server/auth/session";
import { db } from "@/server/db/client";
import { getUserDetail } from "@/server/modules/users/service";
import { assignRoleAction, revokeRoleAction, setUserActiveAction } from "../actions";

export const metadata: Metadata = { title: "Compte utilisateur", robots: { index: false } };

export default async function UserPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requirePermission("users.manage", `/admin/utilisateurs/${id}`);
  const account = await getUserDetail(db, user, id);
  if (!account) notFound();
  const isSelf = account.id === user.id;
  const canManageRoles = user.permissions.has("roles.manage");
  const protectedAccount = account.roles.some((role) => role.code === SUPER_ADMIN) && !user.roles.includes(SUPER_ADMIN);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={account.name}>
        <Link href="/admin/utilisateurs" className="text-sm text-brand-blue underline">
          ← Utilisateurs
        </Link>
      </PageHeader>

      <Section title="Compte">
        <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-[12rem_1fr]">
          <dt className="text-ink-muted">E-mail</dt>
          <dd className="break-all">{account.email}</dd>
          <dt className="text-ink-muted">Téléphone</dt>
          <dd>{account.phone ?? "—"}</dd>
          <dt className="text-ink-muted">Type</dt>
          <dd>{account.kind === "STAFF" ? "Personnel" : "Client"}</dd>
          <dt className="text-ink-muted">État</dt>
          <dd className={account.isActive ? undefined : "font-semibold text-red-800"}>{account.isActive ? "Actif" : "Désactivé"}</dd>
          <dt className="text-ink-muted">Créé le</dt>
          <dd>{formatDateTime(account.createdAt)}</dd>
          <dt className="text-ink-muted">Dernière activité</dt>
          <dd>{account.lastSessionAt ? formatDateTime(account.lastSessionAt) : "—"}</dd>
        </dl>
        <Link href={`/admin/audit?entite=User&id=${account.id}`} className="mt-3 inline-block text-sm text-brand-blue underline">
          Historique de ce compte dans le journal d&apos;audit
        </Link>
      </Section>

      {canManageRoles && (
        <Section title="Rôles">
          {/* Un seul formulaire, toujours monté : le message reste visible après un retrait. */}
          <ActionForm action={revokeRoleAction.bind(null, account.id)}>
            {account.roles.length === 0 ? (
              <p className="text-sm text-ink-muted">Aucun rôle : compte client.</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {account.roles.map((role) => (
                  <li key={role.code} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line px-3 py-2">
                    <span className="font-medium">{role.label}</span>
                    {isSelf ? (
                      <span className="text-xs text-ink-muted">Vos propres rôles se retirent par un autre administrateur.</span>
                    ) : (
                      <SubmitButton name="role" value={role.code} variant="danger" confirm={`Retirer le rôle « ${role.label} » ?`}>
                        Retirer « {role.label} »
                      </SubmitButton>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </ActionForm>
          {account.assignableRoles.length > 0 && (
            <ActionForm action={assignRoleAction.bind(null, account.id)} className="mt-4 border-t border-line pt-4">
              <div className="flex flex-wrap items-end gap-2">
                <SelectField name="role" label="Attribuer un rôle" options={account.assignableRoles.map((role) => ({ value: role.code, label: role.label }))} className="min-w-56 flex-1" />
                <SubmitButton confirm="Attribuer ce rôle ? Le compte accède aussitôt à l'administration correspondante.">Attribuer</SubmitButton>
              </div>
            </ActionForm>
          )}
        </Section>
      )}

      <Section title={account.isActive ? "Désactiver le compte" : "Réactiver le compte"}>
        {isSelf ? (
          <p className="text-sm text-ink-muted">Vous ne pouvez pas désactiver votre propre compte.</p>
        ) : protectedAccount ? (
          <p className="text-sm text-ink-muted">Seul un administrateur principal peut modifier ce compte.</p>
        ) : (
          <ActionForm action={setUserActiveAction.bind(null, account.id)}>
            <TextField name="reason" label="Motif" hint="Inscrit au journal d'audit." />
            <div>
              {account.isActive ? (
                <SubmitButton name="active" value="false" variant="danger" confirm="Désactiver ce compte ? Ses sessions seront fermées immédiatement.">
                  Désactiver le compte
                </SubmitButton>
              ) : (
                <SubmitButton name="active" value="true">
                  Réactiver le compte
                </SubmitButton>
              )}
            </div>
          </ActionForm>
        )}
      </Section>
    </div>
  );
}
