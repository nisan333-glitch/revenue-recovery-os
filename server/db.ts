// EP-2 · PrismaClient singleton. PostgreSQL is the authoritative store.
// The connection URL comes from DATABASE_URL (local .env, never committed).
import { PrismaClient, type Prisma } from "@prisma/client";

export const prisma = new PrismaClient();

/**
 * EP-11 · A database handle that may be either the singleton client or an open interactive
 * transaction. Store functions accept this so a caller that must write ATOMICALLY WITH a
 * governance pre-condition (see services/caseGuard.ts) can pass its transaction down, instead
 * of the store opening a second, independent transaction the guard cannot see inside.
 */
export type DbClient = Prisma.TransactionClient;
