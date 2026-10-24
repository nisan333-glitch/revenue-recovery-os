// `npm run bridge:webhook-receiver` — run the authenticated inbound event receiver.
//
// For the two-receivers distinction see the header of `webhookReceiver.ts`.
//
// THIS FILE IS THE EDGE: the port, the secret's single entry point from the environment, and the exit
// code. Every decision lives in `receiver.ts`, which binds nothing on import so it can be driven by
// `receiver.test.ts` against a real socket it opens itself.
//
// THE OWNER DEPENDENCY, STATED AT STARTUP AND NOT ONLY IN A DOC. GitHub delivers webhooks by calling a
// PUBLICLY REACHABLE URL. This process listens on a local port and nothing in this repository can give it
// a public address, so until an owner provides a reachable host and creates a webhook with a secret, the
// polling endpoint is what actually moves messages. The process prints that every time it starts.
import { startReceiver } from "./webhookReceiver.ts";

function arg(name: string, fallback: string | null = null): string | null {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1]! : fallback;
}

function main(): number {
  // THE ONLY PLACE THE SECRET ENTERS THE PROCESS. Absent is a refusal to start, never a receiver that
  // accepts everything: an unauthenticated receiver is an open injection point into the coordination
  // ledger, and that is the single most likely misconfiguration.
  const secret = process.env.NH_BRIDGE_WEBHOOK_SECRET ?? "";
  if (secret === "") {
    console.error("receiver: NH_BRIDGE_WEBHOOK_SECRET is not set. Refusing to start an unauthenticated receiver.");
    return 2;
  }
  const port = Number.parseInt(arg("port", "8787")!, 10);
  if (!Number.isSafeInteger(port) || port <= 0) {
    console.error("receiver: --port must be a positive integer");
    return 2;
  }
  const path = arg("path", "/nh-bridge")!;
  const inboxPath = arg("inbox", ".nh-bridge/inbox.jsonl")!;

  const server = startReceiver({ secret, inboxPath, path });
  server.on("error", (err: Error) => {
    console.error(`receiver: could not listen on port ${port} — ${err.message}`);
    process.exit(1);
  });
  server.listen(port, () => {
    // Neither the secret nor its LENGTH is printed: a length narrows a brute force.
    console.log(`receiver: listening on port ${port} at ${path}, inbox ${inboxPath}`);
    console.log("receiver: GitHub must be able to reach this URL publicly for webhook delivery.");
    console.log("receiver: until an owner wires that, the polling endpoint is what moves messages.");
  });
  return 0;
}

const code = main();
if (code !== 0) process.exit(code);
