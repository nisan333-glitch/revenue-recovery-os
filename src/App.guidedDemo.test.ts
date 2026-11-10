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
  let originalActEnvironment: unknown;

  // RE-1014 is the REFUSAL demonstration; RE-1015 carries the proof. Two cases, deliberately.
  const CASE_ID = "RE-1014";
  const PROOF_ID = `PF-${CASE_ID}`;
  const PROVEN_CASE_ID = "RE-1015";
  const PROVEN_PROOF_ID = `PF-${PROVEN_CASE_ID}`;
  const OWNER = "Dana Levy";
  /** The 403 body the governed route returns for RE-1014, captured so the tests read the real words. */
  let refusalBody = "";

  beforeAll(async () => {
    // Without this, React logs "The current testing environment is not configured to support
    // act(...)" and does not reliably flush state updates driven by real async I/O (the fetch
    // shim -> app.inject() -> Postgres round trip below) within act() — restored in afterAll.
    originalActEnvironment = (globalThis as { IS_REACT_ACT_ENVIRONMENT?: unknown }).IS_REACT_ACT_ENVIRONMENT;
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: unknown }).IS_REACT_ACT_ENVIRONMENT = true;

    const { buildApp } = await import("../server/app");
    const { fixtureVerifier } = await import("../server/test/sourceFixture");
    app = buildApp({ sourceVerifier: fixtureVerifier });
    await app.ready();

    const author = operatorActorFor(OWNER); // role "operator" — same write permissions as "author"
    const authorHeaders = { "x-actor-id": author.actorId, "x-actor-role": author.role };
    const approverHeaders = { "x-actor-id": APPROVER.actorId, "x-actor-role": APPROVER.role };
    const { seedGovernedRoot } = await import("../server/test/fixtures");
    const { attestFixture } = await import("../server/test/sourceFixture");

    // ── The seed is DECLARATIVE, not a one-shot write ──────────────────────────────────────────────
    //
    // Every identifier below is fixed, and it has to be: the Guided Demo panel looks the case up by
    // `RE-1014` and the assertions below look for specific proof ids in the rendered HTML, so neither
    // can be randomised per run. Against a database that already held the fixture, the evidence write
    // returned 409 and the suite threw in `beforeAll`. The fix is IDEMPOTENCE, not uniqueness: what
    // this block owes the tests is a STATE, not a set of writes.
    //
    // ── AND THE IDEMPOTENCE GUARD ITSELF HAD A DEFECT, WHICH CI FOUND THE HARD WAY ────────────────
    //
    // The guard was `GET /proofs/PF-RE-1014` → 200 means "already seeded, skip". On a sandbox database
    // that had been used before the D3 gate landed, `PF-RE-1014` EXISTED — approved on 2026-11-08
    // under `UsageActivation`, two days before the gate — so the guard found it, skipped the seed, and
    // the 403 the gate would have raised never fired. The suite passed locally and failed in CI run
    // #335 on a fresh container, which is the recorded lesson exactly: A TEST THAT HAS ONLY RUN
    // AGAINST A DIRTY DATABASE IS NOT A GUARD AGAINST A CLEAN ONE.
    //
    // THE FIX IS NOT A BIGGER FIXTURE COMPARISON. The guard's job is to decide whether the state it
    // needs already exists, and a proof whose recovery mechanism has no declared correction channel is
    // not that state under any circumstances — it is a record a current build would refuse to create.
    // So `admissibleExistingProof` asks the GATE's question, not a shape question: a stored proof is
    // reusable only if its reason could still be approved today. A pre-gate proof is therefore treated
    // as ABSENT, the seed runs, and the refusal fires on a dirty database exactly as on a clean one.
    const { reasonHasDeclaredChannel } = await import("./domain/correctionMapping");

    /**
     * An existing proof this seed may REUSE, or `null`.
     *
     * Returns null for a proof whose mechanism has no declared channel even though the row is there
     * and well-formed — because reusing it would silently restore the pre-gate state this slice exists
     * to remove, and would make the demonstration pass for the wrong reason.
     */
    const admissibleExistingProof = async (proofId: string) => {
      const res = await app.inject({ method: "GET", url: `/proofs/${proofId}`, headers: approverHeaders });
      if (res.statusCode !== 200) return null;
      const proof = res.json() as { recoveryReason: string | null };
      if (proof.recoveryReason === null || !reasonHasDeclaredChannel(proof.recoveryReason)) return null;
      return proof;
    };

    /**
     * Has this case's evidence already been ingested?
     *
     * AN IDEMPOTENCE GUARD KEYED ON THE END STATE CANNOT WORK WHEN THE END STATE IS A REFUSAL, and
     * that is the second defect this fixture had. The original guard asked `GET /proofs/PF-RE-1014`
     * → 200, which works only while a PROOF is what being-seeded looks like. RE-1014 is now seeded in
     * order to be REFUSED, and a refusal writes nothing — so the guard found nothing, re-ran the
     * writes, and the append-only evidence table correctly answered 409 on the second run. Measured,
     * not foreseen: the suite passed on a fresh database and failed on its own second run.
     *
     * So the WRITES are guarded by a state a refusal does leave behind — the ingested evidence — and
     * the APPROVAL ATTEMPT is deliberately unguarded, because a refused approval writes nothing and is
     * therefore safe to repeat. That is strictly better than skipping it: the 403 is re-established on
     * every run, dirty or clean, instead of being inferred from a previous one.
     */
    const evidenceAlreadyIngested = async (caseId: string) => {
      const res = await app.inject({
        method: "GET", url: `/cases/${caseId}/evidence`, headers: approverHeaders,
      });
      if (res.statusCode !== 200) return false;
      const body = res.json() as { evidence?: unknown[] } | unknown[];
      const list = Array.isArray(body) ? body : (body.evidence ?? []);
      return list.length > 0;
    };

    // ── RE-1014 · the REFUSAL, driven all the way to the gate ─────────────────────────────────────
    //
    // The case is taken to EVIDENCED through the real governed route — authored, baselined,
    // intervened, corrective evidence and settlement ingested — and then the approval is attempted and
    // REFUSED. That is the demonstration: not that we declined to try, but that the gate says no on a
    // case that has done everything else right. The refusal body is captured so the assertions read
    // the server's own words rather than a copy of them.
    if ((await admissibleExistingProof(PROOF_ID)) !== null) {
      throw new Error(
        `PF-${CASE_ID} exists with a mechanism that has a declared correction channel — this fixture `
          + "requires RE-1014 to be unprovable, so the database holds something this test did not create",
      );
    }
    let settlementEvidenceId: string;
    if (await evidenceAlreadyIngested(CASE_ID)) {
      // Already seeded on a previous run. The evidence id is deterministic, so it is reused rather
      // than re-ingested — and the approval below still runs.
      settlementEvidenceId = `EV-${CASE_ID}-src`;
    } else {
      await seedGovernedRoot(CASE_ID, { expectedMinor: 1_320_000, billedMinor: 0 });
      await app.inject({ method: "POST", url: `/cases/${CASE_ID}/author`, headers: authorHeaders });
      await app.inject({
        method: "POST",
        url: `/cases/${CASE_ID}/baseline`,
        headers: authorHeaders,
        payload: {
          baselineId: `BL-${CASE_ID}`, calculatedMinor: 260_000, currency: "USD",
          method: "matched_historical_cohort", methodVersion: 1,
          sourceRefs: ["cohort:ActivationMissed"], effectiveAt: "2026-06-01T09:05:00.000Z",
        },
      });
      await app.inject({ method: "POST", url: `/cases/${CASE_ID}/intervention`, headers: authorHeaders });
      // Ingested so the refusal cannot be mistaken for "no correction was supplied". A corrective
      // invoice IS present; it simply attests billing, and nothing attests an activation.
      await app.inject({
        method: "POST", url: `/cases/${CASE_ID}/evidence`, headers: authorHeaders,
        payload: { ...attestFixture(CASE_ID, {
          evidenceId: `EV-${CASE_ID}-fix`, sourceSystem: "billing", sourceRecordId: "UA-7781-CORRECTIVE",
          evidenceType: "corrective_invoice_issued", observedAt: "2026-06-01T12:00:00.000Z",
        }) },
      });
      const settlement = await app.inject({
        method: "POST", url: `/cases/${CASE_ID}/evidence`, headers: authorHeaders,
        payload: { ...attestFixture(CASE_ID, {
          evidenceId: `EV-${CASE_ID}-src`, sourceSystem: "billing", sourceRecordId: "UA-7781",
          evidenceType: "invoice_paid", observedAt: "2026-06-02T09:05:00.000Z",
          amountMinor: 1_320_000, currency: "USD",
        }) },
      });
      if (settlement.statusCode !== 201) {
        throw new Error(`RE-1014 settlement evidence seed failed: ${settlement.statusCode} ${settlement.body}`);
      }
      settlementEvidenceId = (settlement.json() as { evidenceId: string }).evidenceId;
    }

    // UNCONDITIONAL, on every run. A refused approval writes nothing, so repeating it is safe, and
    // re-establishing the 403 each time is stronger than inheriting it from a previous run.
    const refused = await app.inject({
      method: "POST", url: "/proofs", headers: approverHeaders,
      payload: {
        proofId: PROOF_ID, recoveryCaseId: CASE_ID, currency: "USD",
        collectedMinor: 1_320_000, excludedRecoveryMinor: 0,
        exclusionStatement:
          "No excluded recovery on this case — asserted: the full delta is supported by the referenced evidence.",
        recoveryReason: "UsageActivation",
        attribution: "In-product usage-activation flow triggered activation; next invoice cleared.",
        evidenceIds: [settlementEvidenceId], baselineId: `BL-${CASE_ID}`, confidenceUsed: 81,
      },
    });
    // THE REFUSAL IS THE EXPECTED OUTCOME, so a 201 here is the failure. Asserted in `beforeAll`
    // rather than left to a test, because every assertion below depends on the state being
    // "evidenced and refused" — if the gate ever let this through, the file must stop, not adapt.
    if (refused.statusCode !== 403) {
      // A 409 here means a PROOF CHAIN for RE-1014 already exists — which on this fixture can only be
      // a pre-gate row, since the gate refuses to create one. Named explicitly, because the recorded
      // failure mode is a dirty database making a refusal test pass for the wrong reason, and the
      // remedy is to recreate the database rather than to adjust the test.
      const hint = refused.statusCode === 409
        ? " — a proof chain for this case already exists, which this build cannot have created;"
          + " the database predates the correction-channel gate and must be recreated"
        : "";
      throw new Error(
        `RE-1014 was expected to be REFUSED (403) and the governed route answered ${refused.statusCode}: `
          + `${refused.body}${hint}`,
      );
    }
    refusalBody = refused.body;

    // ── RE-1015 · the PROOF, on a mechanism billing attests ───────────────────────────────────────
    //
    // Contracted $18,000.00, originally invoiced $12,500.00, corrective charge $5,500.00, collected
    // $18,000.00. The uplift equals the corrective charge, which is what makes it provable.
    if ((await admissibleExistingProof(PROVEN_PROOF_ID)) === null) {
      await seedGovernedRoot(PROVEN_CASE_ID, { expectedMinor: 1_800_000, billedMinor: 1_250_000 });
      await app.inject({ method: "POST", url: `/cases/${PROVEN_CASE_ID}/author`, headers: authorHeaders });
      await app.inject({
        method: "POST", url: `/cases/${PROVEN_CASE_ID}/baseline`, headers: authorHeaders,
        payload: {
          baselineId: `BL-${PROVEN_CASE_ID}`, calculatedMinor: 1_250_000, currency: "USD",
          method: "matched_historical_cohort", methodVersion: 1,
          sourceRefs: ["cohort:RevenueUnderBilled"], effectiveAt: "2026-06-04T09:00:00.000Z",
        },
      });
      await app.inject({ method: "POST", url: `/cases/${PROVEN_CASE_ID}/intervention`, headers: authorHeaders });
      const correction = await app.inject({
        method: "POST", url: `/cases/${PROVEN_CASE_ID}/evidence`, headers: authorHeaders,
        payload: { ...attestFixture(PROVEN_CASE_ID, {
          evidenceId: `EV-${PROVEN_CASE_ID}-fix`, sourceSystem: "billing", sourceRecordId: "CN-9120",
          evidenceType: "corrective_invoice_issued", observedAt: "2026-06-04T14:00:00.000Z",
        }) },
      });
      if (correction.statusCode !== 201) {
        throw new Error(`RE-1015 correction seed failed: ${correction.statusCode} ${correction.body}`);
      }
      const settled = await app.inject({
        method: "POST", url: `/cases/${PROVEN_CASE_ID}/evidence`, headers: authorHeaders,
        payload: { ...attestFixture(PROVEN_CASE_ID, {
          evidenceId: `EV-${PROVEN_CASE_ID}-src`, sourceSystem: "billing", sourceRecordId: "INV-9121",
          evidenceType: "invoice_paid", observedAt: "2026-06-14T09:00:00.000Z",
          amountMinor: 1_800_000, currency: "USD",
        }) },
      });
      if (settled.statusCode !== 201) {
        throw new Error(`RE-1015 settlement seed failed: ${settled.statusCode} ${settled.body}`);
      }
      const { evidenceId } = settled.json() as { evidenceId: string };
      const approved = await app.inject({
        method: "POST", url: "/proofs", headers: approverHeaders,
        payload: {
          proofId: PROVEN_PROOF_ID, recoveryCaseId: PROVEN_CASE_ID, currency: "USD",
          collectedMinor: 1_800_000, excludedRecoveryMinor: 0,
          exclusionStatement:
            "No excluded recovery on this case — asserted: the full delta is the corrective charge CN-9120.",
          recoveryReason: "BillingCorrection",
          attribution:
            "Corrective invoice CN-9120 raised for the $5,500.00 shortfall and settled in full on INV-9121.",
          evidenceIds: [evidenceId], baselineId: `BL-${PROVEN_CASE_ID}`, confidenceUsed: 92,
        },
      });
      if (approved.statusCode !== 201) {
        throw new Error(`RE-1015 proof seed failed: ${approved.statusCode} ${approved.body}`);
      }
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
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: unknown }).IS_REACT_ACT_ENVIRONMENT = originalActEnvironment;
    await app.close();
    const { prisma } = await import("../server/db");
    await prisma.$disconnect();
  });

  /** Mount the Guided Demo and switch the "Acting as" selector to the Finance Approver. */
  async function asApprover(): Promise<{ container: HTMLDivElement; root: ReturnType<typeof createRoot> }> {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(createElement(RecoveryProvider, null, createElement(App, { initialModule: "demo" })));
    });
    // Located by visible text, not by internal structure or test ids, as a real user would find it.
    const selects = Array.from(container.querySelectorAll("select"));
    const actingAsSelect = selects.find((sel) => sel.innerHTML.includes("Finance Approver"));
    expect(actingAsSelect).toBeTruthy();
    // Native-setter + dispatchEvent: React tracks the native value setter, not a raw property set.
    const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, "value")!.set!;
    await act(async () => {
      nativeSetter.call(actingAsSelect!, "approver");
      actingAsSelect!.dispatchEvent(new Event("change", { bubbles: true }));
    });
    return { container, root };
  }

  /** Bounded poll — real I/O latency is not something a fixed tick count can outlast in CI. */
  async function waitFor(container: HTMLElement, predicate: (html: string) => boolean): Promise<void> {
    const deadline = Date.now() + 4000;
    while (!predicate(container.innerHTML) && Date.now() < deadline) {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 25));
      });
    }
  }

  it(
    "the governed route REFUSED RE-1014, and the refusal names the mechanism and the missing channel",
    async () => {
      // Asserted on the server's own 403 body, captured in `beforeAll`. This is the claim that the
      // governed backend and the screen now agree on: before this slice the route refused and the
      // screen showed $10,600 of proven Revenue Returned for the same case.
      expect(refusalBody).toContain("CORRECTION_CHANNEL_NOT_DECLARED");
      expect(refusalBody).toContain("UsageActivation");
      expect(refusalBody).toMatch(/no source-attested correction channel/i);
      expect(refusalBody).toMatch(/governance decision/i);
      // It does NOT blame the data: no mention of a missing or malformed upload.
      expect(refusalBody).not.toMatch(/malformed|invalid file|missing column/i);
    },
  );

  it(
    "no proof row exists for RE-1014 on the governed backend",
    async () => {
      const approverHeaders = { "x-actor-id": APPROVER.actorId, "x-actor-role": APPROVER.role };
      const res = await app.inject({ method: "GET", url: `/proofs/${PROOF_ID}`, headers: approverHeaders });
      expect(res.statusCode).toBe(404);
      // Two independent mechanisms, because one could be weakened without the other noticing: the
      // route refuses to create it, and nothing exists to be read back.
      const { prisma } = await import("../server/db");
      expect(await prisma.proof.count({ where: { recoveryCaseId: CASE_ID } })).toBe(0);
    },
    10000,
  );

  it(
    "the screen shows RE-1014 as NOT COMPUTED with the refusal — never a proof id, never $0.00",
    async () => {
      const { container, root } = await asApprover();
      await waitFor(container, (html) => html.includes("NOT COMPUTED"));

      expect(container.innerHTML).toContain("NOT COMPUTED");
      expect(container.innerHTML).toContain("PROOF REFUSED");
      // The proof id the screen used to display for this case.
      expect(container.innerHTML).not.toContain(PROOF_ID);
      // And no rendered figure is a zero — matched as an element's text, not as a bare token, because
      // the screen's own explanatory sentence mentions "$0.00" in order to forbid it.
      expect(container.innerHTML).not.toMatch(/>\s*\+?\$0\.00\s*</);

      root.unmount();
      container.remove();
    },
    10000,
  );

  it(
    "and RE-1015's real governed proof IS reachable — so the refusal is specific, not a dead screen",
    async () => {
      // The control. A build that refused everything would pass every assertion above, so the proven
      // half has to be reachable through the same real route for those to mean anything.
      const approverHeaders = { "x-actor-id": APPROVER.actorId, "x-actor-role": APPROVER.role };
      const res = await app.inject({
        method: "GET", url: `/proofs/${PROVEN_PROOF_ID}`, headers: approverHeaders,
      });
      expect(res.statusCode).toBe(200);
      const proof = res.json() as {
        recoveryReason: string;
        collectedAmount: { minor: number };
        baselineAmount: { minor: number };
        revenueReturned: { minor: number };
      };
      expect(proof.recoveryReason).toBe("BillingCorrection");
      expect(proof.collectedAmount.minor).toBe(1_800_000);
      expect(proof.baselineAmount.minor).toBe(1_250_000);
      // $5,500.00 — and it equals the corrective charge CN-9120, which is the identity that makes it
      // provable rather than merely plausible.
      expect(proof.revenueReturned.minor).toBe(550_000);
    },
    10000,
  );
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
    // RE-1015's proof, not RE-1014's: the demo case's mechanism is unprovable, so it HAS no proof line
    // and the CFO ledger correctly contains none for it.
    expect(html).toContain("PF-RE-1015");
    expect(html).not.toContain("PF-RE-1014");
    expect(html).not.toMatch(/total recovered/i); // the proof view never merges forecast into recovered
  });
});

describe("Mission #010 · Increment 4 — Guided Demo → CFO Proof continuity", () => {
  it("the Guided Demo names the case and says its proven figure is NOT COMPUTED at the handoff", () => {
    const html = render("demo");
    expect(html).toContain("RE-1014"); // the case being handed off is named
    expect(html).toMatch(/Revenue Returned/i); // the proven figure is named (not the forecast)
    // RECOMPUTED: it used to assert $10,600 as "the proven amount". There is no proven amount for this
    // case, so the handoff says so instead of naming a figure.
    expect(html).toContain("NOT COMPUTED");
    expect(html).toContain("PROOF REFUSED");
  });

  it("marks exactly one CFO proof row — the provable case's — when opened from the demo", () => {
    // Focused on RE-1015, because a focus on RE-1014 can mark nothing: the case has no proof row to
    // mark. That is asserted below rather than left implicit.
    const html = renderCfo("RE-1015");
    expect(html).toContain(DEMO_MARKER); // the proof row is visibly marked
    expect(countOf(html, DEMO_MARKER)).toBe(1); // and only that one row is marked, not another
    expect(html).toContain("PF-RE-1015"); // the marked ledger still shows the case's proof
  });

  it("focusing the CFO view on the REFUSED case marks nothing, because it has no proof line", () => {
    const html = renderCfo("RE-1014");
    expect(html).not.toContain(DEMO_MARKER);
    expect(html).not.toContain("PF-RE-1014");
  });

  it("shows no demo marker on direct CFO navigation (isolated component)", () => {
    expect(renderCfo()).not.toContain(DEMO_MARKER);
  });

  it("shows no demo marker when the CFO view is reached by direct navigation in the app", () => {
    // initialModule="cfo" is direct navigation (not the demo CTA), so App passes no focus.
    expect(render("cfo")).not.toContain(DEMO_MARKER);
  });

  it("marking a proof row never merges forecast into the proven total", () => {
    expect(renderCfo("RE-1015")).not.toMatch(/total recovered/i);
  });
});
