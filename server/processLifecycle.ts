import type { FastifyInstance } from "fastify";
import type { AgentProcess } from "./agents/bootstrap";

export function installGracefulShutdown(
  app: FastifyInstance,
  agents: AgentProcess,
  runtime: Pick<NodeJS.Process, "once" | "removeListener" | "exit"> = process,
  shutdownTimeoutMs = 30_000,
): () => void {
  if (!Number.isSafeInteger(shutdownTimeoutMs) || shutdownTimeoutMs <= 0) {
    throw new Error("shutdownTimeoutMs must be a positive safe integer");
  }
  let shutdown: Promise<void> | null = null;
  const onSignal = (): void => {
    shutdown ??= withTimeout(closeInOrder(app, agents), shutdownTimeoutMs).then(
      () => runtime.exit(0),
      (error) => {
        console.error(error);
        runtime.exit(1);
      },
    );
  };

  runtime.once("SIGTERM", onSignal);
  runtime.once("SIGINT", onSignal);
  return () => {
    runtime.removeListener("SIGTERM", onSignal);
    runtime.removeListener("SIGINT", onSignal);
  };
}

async function withTimeout(work: Promise<void>, timeoutMs: number): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`graceful shutdown exceeded ${timeoutMs}ms`)), timeoutMs);
    timer.unref();
  });
  try {
    await Promise.race([work, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function closeInOrder(app: Pick<FastifyInstance, "close">, agents: AgentProcess): Promise<void> {
  // Stop new claims first. AgentWorker waits for the current fenced runtime call, then HTTP closes.
  let drainError: unknown;
  try {
    await agents.stop();
  } catch (error) {
    drainError = error;
  }
  try {
    await app.close();
  } catch (closeError) {
    if (drainError) throw new AggregateError([drainError, closeError], "agent drain and HTTP close failed");
    throw closeError;
  }
  if (drainError) throw drainError;
}
