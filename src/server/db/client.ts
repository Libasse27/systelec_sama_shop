import "server-only";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, type Prisma } from "@/generated/prisma/client";
import { getServerEnv } from "@/lib/env";

/** Client Prisma ou client de transaction : les services acceptent les deux. */
export type Db = PrismaClient | Prisma.TransactionClient;

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

/**
 * Réserve de connexions. Mesuré au test de charge (phase 10) : avec les réglages par défaut de pg,
 * les connexions inactives étaient fermées après 10 s puis rouvertes en continu, chaque ouverture
 * refaisant la résolution DNS de l'hôte (service « db » sous Docker) ; sous charge, ces résolutions
 * échouaient parfois et bloquaient une requête jusqu'à près d'une minute.
 */
const POOL_IDLE_TIMEOUT_MS = 5 * 60_000;
/** Une requête qui n'obtient pas de connexion échoue vite (erreur 500 journalisée) au lieu d'attendre sans fin. */
const POOL_CONNECTION_TIMEOUT_MS = 10_000;

function createClient(): PrismaClient {
  const env = getServerEnv();
  const adapter = new PrismaPg({
    connectionString: env.DATABASE_URL,
    max: env.DATABASE_POOL_MAX,
    idleTimeoutMillis: POOL_IDLE_TIMEOUT_MS,
    connectionTimeoutMillis: POOL_CONNECTION_TIMEOUT_MS,
  });
  return new PrismaClient({ adapter });
}

export const db: PrismaClient = globalForPrisma.prisma ?? createClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = db;
}
