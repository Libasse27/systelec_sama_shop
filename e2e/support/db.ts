import { Client } from "pg";
import { resolveE2eDatabaseUrl } from "./database-guard";

// Même base que le serveur testé : la base E2E dédiée, vérifiée (jamais la base de développement).
const DATABASE_URL = resolveE2eDatabaseUrl();

/** Attribue un rôle du personnel à un compte de test (équivalent d'une action d'administration). */
export async function grantRole(email: string, roleCode: string): Promise<void> {
  const client = new Client({ connectionString: DATABASE_URL });
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
  const client = new Client({ connectionString: DATABASE_URL });
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

/** Valeur brute du paramètre « company » de la base E2E (null : jamais enregistré). */
export async function readCompanySetting(): Promise<unknown> {
  return withClient(async (client) => {
    const { rows } = await client.query(`SELECT value FROM site_settings WHERE key = 'company'`);
    return rows[0]?.value ?? null;
  });
}

/**
 * Écrit (ou retire si null) le paramètre « company » de la base E2E, sans passer par la validation :
 * simule une donnée historique, puis restaure exactement la valeur d'origine en fin de test.
 */
export async function writeCompanySetting(value: unknown): Promise<void> {
  await withClient(async (client) => {
    if (value === null) {
      await client.query(`DELETE FROM site_settings WHERE key = 'company'`);
      return;
    }
    await client.query(
      `INSERT INTO site_settings (key, value, "updatedAt") VALUES ('company', $1::jsonb, now())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, "updatedAt" = now()`,
      [JSON.stringify(value)],
    );
  });
}

/** Clé du verrou E2E (distincte de celle de l'application, « settings:company », qui ne doit jamais attendre). */
const COMPANY_SETTING_E2E_LOCK = "e2e:site_settings:company";
/** Attente maximale du verrou : inférieure au délai par défaut d'un test (30 s), l'échec reste explicite. */
const LOCK_WAIT_MS = 20_000;
const LOCK_POLL_MS = 100;
/**
 * Filet de sécurité côté serveur : une connexion de verrou restée inactive plus longtemps que le plus long
 * test (240 s) est fermée par PostgreSQL, ce qui libère le verrou même si le processus de test l'a perdue.
 */
const LOCK_IDLE_SESSION_TIMEOUT = "600s";
const RESTORE_ATTEMPTS = 2;

export interface CompanySettingGuard {
  /** Valeur brute d'origine (null : paramètre jamais enregistré). */
  original: unknown;
  /** Restaure exactement la valeur d'origine, la vérifie, puis libère toujours le verrou. */
  restore(): Promise<void>;
}

async function closeQuietly(client: Client): Promise<void> {
  await client.end().catch(() => undefined);
}

/** Prend le verrou sans attente illimitée : essais répétés jusqu'à LOCK_WAIT_MS, puis erreur explicite. */
async function acquireLock(lock: Client): Promise<void> {
  const deadline = Date.now() + LOCK_WAIT_MS;
  for (;;) {
    const { rows } = await lock.query<{ locked: boolean }>(`SELECT pg_try_advisory_lock(hashtext($1)) AS locked`, [COMPANY_SETTING_E2E_LOCK]);
    if (rows[0]?.locked) return;
    if (Date.now() >= deadline) throw new Error(`Paramètre « company » E2E : verrou toujours occupé après ${LOCK_WAIT_MS / 1000} s.`);
    await new Promise((resolve) => setTimeout(resolve, LOCK_POLL_MS));
  }
}

/** Écrit la valeur d'origine puis la relit ; un second essai couvre une erreur passagère. */
async function restoreExactly(original: unknown): Promise<void> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= RESTORE_ATTEMPTS; attempt += 1) {
    try {
      await writeCompanySetting(original);
      if (JSON.stringify(await readCompanySetting()) === JSON.stringify(original)) return;
      lastError = new Error("valeur relue différente de la valeur d'origine");
    } catch (error) {
      lastError = error;
    }
  }
  const reason = lastError instanceof Error ? lastError.message : String(lastError);
  // Valeur d'origine jointe : restauration manuelle possible dans la base E2E.
  throw new Error(`Paramètre « company » E2E : restauration impossible (${reason}). Valeur d'origine : ${JSON.stringify(original)}`);
}

/**
 * Isolement d'un test qui modifie le paramètre partagé « company » : verrou de session PostgreSQL (tous
 * les tests concernés, même dans des fichiers et des processus différents, s'exécutent l'un après
 * l'autre), puis instantané de la valeur brute. À appeler dans beforeEach, `restore` dans afterEach
 * (exécuté même en cas d'échec ou de dépassement du délai du test). Le verrou est libéré dans tous les
 * cas : restauration réussie ou non, erreur pendant l'initialisation, connexion coupée, fin du processus.
 */
export async function guardCompanySetting(): Promise<CompanySettingGuard> {
  const lock = new Client({ connectionString: DATABASE_URL, application_name: "e2e-company-setting-lock" });
  // Connexion coupée par le serveur : erreur absorbée (sinon le processus de test s'arrête), le verrou
  // disparaît avec la session.
  lock.on("error", () => undefined);
  await lock.connect();
  try {
    await lock.query(`SET idle_session_timeout = '${LOCK_IDLE_SESSION_TIMEOUT}'`);
    await acquireLock(lock);
    const original = await readCompanySetting();
    let released = false;
    return {
      original,
      async restore() {
        if (released) return;
        released = true;
        try {
          await restoreExactly(original);
        } finally {
          // Fermer la session libère le verrou (pas besoin de pg_advisory_unlock).
          await closeQuietly(lock);
        }
      },
    };
  } catch (error) {
    await closeQuietly(lock);
    throw error;
  }
}
