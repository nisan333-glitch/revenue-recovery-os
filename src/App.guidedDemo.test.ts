// @vitest-environment jsdom
/// <reference types="node" />
// File-scoped only (not a tsconfig.json "types" change) — needed because this file is the first
// in `src/**` to import `server/**` code, which uses Node builtins `tsc` never previously
// type-checked (tsconfig.json's `include` is `["src"]` only). Every other `src/**` file's ambient
// scope is unaffected.
//
// Mission #010 · Increments 2–3 — Guided Demo (observable customer behaviour).
// Most tests here still render to a string via react-dom/server (no DOM needed) — the jsdom
// environment above is required only by the one EP-9 governed-path test below (client-mounted,
// so it can observe the real async governed `useEffect`); it does not change how the
// string-rendered tests behave.
// Increment 3 strengthens the observable two-ledger guard across the Guided Demo → CFO Proof View path.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createElement } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { RecoveryProvider } from "./state/RecoveryContext";
import { App } from "./App";
import { CFOProofView } from "./modules/CFOProofView";
import { operatorActorFor, APPROVER } from "./data/devActor";
// Loads DATABASE_URL from the repo-root .env if present — same convention used by every
// DB-dependent `server/**` test (server/test/load-env.ts). A pure side-effect import; no
// vite.config.ts change needed.
import "../server/test/load-env";

// Render the CFO Proof View in isolation (inside the real provider) with an optional demo-continuity
// focus, exactly as App passes it — so the marked/unmarked row is observable without a click.
const renderCfo = (focusCaseId?: string) =>
  renderToStaticMarkup(
    createElement(
      RecoveryProvider,
      null,
      focusCaseId ? createElement(CFOProofView, { focusCaseId }) : createElement(CFOProofView),
    ),
  );

const DEMO_MARKER = "From your Guided Demo";
const countOf = (haystack: string, needle: string) => haystack.split(needle).length - 1;

// Render the real App inside the real provider (the provider seeds RE-1014 when storage is absent).
// `module` selects a view via App's optional, additive initialModule seam.
const render = (module?: "demo" | "cfo") =>
  renderToStaticMarkup(
    createElement(
      RecoveryProvider,
      null,
      module ? createElement(App, { initialModule: module }) : createElement(App),
    ),
  );

describe("Mission #010 · Increment 2 — Guided Demo", () => {
  it("shows the Guided Demo navigation entry", () => {
    expect(render()).toContain("Guided Demo — RE-1014");
  });

  it("opening the Guided Demo shows the RE-1014 story on screen (Identify/Fix half)", () => {
    // The governed Prove step (a real approved proof) is verified separately below, through the
    // real backend — a static/SSR render can never observe it (see the EP-9 test below for why).
    const html = render("demo");
    expect(html).toContain("RE-1014"); // the case is on screen
    expect(html).toContain("2600"); // provisional baseline is on screen
    expect(html).toContain("13200"); // collected amount is on screen
  });

  it("keeps forecast and proven revenue visibly separate (never one combined recovered amount)", () => {
    const html = render("demo");
    expect(html).toMatch(/forecast/i); // the recommended play is labelled a forecast
    expect(html).toMatch(/not proven/i); // explicitly not proven revenue
    expect(html).toMatch(/Revenue Returned/i); // proven returned shown as its own, separate concept
    expect(html).toMatch(/never combined/i); // the two are stated never to be combined
  });

  it("offers a CTA that continues to the CFO Proof View", () => {
    expect(render("demo")).toContain("Continue to CFO Proof View");
  });

  it("does not present a single combined forecast+proven 'recovered' total in the demo framing", () => {
    // Observable guard: the framing copy must not merge the ledgers into one headline number.
    expect(render("demo")).not.toMatch(/total recovered/i);
  });
});

// EP-9 · The migrated EventDetail Prove panel sources proof/baseline/evidence data exclusively
// from the real governed backend (never the legacy local trust engine), gated by an explicit,
// visible "Acting as" actor selector — the default actor (Operator) never has AuditRead, so a
// static/SSR render (which never runs `useEffect` at all) can never show a governed proof. This
// suite proves the ORIGINAL guarantee — the Guided Demo visibly demonstrates RE-1014's
// Identify → Fix → Prove story, including its proof id — still holds, but now through the real
// governed path: seed RE-1014 into the real backend exactly as the legacy local seed already
// does (same numbers, same lifecycle), mount the app for real, switch the visible actor to the
// Finance Approver exactly as a real user would, and observe the real async load.
//
// Skips without a reachable, migrated Postgres database — same `describe.skipIf(!HAS_DB)`
// convention as every other DB-dependent suite in this repo (server/**), so the rest of this
// file — and the whole portable `npm run test` suite — stays green without Postgres.
const HAS_DB = !!process.env.DATABASE_URL;

describe.skipIf(!HAS_DB)("EP-9 · Guided Demo Prove panel (real governed backend)", () => {
  let app: import("fastify").FastifyInstance;
  let originalFetch: typeof fetch;

  const CASE_ID = "RE-1014";
  const PROOF_ID = `PF-${CASE_ID}`;
  const OWNER = "Dana Levy";

  beforeAll(async () => {
    const { buildApp } = await import("../server/app");
    app = buildApp();
    await app.ready();

    const author = operatorActorFor(OWNER); // role "operator" — same write permissions as "author"
    const authorHeaders = { "x-actor-id": author.actorId, "x-actor-role": author.role };
    const approverHeaders = { "x-actor-id": APPROVER.actorId, "x-actor-role": APPROVER.role };

    // Exactly mirrors src/data/seedTrust.ts's RE-1014 entry: same amounts, same lifecycle order
    // (author → baseline pre-registered → intervention → evidence → approve), now through the
    // real governed API instead of a local domain-kernel call.
    await app.inject({ method: "POST", url: `/cases/${CASE_ID}/author`, headers: authorHeaders });
    await app.inject({
      method: "POST",
      url: `/cases/${CASE_ID}/baseline`,
      headers: authorHeaders,
      payload: {
        baselineId: `BL-${CASE_ID}`,
        calculatedMinor: 260_000,
        currency: "USD",
        method: "matched_historical_cohort",
        methodVersion: 1,
        sourceRefs: ["cohort:ActivationMissed"],
        effectiveAt: "2026-06-01T09:05:00.000Z",
      },
    });
    await app.inject({ method: "POST", url: `/cases/${CASE_ID}/intervention`, headers: authorHeaders });
    // EP-9.1 fix: confidenceUsed (81) is >= CURRENT_POLICY.proofThreshold (80), so this approval
    // is an auditable-tier claim — the server (server/services/proofService.ts) requires at
    // least one OUTCOME-role evidence reference substantiating the full collected amount for
    // that tier, not merely an independent one. Only billing/invoice_paid|payment_received
    // derive to "outcome" role (server/domain/evidenceRole.ts) — the legacy local seed's
    // product/usage_activation_event reference was never subject to this real server-side gate,
    // only the domain kernel's own trustClassification check, which product/usage-activation
    // still satisfies as "independent". Using the same billing/invoice_paid pattern already
    // relied on by server/test/fixtures.ts's own seedAuditableCase().
    const evidence = await app.inject({
      method: "POST",
      url: `/cases/${CASE_ID}/evidence`,
      headers: authorHeaders,
      payload: {
        evidenceId: `EV-${CASE_ID}-src`,
        sourceSystem: "billing",
        sourceRecordId: "UA-7781",
        evidenceType: "invoice_paid",
        observedAt: "2026-06-02T09:05:00.000Z",
        amountMinor: 1_320_000,
        currency: "USD",
      },
    });
    if (evidence.statusCode !== 201) {
      throw new Error(`demo evidence seed failed: ${evidence.statusCode} ${evidence.body}`);
    }
    const { evidenceId } = evidence.json() as { evidenceId: string };
    const approved = await app.inject({
      method: "POST",
      url: "/proofs",
      headers: approverHeaders,
      payload: {
        proofId: PROOF_ID,
        recoveryCaseId: CASE_ID,
        currency: "USD",
        collectedMinor: 1_320_000,
        excludedRecoveryMinor: 0,
        exclusionStatement:
          "No excluded recovery on this case — asserted: the full delta is supported by the referenced evidence.",
        recoveryReason: "UsageActivation",
        attribution: "In-product usage-activation flow triggered activation; next invoice cleared.",
        evidenceIds: [evidenceId],
        baselineId: `BL-${CASE_ID}`,
        confidenceUsed: 81,
      },
    });
    if (approved.statusCode !== 201) {
      throw new Error(`demo proof seed failed: ${approved.statusCode} ${approved.body}`);
    }

    // Route the app's own, unmodified `apiClient.ts` fetch calls (`/api/...`, relative — normally
    // proxied by the Vite dev server) straight into the real Fastify app via `.inject()`. Zero
    // production source is touched: this is a test-local `globalThis.fetch` override only, torn
    // down in `afterAll`. The request/response still goes through the actual route handlers,
    // schema validation, service layer, and Postgres — the real governed path end to end.
    originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      if (!url.startsWith("/api")) return originalFetch(input, init);
      const injected = await app.inject({
        method: (init?.method ?? "GET") as "GET" | "POST",
        url: url.slice(4),
        headers: (init?.headers ?? {}) as Record<string, string>,
        payload: init?.body ? JSON.parse(init.body as string) : undefined,
      });
      // `.payload` (a string) is used rather than `.rawPayload` (a Node Buffer) — the DOM lib's
      // `Response` constructor's BodyInit type does not accept Buffer, only string/Uint8Array/etc.
      return new Response(injected.payload, {
        status: injected.statusCode,
        headers: injected.headers as HeadersInit,
      });
    }) as typeof fetch;
  });

  afterAll(async () => {
    globalThis.fetch = originalFetch;
    await app.close();
    const { prisma } = await import("../server/db");
    await prisma.$disconnect();
  });

  it("switching to the Finance Approver reveals RE-1014's real governed proof (PF-RE-1014)", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(createElement(RecoveryProvider, null, createElement(App, { initialModule: "demo" })));
    });

    // The "Acting as" selector is the one <select> whose options include "Finance Approver" —
    // located by visible text, not by internal structure/test ids, matching how a real user
    // would find it.
    const selects = Array.from(container.querySelectorAll("select"));
    const actingAsSelect = selects.find((s) => s.innerHTML.includes("Finance Approver"));
    expect(actingAsSelect).toBeTruthy();

    // Native-setter + dispatchEvent: the standard way to drive a React-controlled <select> without
    // a testing-library dependency (React tracks the native value setter, not a raw property set).
    const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, "value")!.set!;
    await act(async () => {
      nativeSetter.call(actingAsSelect!, "approver");
      actingAsSelect!.dispatchEvent(new Event("change", { bubbles: true }));
      // Bounded poll, not a fixed tick count: the effect's async governed.loadCaseTrust fires
      // four parallel real requests (through the fetch shim -> app.inject() -> Postgres) whose
      // real I/O latency in CI is not something two fixed setTimeout(…, 0) ticks can guarantee
      // to outlast. Polls every 25ms up to 5s; if the state never lands, the assertion below
      // fails with a clear, honest message instead of a flaky pass/fail on timing alone.
      const deadline = Date.now() + 5000;
      while (!container.innerHTML.includes(PROOF_ID) && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
    });

    expect(container.innerHTML).toContain(PROOF_ID); // PF-RE-1014, read from the real audit trail

    root.unmount();
    container.remove();
  });
});

describe("Mission #010 · Increment 3 — observable two-ledger guard across the demo → CFO path", () => {
  it("makes the recovery figures observable: baseline, collected, and Revenue Returned", () => {
    const html = render("demo");
    expect(html).toContain("2600"); // governed baseline is shown ($2,600)
    expect(html).toContain("13200"); // the collected second invoice is shown ($13,200)
    expect(html).toMatch(/10[,.]?600/); // Revenue Returned is shown ($10,600 = collected − baseline)
  });

  it("shows the auditable status for the recovery", () => {
    // Proven-and-auditable is stated where the customer can see it (the proof status banner).
    expect(render("demo")).toMatch(/auditable/i);
  });

  it("shows proof approval as visibly independent from case ownership (no self-approval)", () => {
    const html = render("demo");
    expect(html).toMatch(/distinct from owner/i); // approval is stated to come from a separate authority
    expect(html).toContain("Dana Levy"); // the case owner/beneficiary is shown, distinct from the approver
  });

  it("labels the forecast / at-risk figure separately from proven Revenue Returned", () => {
    const html = render("demo");
    expect(html).toMatch(/at risk|detected risk|opportunity|forecast/i); // forecast/opportunity is labelled
    expect(html).toMatch(/Revenue Returned/i); // proven returned is its own labelled figure
    expect(html).not.toMatch(/total recovered/i); // and the two are never merged into one total
  });

  it("continuing to the CFO Proof View shows the proven auditable recovery, with no forecast merged in", () => {
    const html = render("cfo");
    expect(html).toContain("PF-RE-1014"); // the auditable proof for the case appears in the CFO ledger
    expect(html).not.toMatch(/total recovered/i); // the proof view never merges forecast into recovered
  });
});

describe("Mission #010 · Increment 4 — Guided Demo → CFO Proof continuity", () => {
  it("the Guided Demo names the case and its proven Revenue Returned at the handoff", () => {
    const html = render("demo");
    expect(html).toContain("RE-1014"); // the case being handed off is named
    expect(html).toMatch(/Revenue Returned/i); // its proven figure is named (not the forecast)
    expect(html).toMatch(/10[,.]?600/); // the proven amount comes from context ($10,600)
  });

  it("marks exactly one CFO proof row — the one for the demo case — when opened from the demo", () => {
    const html = renderCfo("RE-1014");
    expect(html).toContain(DEMO_MARKER); // the demo case's proof row is visibly marked
    expect(countOf(html, DEMO_MARKER)).toBe(1); // and only that one row is marked, not another
    expect(html).toContain("PF-RE-1014"); // the marked ledger still shows the case's proof
  });

  it("shows no demo marker on direct CFO navigation (isolated component)", () => {
    expect(renderCfo()).not.toContain(DEMO_MARKER);
  });

  it("shows no demo marker when the CFO view is reached by direct navigation in the app", () => {
    // initialModule="cfo" is direct navigation (not the demo CTA), so App passes no focus.
    expect(render("cfo")).not.toContain(DEMO_MARKER);
  });

  it("marking a proof row never merges forecast into the proven total", () => {
    expect(renderCfo("RE-1014")).not.toMatch(/total recovered/i);
  });
});
