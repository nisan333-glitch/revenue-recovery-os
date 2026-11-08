// The two live-provider blockers, and the synthetic end-to-end path they gate.
//
// WHAT A SYNTHETIC END-TO-END TEST CAN AND CANNOT ESTABLISH, said first because it bounds everything below.
// It exercises the whole sequence — identity, deduplication, the pre-spend reservation, the rate limit, the
// breaker, the approval gate, the output contract and the record — against an injected stub. It establishes
// NOTHING about what a real provider would answer. The live call has never run.
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  credentialBlocker, liveReadiness, LIVE_HOST, LIVE_KEY_ENV, networkBlocker, renderLiveReadiness,
  type ProbeResult,
} from "./liveReadiness.ts";
import { probeLiveHost } from "./probeHost.ts";
import { runOrchestratorCommand } from "./command.ts";
import { StubModelPort, stubOk } from "./stubPort.ts";
import { runTask, submit, EMPTY_STATE } from "./orchestrator.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const T0 = new Date("2026-11-08T12:00:00.000Z");
const reachable: ProbeResult = { state: "REACHABLE", detail: "the host answered with HTTP 401" };
const blocked: ProbeResult = { state: "BLOCKED_BY_POLICY", detail: "no credential was sent; ENOTFOUND" };
const unprobed: ProbeResult = { state: "NOT_PROBED", detail: "no reachability probe was run" };

describe("the two blockers are INDEPENDENT and reported separately", () => {
  it("all four combinations are distinguishable, and only one permits the live call", () => {
    const key = { [LIVE_KEY_ENV]: "sk-test-value" };
    const both = liveReadiness(key, reachable);
    expect(both.liveCallPossible).toBe(true);
    expect(both.credential.blocked).toBe(false);
    expect(both.network.blocked).toBe(false);

    const noKey = liveReadiness({}, reachable);
    expect(noKey.liveCallPossible).toBe(false);
    expect(noKey.credential.blocked).toBe(true);
    // THE POINT OF THE SEPARATION: the network is still reported as CLEAR, so whoever reads this knows
    // which half to fix. A single boolean would have hidden it.
    expect(noKey.network.blocked).toBe(false);

    const noNet = liveReadiness(key, blocked);
    expect(noNet.liveCallPossible).toBe(false);
    expect(noNet.credential.blocked).toBe(false);
    expect(noNet.network.blocked).toBe(true);

    const neither = liveReadiness({}, blocked);
    expect(neither.liveCallPossible).toBe(false);
    expect(neither.credential.blocked).toBe(true);
    expect(neither.network.blocked).toBe(true);
  });

  it("NOT_PROBED is not BLOCKED — an unmeasured network is the absence of a measurement", () => {
    const r = liveReadiness({ [LIVE_KEY_ENV]: "k" }, unprobed);
    expect(r.network.state).toBe("NOT_PROBED");
    // It still prevents the live call, because we have not shown the host is reachable...
    expect(r.liveCallPossible).toBe(false);
    // ...but its remedy is "run the probe", not "change the policy". The two states stay distinguishable.
    expect(r.network.remedy).toContain("Run the probe");
    expect(networkBlocker(blocked).remedy).toContain("network policy");
  });

  it("each blocker names WHOSE action clears it, because they are different owners", () => {
    expect(credentialBlocker({}).ownedBy).toBe("owner");
    expect(networkBlocker(blocked).ownedBy).toBe("owner");
    expect(credentialBlocker({ [LIVE_KEY_ENV]: "k" }).ownedBy).toBe("nobody");
    expect(networkBlocker(reachable).ownedBy).toBe("nobody");
  });

  it("the credential hint is a LENGTH and never a prefix, and no value reaches a rendered line", () => {
    const secret = "sk-live-DO-NOT-LEAK-abcdefghijklmnop";
    const r = liveReadiness({ [LIVE_KEY_ENV]: secret }, reachable);
    const rendered = renderLiveReadiness(r).join("\n");
    expect(rendered).not.toContain(secret);
    expect(rendered).not.toContain(secret.slice(0, 8));
    expect(rendered).not.toContain(secret.slice(-4));
    expect(r.credential.detail).toContain(`length ${secret.length}`);
  });
});

describe("the probe sends no credential and bypasses nothing", () => {
  it("STRUCTURAL: the probe module names no credential and sets no header", () => {
    const code = readFileSync(resolve(HERE, "probeHost.ts"), "utf8")
      .replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
    for (const forbidden of [LIVE_KEY_ENV, "authorization", "Authorization", "Bearer", "apiKey", "headers"]) {
      expect(code, forbidden).not.toContain(forbidden);
    }
    // And nothing that would route around the egress path.
    for (const forbidden of ["HTTPS_PROXY", "NODE_TLS_REJECT_UNAUTHORIZED", "rejectUnauthorized", "Agent("]) {
      expect(code, forbidden).not.toContain(forbidden);
    }
  });

  it("an HTTP answer of any status means REACHABLE — a 401 to an unauthenticated probe is success", async () => {
    const r = await probeLiveHost((async () => ({ status: 401 }) as unknown as Response) as unknown as typeof fetch);
    expect(r.state).toBe("REACHABLE");
    expect(r.detail).toContain("401");
  });

  it("the CAUSE CHAIN is reported, not the top message", async () => {
    // The defect this fixes: Node's fetch says only `TypeError: fetch failed` and puts the real reason in
    // `cause`, so the first form of the probe classified a DNS refusal on a message that said nothing.
    const wrapped = new TypeError("fetch failed");
    (wrapped as { cause?: unknown }).cause = Object.assign(new Error("getaddrinfo ENOTFOUND api.openai.com"), { code: "ENOTFOUND" });
    const r = await probeLiveHost((() => { throw wrapped; }) as unknown as typeof fetch);
    expect(r.state).toBe("BLOCKED_BY_POLICY");
    expect(r.detail).toContain("ENOTFOUND");
    expect(r.detail).toContain("no credential was sent");
  });

  it("an unrecognised failure stays UNREACHABLE_OTHER rather than being guessed into a category", async () => {
    const r = await probeLiveHost((() => { throw new Error("socket hang up mid-stream"); }) as unknown as typeof fetch);
    expect(r.state).toBe("UNREACHABLE_OTHER");
  });
});

describe("the synthetic end-to-end run, and what it is labelled as", () => {
  it("runs the whole sequence against the stub and records what answered", async () => {
    const port = new StubModelPort([stubOk("synthetic end-to-end answer", ["no live provider was contacted"])]);
    const s1 = submit(
      EMPTY_STATE,
      { spec: { kind: "e2e-synthetic", prompt: "summarise the open blockers", parentId: null, context: {} }, submittedBy: "claude-code" },
      T0,
    );
    expect(s1.result.outcome).toBe("accepted");
    const run = await runTask(s1.state, s1.result.taskId!, port, T0);
    expect(run.outcome.kind).toBe("succeeded");
    const call = Object.values(run.state.calls)[0]!;
    // THE RECORD SAYS A STUB ANSWERED. A stub run can never be mistaken for a live one afterwards.
    expect(call.implementation).toBe("stub-scripted");
    expect(call.provider).toBe("stub");
    expect(call.channel).toBe("openai-api");
    expect(call.finding?.trust).toBe("UNTRUSTED_MODEL_OUTPUT");
    expect(port.callCount).toBe(1);
  });

  it("the command prints BOTH blockers and the bound on what a stub run proves", async () => {
    const cmd = await runOrchestratorCommand(
      ["run", "--prompt", "x"], {}, T0, new StubModelPort([stubOk("ok")]), blocked,
    );
    const text = cmd.lines.join("\n");
    expect(text).toContain("LIVE PROVIDER READINESS");
    expect(text).toContain("CREDENTIAL: BLOCKED");
    expect(text).toContain("NETWORK: BLOCKED");
    expect(text).toContain("A stub run is never a live run");
    expect(text).toContain(LIVE_HOST);
  });

  it("with both blockers clear the readiness says YES — so the gate is not hardcoded to NO", async () => {
    // THE CONTROL. Without it the tests above would be consistent with a readiness that can only ever
    // refuse, and a gate that cannot pass is not a gate.
    const r = liveReadiness({ [LIVE_KEY_ENV]: "sk-test" }, reachable);
    expect(r.liveCallPossible).toBe(true);
    expect(renderLiveReadiness(r).join("\n")).toContain("live call possible: YES");
  });
});
