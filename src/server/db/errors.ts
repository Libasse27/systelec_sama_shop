import { Prisma } from "@/generated/prisma/client";

/** Violation d'une contrainte d'unicité (P2002), par exemple une clé d'idempotence rejouée en parallèle. */
export const isUniqueViolation = (error: unknown): boolean => error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
