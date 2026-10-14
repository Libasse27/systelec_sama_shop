import { config } from "dotenv";
import { Client } from "pg";

// Même base que le serveur testé : .env en local, variables d'environnement en CI.
config({ path: ".env", quiet: true });

/** Attribue un rôle du personnel à un compte de test (équivalent d'une action d'administration). */
export async function grantRole(email: string, roleCode: string): Promise<void> {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query(
      `INSERT INTO user_roles ("userId", "roleId")
       SELECT u.id, r.id FROM users u, roles r WHERE u.email = $1 AND r.code = $2`,
      [email, roleCode],
    );
    await client.query(`UPDATE users SET kind = 'STAFF' WHERE email = $1`, [email]);
  } finally {
    await client.end();
  }
}

async function withClient<T>(run: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    return await run(client);
  } finally {
    await client.end();
  }
}

/**
 * Produit publié propre à un test, dans une catégorie dédiée : le parcours d'achat ne touche
 * pas au stock des produits de démonstration utilisés par les autres tests.
 */
export async function createTestProduct(options: { price: number; onHand: number }): Promise<{ slug: string; sku: string; categoryId: string }> {
  const suffix = `${Date.now()}${Math.random().toString(36).slice(2, 7)}`;
  const ids = { category: `e2ecat${suffix}`, product: `e2eprod${suffix}`, variant: `e2evar${suffix}`, inventory: `e2einv${suffix}` };
  const slug = `e2e-produit-${suffix}`;
  const sku = `E2E-${suffix}`.toUpperCase();
  await withClient(async (client) => {
    await client.query(`INSERT INTO categories (id, name, slug, "updatedAt") VALUES ($1, $2, $3, now())`, [ids.category, `Catégorie E2E ${suffix}`, `e2e-cat-${suffix}`]);
    await client.query(
      `INSERT INTO products (id, "categoryId", name, slug, "shortDescription", description, status, "publishedAt", "updatedAt")
       VALUES ($1, $2, $3, $4, 'Produit de test E2E.', 'Produit créé par les tests de bout en bout.', 'PUBLISHED', now(), now())`,
      [ids.product, ids.category, `Produit E2E ${suffix}`, slug],
    );
    await client.query(
      `INSERT INTO product_variants (id, "productId", sku, name, price, "isDefault", "updatedAt") VALUES ($1, $2, $3, 'Standard', $4, true, now())`,
      [ids.variant, ids.product, sku, options.price],
    );
    await client.query(`INSERT INTO inventories (id, "variantId", "onHand", "updatedAt") VALUES ($1, $2, $3, now())`, [ids.inventory, ids.variant, options.onHand]);
  });
  return { slug, sku, categoryId: ids.category };
}

/** Rangement : la catégorie de test est masquée (ses produits disparaissent de la boutique). */
export async function hideTestCategory(categoryId: string): Promise<void> {
  await withClient((client) => client.query(`UPDATE categories SET "isActive" = false WHERE id = $1`, [categoryId]));
}

export async function stockOf(sku: string): Promise<{ onHand: number; reserved: number }> {
  return withClient(async (client) => {
    const { rows } = await client.query(
      `SELECT i."onHand", i.reserved FROM inventories i JOIN product_variants v ON v.id = i."variantId" WHERE v.sku = $1`,
      [sku],
    );
    return rows[0] as { onHand: number; reserved: number };
  });
}
