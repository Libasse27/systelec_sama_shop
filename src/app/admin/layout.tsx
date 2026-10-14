import Link from "next/link";
import type { Permission } from "@/server/authz/permissions";
import { getCurrentUser } from "@/server/auth/session";

const NAVIGATION: { href: string; label: string; permission: Permission }[] = [
  { href: "/admin", label: "Tableau de bord", permission: "admin.access" },
  { href: "/admin/produits", label: "Produits", permission: "products.read" },
  { href: "/admin/categories", label: "Catégories", permission: "categories.manage" },
  { href: "/admin/stock", label: "Stock", permission: "inventory.read" },
  { href: "/admin/import-export", label: "Import / export", permission: "products.read" },
];

/** Navigation de l'administration. La garde d'accès reste dans chaque page et chaque service. */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  const links = user?.permissions.has("admin.access") ? NAVIGATION.filter((item) => user.permissions.has(item.permission)) : [];
  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-6 px-4 py-6 lg:flex-row">
      {links.length > 0 && (
        <nav aria-label="Administration" className="lg:w-52 lg:shrink-0">
          <ul className="flex gap-1 overflow-x-auto lg:flex-col">
            {links.map((item) => (
              <li key={item.href}>
                <Link href={item.href} className="block whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium hover:bg-surface-muted">
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      )}
      <main className="min-w-0 flex-1">{children}</main>
    </div>
  );
}
