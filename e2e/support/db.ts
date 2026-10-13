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
