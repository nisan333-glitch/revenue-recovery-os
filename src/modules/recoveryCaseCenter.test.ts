// @vitest-environment jsdom
// What the Recovery Case screen must show, and what it must never show.
//
// The claims under test are the ones the constitution makes binding on every screen: an identified gap
// is not returned money, and "not computed" is not "zero". Those are properties of what a reader SEES,
// so they are asserted on the rendered markup rather than on the component's state — the same reason the
// re-assessment journey asserts a missing file picker on the markup instead of promising there is none.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { RecoveryCaseCenter } from "./RecoveryCaseCenter";
import type { RecoveryCaseViewDTO } from "../data/governedTrustClient";

const CASE_ID = "RC-11111111-2222-3333-4444-555555555555";

function view(over: Partial<RecoveryCaseViewDTO> = {}): RecoveryCaseViewDTO {
  return {
    root: {
      recoveryCaseId: CASE_ID,
      boundaryId: "pb-1",
      sourceCandidateId: "CC-abc123",
      recoveryType: "ActivationMissed",
      sourceRef: "hmac-sha256:" + "a".repeat(64),
      amountAtRiskMinor: 10_000,
      currency: "USD",
      detectorVersion: "activation-deadline-v1",
      openedByActorId: "op@company",
      openedByRole: "operator",
      policyVersion: "recovery-case-promotion-v1",
      openedAt: "2026-10-20T09:00:00.000Z",
    },
    lifecycle: {
      recoveryCaseId: CASE_ID,
      progress: "OPENED",
      governance: [],
      responsible: null,
      trail: [{ action: "PromoteCandidate", actorId: "op@company", role: "operator", at: "2026-10-20T09:00:00.000Z" }],
      trailOrderCertain: true,
      exposure: { minor: 10_000, currency: "USD" },
      revenueReturned: null,
      exposureIsNotRecoveredRevenue: true,
    },
    exposureLabel: "OBSERVED EXPOSURE recorded when this case was opened — an identified gap, not money returned.",
    identityGrain: {
      grain: "ACCOUNT_GRAINED_POTENTIAL",
      mayCoverMultipleObligations: true,
      obligationUniquenessGuaranteed: false,
      reason: "the pilot data contract declares no obligation-level identifier",
      absorbedObservations: { checked: false },
      headline: "ACCOUNT-LEVEL IDENTITY. This case is identified by the customer account, not by the obligation.",
    },
    provenRevenueReturnedMinor: null,
    provenLedgerUnavailableReason: "no_effective_recovery_proof",
    provenFromProofIds: [],
    baselineCount: 0,
    evidence: [],
    unknownAuthorityActions: [],
    ...over,
  };
}

/** Render, type the case id, click Read, and return the resulting markup. */
async function render(dto: RecoveryCaseViewDTO): Promise<string> {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(createElement(RecoveryCaseCenter, { read: async () => dto }));
  });
  const input = host.querySelector<HTMLInputElement>('input[aria-label="Recovery Case ID"]')!;
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
    setter.call(input, CASE_ID);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  const button = [...host.querySelectorAll("button")].find((b) => b.textContent?.includes("Read case"))!;
  await act(async () => {
    button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  const html = host.innerHTML;
  await act(async () => root.unmount());
  host.remove();
  return html;
}

const textOf = (html: string, testId: string): string => {
  const el = document.createElement("div");
  el.innerHTML = html;
  return el.querySelector(`[data-testid="${testId}"]`)?.textContent?.trim() ?? "";
};

describe("the Recovery Case screen keeps the two ledgers apart", () => {
  it("1 · an unproven case shows NOT COMPUTED, and the string $0.00 appears nowhere", async () => {
    const html = await render(view());
    expect(textOf(html, "case-exposure")).toBe("$100.00");
    expect(textOf(html, "case-revenue-returned")).toBe("NOT COMPUTED");
    // THE FALSIFIER FOR THE WHOLE SCREEN. A `$0.00` in the proven panel would assert that a proof was
    // found and established nothing. No renderer may produce it from an absent figure.
    expect(html).not.toContain("$0.00");
    expect(html).toContain("No effective proof exists for this case");
  });

  it("2 · a proven case shows the proven figure AND the exposure, as two different numbers", async () => {
    const html = await render(
      view({
        lifecycle: { ...view().lifecycle, progress: "PROVEN", revenueReturned: { minor: 7_000, currency: "USD" } },
        provenRevenueReturnedMinor: 7_000,
        provenLedgerUnavailableReason: null,
        provenFromProofIds: ["PF-1"],
      }),
    );
    expect(textOf(html, "case-exposure")).toBe("$100.00");
    expect(textOf(html, "case-revenue-returned")).toBe("$70.00");
    expect(html).toContain("PF-1");
    // Both are on the page at once, which is the point: the reader can see that the identified gap and
    // the proven recovery are different numbers rather than being shown only the flattering one.
    expect(html).toContain("Identified exposure");
    expect(html).toContain("Revenue Returned");
  });

  it("3 · progress is shown as a path, with unreached stages visibly unreached", async () => {
    const html = await render(view({ lifecycle: { ...view().lifecycle, progress: "BASELINED" } }));
    const el = document.createElement("div");
    el.innerHTML = html;
    const reached = (stage: string) => el.querySelector(`[data-testid="stage-${stage}"]`)?.getAttribute("data-reached");
    expect(reached("OPENED")).toBe("yes");
    expect(reached("OWNED")).toBe("yes");
    expect(reached("BASELINED")).toBe("yes");
    expect(reached("INTERVENED")).toBe("no");
    expect(reached("PROVEN")).toBe("no");
  });

  it("4 · an ambiguous trail order is STATED, not silently resolved", async () => {
    const html = await render(view({ lifecycle: { ...view().lifecycle, trailOrderCertain: false } }));
    expect(html).toContain("not established by the");
    expect(html).toContain("derived from which events exist, not from their order");
  });

  it("5 · a governance marker is shown ALONGSIDE progress, never instead of it", async () => {
    const html = await render(
      view({ lifecycle: { ...view().lifecycle, progress: "PROVEN", governance: ["HALTED"], revenueReturned: { minor: 7_000, currency: "USD" } }, provenRevenueReturnedMinor: 7_000, provenLedgerUnavailableReason: null, provenFromProofIds: ["PF-1"] }),
    );
    expect(html).toContain("HALTED");
    const el = document.createElement("div");
    el.innerHTML = html;
    expect(el.querySelector('[data-testid="stage-PROVEN"]')?.getAttribute("data-reached")).toBe("yes");
  });

  it("5b · THE GRAIN DISCLOSURE IS RENDERED, above the figures it qualifies", async () => {
    const html = await render(view());
    const el = document.createElement("div");
    el.innerHTML = html;
    const notice = el.querySelector('[data-testid="identity-grain-notice"]');
    expect(notice).not.toBeNull();
    expect(notice!.getAttribute("data-grain")).toBe("ACCOUNT_GRAINED_POTENTIAL");
    // The server's words, not the component's.
    expect(notice!.textContent).toContain("ACCOUNT-LEVEL IDENTITY");
    expect(notice!.textContent).toContain("declares no obligation-level identifier");
    // ABOVE the exposure panel: a disclosure under the number it qualifies is read after the number has
    // already been believed. Index comparison on the rendered markup, not on intent.
    expect(html.indexOf('data-testid="identity-grain-notice"')).toBeLessThan(
      html.indexOf('data-testid="case-exposure"'),
    );
  });

  it("5c · NOT CHECKED is rendered as not checked, never as none found", async () => {
    const html = await render(view());
    expect(html).toContain('data-testid="absorbed-not-checked"');
    expect(html).toMatch(/not been checked/);
    // The failure this forbids: reporting a zero nobody measured.
    expect(html).not.toMatch(/no absorptions|0 absorbed|none found/i);
  });

  it("5d · a RECORDED absorption renders its count and the stronger headline", async () => {
    const html = await render(
      view({
        identityGrain: {
          ...view().identityGrain,
          grain: "ABSORBED_OBSERVATIONS_RECORDED",
          absorbedObservations: { checked: true, count: 2 },
          headline: "ACCOUNT-LEVEL IDENTITY, AND A SECOND OBSERVATION WAS ABSORBED.",
        },
      }),
    );
    expect(textOf(html, "absorbed-count")).toBe("2");
    expect(html).toContain("A SECOND OBSERVATION WAS ABSORBED");
    expect(html).not.toContain('data-testid="absorbed-not-checked"');
  });

  it("5e · the account key is VISIBLE and labelled as not an obligation reference", async () => {
    // It was not rendered at all before, so a reader could not see identity was account-shaped.
    const html = await render(view());
    expect(textOf(html, "case-source-ref")).toBe("hmac-sha256:" + "a".repeat(64));
    expect(html).toMatch(/account pseudonym — not an obligation reference/);
    expect(html).toMatch(/Identified exposure · account-level/);
  });

  it("5g · an ABSENT disclosure fails closed — the case screen too", async () => {
    // The DTO declares the field required, so TypeScript is satisfied; the RUNTIME is not bound by that.
    // An older server during a rolling deploy, or a cached payload, can drop it — and reading that
    // silence as "nothing to warn about" would let a deploy skew delete the warning. The same property
    // the queue screen asserts, because both screens render the one component.
    const without = view();
    delete (without as { identityGrain?: unknown }).identityGrain;
    const html = await render(without);
    expect(html).toContain('data-grain="NOT_STATED"');
    expect(html).toContain('data-testid="grain-not-stated"');
    expect(html).toContain("Absence is not reassurance");
  });

  it("5f · the notice is SILENT in the state this build cannot reach", async () => {
    // A notice saying "identity is fine" is noise. Nothing renders when the guarantee holds.
    const html = await render(
      view({
        identityGrain: {
          ...view().identityGrain,
          grain: "OBLIGATION_UNIQUENESS_GUARANTEED",
          mayCoverMultipleObligations: false,
          obligationUniquenessGuaranteed: true,
        },
      }),
    );
    expect(html).not.toContain('data-testid="identity-grain-notice"');
  });

  it("6 · a refusal shows the server's reason and NO substitute figures", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    await act(async () => {
      root.render(
        createElement(RecoveryCaseCenter, {
          read: async () => {
            throw new Error("recovery case RC-x has no authoritative root");
          },
        }),
      );
    });
    const input = host.querySelector<HTMLInputElement>('input[aria-label="Recovery Case ID"]')!;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
      setter.call(input, CASE_ID);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      [...host.querySelectorAll("button")]
        .find((b) => b.textContent?.includes("Read case"))!
        .dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("Nothing is shown rather than a substitute");
    expect(host.querySelector('[data-testid="recovery-case-body"]')).toBeNull();
    await act(async () => root.unmount());
    host.remove();
  });
});

describe("structural · the screen reads the governed record, and the seed screen says it does not", () => {
  // Resolved from the vitest project root, which is the repository root. Asserted non-empty below so
  // the guard cannot pass by reading nothing.
  const sourceOf = (path: string): string => readFileSync(`${process.cwd()}/${path}`, "utf8");
  // Import specifiers only. A prose mention is not an import and a string literal is not a dependency —
  // the lesson this repository has now met in a guard eleven times over.
  const importsOf = (code: string): string[] =>
    [...code.matchAll(/(?:^|\n)\s*import\s[^;]*?from\s+["']([^"']+)["']/g)].map((m) => m[1]!);

  it("7 · RecoveryCaseCenter imports the API client and NOT the seed-backed context", () => {
    const imports = importsOf(sourceOf("src/modules/RecoveryCaseCenter.tsx"));
    expect(imports).toContain("../data/governedTrustClient");
    expect(imports.some((i) => i.includes("state/RecoveryContext"))).toBe(false);
    expect(imports.some((i) => i.includes("data/seed"))).toBe(false);
    // The guard must be able to fire: it finds imports at all.
    expect(imports.length).toBeGreaterThan(3);
  });

  it("8 · CFOProofView still reads the seed context AND now says so on the screen", () => {
    const code = sourceOf("src/modules/CFOProofView.tsx");
    // Not rewired — deliberately. Silently swapping its data source would make a demonstration look
    // like a capability, so the honest move is the label, and the label has to actually be rendered.
    expect(importsOf(code)).toContain("../state/RecoveryContext");
    // The label is now the SHARED `DemoDataBanner`, so there is one implementation of the claim rather
    // than ten that can drift. `seedDataLabelling.test.ts` enforces it across every seed-backed screen;
    // this line keeps the CFO screen named here, where its deliberate non-rewiring is the subject.
    expect(importsOf(code)).toContain("../components/DemoDataBanner");
    expect(code).toContain("<DemoDataBanner />");
  });
});
