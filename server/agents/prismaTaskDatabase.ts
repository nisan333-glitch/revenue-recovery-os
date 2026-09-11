import { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "../db";
import {
  PostgresAgentTaskStore,
  type AgentTaskQueryResult,
  type AgentTaskSqlClient,
  type AgentTaskSqlDatabase,
} from "./postgresTaskStore";

class PrismaAgentTaskSqlClient implements AgentTaskSqlClient {
  constructor(private readonly client: Prisma.TransactionClient) {}

  async query<Row extends Record<string, unknown>>(
    text: string,
    values: readonly unknown[],
  ): Promise<AgentTaskQueryResult<Row>> {
    const rows = await this.client.$queryRawUnsafe<Row[]>(text, ...values);
    return { rows, rowCount: rows.length };
  }
}

/**
 * Production adapter: every callback is one Prisma interactive transaction. The task row and
 * its append-only runtime event therefore commit together or roll back together.
 */
export class PrismaAgentTaskSqlDatabase implements AgentTaskSqlDatabase {
  constructor(private readonly client: PrismaClient = prisma) {}

  transaction<T>(work: (client: AgentTaskSqlClient) => Promise<T>): Promise<T> {
    return this.client.$transaction(
      (transaction) => work(new PrismaAgentTaskSqlClient(transaction)),
      { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
    );
  }
}

export function createPostgresAgentTaskStore(
  client: PrismaClient = prisma,
): PostgresAgentTaskStore {
  return new PostgresAgentTaskStore(new PrismaAgentTaskSqlDatabase(client));
}
