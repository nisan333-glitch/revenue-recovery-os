// Regression falsifiers for CI run 42421190355: importing the inbox command must not run a CLI, must not
// exit the process, and real errors must still end with a failing code.
//
// WHAT THE ORIGINAL DEFECT WAS. `inbox.test.ts` imported `toInboxComment` from `coordination-inbox.ts`,
// whose `main()` ran at module scope. Two CI jobs failed with `process.exit unexpectedly called with "3"`
// at `coordination-inbox.ts:137` while all 1705 tests PASSED. The tests were never wrong; the import was.
//
// WHY THE ENTRY POINT IS GUARDED STRUCTURALLY AND NOT BEHAVIOURALLY. There is no test that can import
// `coordination-inbox.ts` and assert it did nothing, because running is exactly what an entry point is for:
// such a test would reintroduce the defect it claims to prevent. So the guard reads IMPORT SPECIFIERS
// across the repository and asserts nothing imports it — a prose mention is not an import and a string
// literal is not a dependency, which is the form this repository has settled on after twelve instances of
// getting it wrong.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, extname, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { bodyHash, formatMessageComment } from "./wire.ts";
import { MSG_SCHEMA, type Message } from "./bridge.ts";
import { INBOX_STDIN_SHAPE_ERROR, INBOX_USAGE, runInboxCommand } from "./inboxCommand.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../..");
const ENTRY = "coordination-inbox.ts";
const CLI_PATH = join("scripts", "coordination", ENTRY);

const deps = (over: Partial<Parameters<typeof runInboxCommand>[2]> = {}) => ({
  fetchImpl: (() => {
    throw new Error("fetch must not be called");
  }) as unknown as typeof fetch,
  readStdin: () => {
    throw new Error("stdin must not be read");
  },
  ...over,
});

/** A real `nh-msg` comment row, built through the production formatter so the body hash is genuine. */
function messageRow(id: number, messageId: string, body: string) {
  const message: Message = {
    schema: MSG_SCHEMA,
    id: messageId,
    from: "claude-code",
    to: "owner",
    in_reply_to: null,
    body_sha256: bodyHash(body),
    created_at: "2026-11-08T02:00:00Z",
    expires_at: "2026-11-08T08:00:00Z",
  };
  return { id, created_at: "2026-11-08T02:00:00Z", user: { login: "nisan333-glitch" }, body: formatMessageComment(message, body) };
}

function receiptRow(id: number, messageId: string, body: string) {
  const json = JSON.stringify(
    { schema: "nh-ledger-receipt/v1", generated_by: "github-actions", kind: "message_recorded",
      comment_id: id - 1, message_id: messageId, body_sha256: bodyHash(body), errors: [],
      decided_at: "2026-11-08T02:00:09Z" }, null, 2,
  );
  return {
    id, created_at: "2026-11-08T02:00:09Z", user: { login: "github-actions[bot]" },
    body: `<!-- nh-ledger-receipt:comment:${id - 1} -->\n\n\`\`\`nh-ledger-receipt\n${json}\n\`\`\``,
  };
}

describe("importing the command module runs nothing", () => {
  it("importing it in a clean process prints nothing and exits 0", () => {
    // IN A SEPARATE PROCESS, deliberately. A test that imported the ENTRY POINT to prove it harmless would
    // reintroduce the defect it claims to prevent, so import-safety is established where running is visible
    // as output rather than as a suite failure. The probe takes its target from argv and favours nothing.
    const probe = join("scripts", "coordination", "probe", "import-probe.ts");
    const r = execFileSync("npx", ["vite-node", probe, resolve(HERE, "inboxCommand.ts")], {
      cwd: ROOT, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"], env: { ...process.env },
    });
    expect(r.trim()).toBe("IMPORTED_CLEANLY");
    expect(r).not.toContain(INBOX_USAGE);
    expect(r).not.toContain("NH_INTERNAL_ERROR");
  }, 60_000);

  it("the same probe on the ENTRY POINT does run it — which is why no test may import it", () => {
    // The control that makes the test above meaningful. If importing the entry point were also silent, the
    // probe would be proving nothing about either module. A test that cannot fail is not a control.
    const probe = join("scripts", "coordination", "probe", "import-probe.ts");
    let status = 0;
    let stderr = "";
    try {
      execFileSync("npx", ["vite-node", probe, join(ROOT, CLI_PATH)], {
        cwd: ROOT, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"], env: { ...process.env },
      });
    } catch (err) {
      const e = err as { status: number | null; stderr?: string };
      status = e.status ?? -1;
      stderr = e.stderr ?? "";
    }
    // It ran main(), hit the usage branch and exited 2 — never reaching the probe's own success line.
    expect(status).toBe(2);
    expect(stderr).toContain(INBOX_USAGE);
  }, 60_000);

  it("STRUCTURAL: nothing in the repository imports the entry point", () => {
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const name of readdirSync(dir)) {
        if (name === "node_modules" || name === ".git" || name === "dist" || name === "dist-server") continue;
        const p = join(dir, name);
        if (statSync(p).isDirectory()) {
          walk(p);
          continue;
        }
        if (![".ts", ".tsx", ".mts", ".mjs", ".js"].includes(extname(name))) continue;
        if (p.endsWith(join("scripts", "coordination", ENTRY))) continue;
        const src = readFileSync(p, "utf8");
        // IMPORT SPECIFIERS ONLY. A prose mention of the filename is not a dependency on it, and this very
        // file names it several times in comments.
        const specs = [
          ...src.matchAll(/(?:from|import)\s*\(?\s*["']([^"']+)["']/g),
          ...src.matchAll(/require\(\s*["']([^"']+)["']\s*\)/g),
        ].map((m) => m[1]!);
        if (specs.some((s) => s.replace(/\.ts$/, "").endsWith("coordination-inbox"))) {
          offenders.push(p.slice(ROOT.length + 1));
        }
      }
    };
    walk(join(ROOT, "scripts"));
    walk(join(ROOT, "src"));
    walk(join(ROOT, "server"));
    walk(join(ROOT, "e2e"));
    expect(offenders).toEqual([]);
  });

  it("STRUCTURAL: the entry point holds the I/O and the command module holds none", () => {
    // COMMENTS STRIPPED FIRST. The first form of this check counted `process.exit` three times in a file
    // containing it once, because the header explains the defect and names it twice. A term is not a claim
    // and a prose mention is not code — the thirteenth recorded instance in this repository.
    const strip = (s: string): string => s.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
    const entry = strip(readFileSync(join(ROOT, CLI_PATH), "utf8"));
    const command = strip(readFileSync(join(HERE, "inboxCommand.ts"), "utf8"));
    // One exit, and it is not inside a `.catch()` — the shape that made the original failure unhandled.
    expect(entry.match(/process\.exit/g) ?? []).toHaveLength(1);
    expect(entry).not.toMatch(/\.catch\([\s\S]*process\.exit/);
    for (const forbidden of ["process.exit", "process.argv", "process.stdout", "process.stderr", "process.env"]) {
      expect(command).not.toContain(forbidden);
    }
  });
});

describe("the command's exit codes, unit level", () => {
  it("a missing or malformed issue number is a usage error, code 2", async () => {
    for (const argv of [[], ["0"], ["-3"], ["nonsense"], ["1.5"]]) {
      const r = await runInboxCommand(argv, {}, deps());
      expect(r.exitCode).toBe(2);
      expect(r.errLines).toEqual([INBOX_USAGE]);
      expect(r.lines).toEqual([]);
    }
  });

  it("--stdin given something that is not an array is code 2", async () => {
    const r = await runInboxCommand(["18", "--stdin"], {}, deps({ readStdin: () => '{"not":"an array"}' }));
    expect(r.exitCode).toBe(2);
    expect(r.errLines).toEqual([INBOX_STDIN_SHAPE_ERROR]);
  });

  it("no comments examined is code 2 — never a healthy 0", async () => {
    const r = await runInboxCommand(["18", "--stdin"], {}, deps({ readStdin: () => "[]" }));
    expect(r.exitCode).toBe(2);
  });

  it("a matched message is code 0 and an unmatched one is code 1", async () => {
    const body = "a body whose text must never be printed";
    const matched = JSON.stringify([messageRow(1, "m-ok", body), receiptRow(2, "m-ok", body)]);
    const ok = await runInboxCommand(["18", "--stdin"], {}, deps({ readStdin: () => matched }));
    expect(ok.exitCode).toBe(0);

    const unmatched = JSON.stringify([messageRow(1, "m-lost", body)]);
    const bad = await runInboxCommand(["18", "--stdin"], {}, deps({ readStdin: () => unmatched }));
    expect(bad.exitCode).toBe(1);
    expect(bad.lines.join("\n")).toContain("UNHANDLED m-lost");
    // READ BODIES, REPORT NONE.
    expect(bad.lines.join("\n")).not.toContain(body);
  });

  it("a missing token is code 3 and never reaches the network", async () => {
    let called = 0;
    const r = await runInboxCommand(["18"], {}, deps({
      fetchImpl: (() => {
        called += 1;
        throw new Error("should not be reached");
      }) as unknown as typeof fetch,
    }));
    expect(r.exitCode).toBe(3);
    expect(r.errLines[0]).toContain("missing environment variable GH_TOKEN");
    expect(called).toBe(0);
  });

  it("a GitHub refusal is code 3 with the status named, and stops paging", async () => {
    let calls = 0;
    const r = await runInboxCommand(["18"], { GH_TOKEN: "t" }, deps({
      fetchImpl: (async () => {
        calls += 1;
        return { ok: false, status: 403, json: async () => [] } as unknown as Response;
      }) as unknown as typeof fetch,
    }));
    expect(r.exitCode).toBe(3);
    expect(r.errLines[0]).toBe("NH_INTERNAL_ERROR — GitHub returned 403 for issue #18 comments");
    expect(calls).toBe(1);
  });

  it("the token is never placed in a returned line", async () => {
    const secret = "ghp-DO-NOT-LEAK-0123456789";
    const r = await runInboxCommand(["18"], { GH_TOKEN: secret }, deps({
      fetchImpl: (async () => ({ ok: false, status: 401, json: async () => [] }) as unknown as Response) as unknown as typeof fetch,
    }));
    expect([...r.lines, ...r.errLines].join("\n")).not.toContain(secret);
  });
});

describe("the real entry point, as a subprocess", () => {
  const run = (args: readonly string[], input: string | undefined, env: Record<string, string>) => {
    try {
      const stdout = execFileSync("npx", ["vite-node", CLI_PATH, ...args], {
        cwd: ROOT,
        input: input ?? "",
        encoding: "utf8",
        stdio: ["pipe", "pipe", "pipe"],
        env: { ...process.env, ...env },
      });
      return { status: 0, stdout, stderr: "" };
    } catch (err) {
      const e = err as { status: number | null; stdout?: string; stderr?: string };
      return { status: e.status ?? -1, stdout: e.stdout ?? "", stderr: e.stderr ?? "" };
    }
  };

  it("exits 2 on a usage error, with the usage on stderr and no unhandled rejection", () => {
    const r = run([], "", {});
    expect(r.status).toBe(2);
    expect(r.stderr).toContain(INBOX_USAGE);
    // The original defect's fingerprint must not appear.
    expect(`${r.stdout}${r.stderr}`).not.toContain("unexpectedly called");
    expect(`${r.stdout}${r.stderr}`).not.toContain("Unhandled");
  }, 60_000);

  it("exits 1 on an unhandled message and 0 on a matched one", () => {
    const body = "subprocess body text";
    const unmatched = run(["18", "--stdin"], JSON.stringify([messageRow(1, "m-sub", body)]), {});
    expect(unmatched.status).toBe(1);
    expect(unmatched.stdout).toContain("UNHANDLED m-sub");
    expect(unmatched.stdout).not.toContain(body);

    const matched = run(["18", "--stdin"], JSON.stringify([messageRow(1, "m-sub", body), receiptRow(2, "m-sub", body)]), {});
    expect(matched.status).toBe(0);
  }, 120_000);

  it("exits 3 when the token is missing, and says so without a stack", () => {
    const r = run(["18"], "", { GH_TOKEN: "" });
    expect(r.status).toBe(3);
    expect(r.stderr).toContain("NH_INTERNAL_ERROR — missing environment variable GH_TOKEN");
  }, 60_000);
});
