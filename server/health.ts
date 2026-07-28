// EP-3 · Readiness probe. Lives in the persistence layer so route handlers never
// touch Prisma directly. A simple round-trip confirms database connectivity.
import { prisma } from "./db";

export async function isDbReady(): Promise<boolean> {
  try {
    await prisma.$queryRawUnsafe("SELECT 1");
    return true;
  } catch {
    return false;
  }
}
