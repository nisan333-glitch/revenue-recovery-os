// EP-2 · PrismaClient singleton. PostgreSQL is the authoritative store.
// The connection URL comes from DATABASE_URL (local .env, never committed).
import { PrismaClient } from "@prisma/client";

export const prisma = new PrismaClient();
