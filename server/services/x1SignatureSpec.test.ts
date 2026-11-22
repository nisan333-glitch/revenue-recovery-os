// X1 · the executable half of `docs/X1_SIGNATURE_SPECIFICATION_V1.md`.
//
// THE DOCUMENT MAKES CLAIMS A CUSTOMER WILL BUILD A SIGNER AGAINST. A page that restates constants
// beside the code drifts from it silently and the customer discovers it at the first real case — the
// defect the pilot-intake dependency probe exists to prevent. So every load-bearing constant in that
// page is checked HERE against the modules that will actually judge the attestation, and the
// end-to-end vector is produced by the PRODUCTION verifier with an ephemeral key.
//
// NO REAL KEY, NO REAL CASE, NO REAL CUSTOMER. The pair below is generated per run and discarded.
import { generateKeyPairSync, sign } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  EVIDENCE_SIGNING_SCHEME_V1,
  EVIDENCE_SIGNING_SCHEME_V2,
  SourceVerifier,
  sourceSigningPayload,
  type EvidenceClaim,
} from "./sourceVerification";
import {
  ALL_CORRECTION_EVIDENCE_TYPES,
  CORRECTION_EVIDENCE_TYPES,
  OUTCOME_EVIDENCE_TYPES,
  deriveEvidenceRole,
} from "../../src/domain/evidenceRole";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SPEC = readFileSync(resolve(REPO, "docs/X1_SIGNATURE_SPECIFICATION_V1.md"), "utf8");
/**
 * THE SAME FILE WITH ITS LINE WRAPS FLATTENED. A prose claim is a SENTENCE, and a Markdown source
 * breaks sentences at the column limit wherever they happen to fall — so `/not .{0,20} a third party/`
 * failed on a correct document because the phrase straddled a newline. That is the recorded lesson
 * about a guard judging lines where the claim is a sentence, met again. Code-shaped assertions keep
 * using `SPEC`, because an exact token must be matched exactly as written.
 */
const PROSE = SPEC.replace(/\s+/g, " ");

const CASE_ID = "RC-X1-SPEC-FIXTURE";
const claim = (over: Partial<EvidenceClaim> = {}): EvidenceClaim => ({
  evidenceId: "EV-X1-1", sourceSystem: "billing", sourceRecordId: "INV-X1-0001",
  evidenceType: "invoice_paid", observedAt: "2026-11-20T10:00:00.000Z",
  amountMinor: 123_456, currency: "USD", ...over,
});

describe("X1 · the signed bytes are what the document says they are", () => {
  it("v1 is the exact ten-element tuple, in that order, with nulls PRESENT not dropped", () => {
    const bare = { ...claim(), amountMinor: undefined, currency: undefined } as EvidenceClaim;
    const bytes = sourceSigningPayload(CASE_ID, bare, "2026-11-22T09:15:00.000Z");
    expect(JSON.parse(bytes.toString("utf8"))).toEqual([
      "nh-evidence-v1", CASE_ID, "EV-X1-1", "billing", "INV-X1-0001",
      "invoice_paid", "2026-11-20T10:00:00.000Z", null, null, "2026-11-22T09:15:00.000Z",
    ]);
    // An absent amount is the literal null the document promises — not a shorter tuple.
    expect(JSON.parse(bytes.toString("utf8"))).toHaveLength(10);
  });

  it("v2 inserts the payer reference immediately BEFORE issuedAt — an addition, never a reordering", () => {
    const v1 = JSON.parse(sourceSigningPayload(CASE_ID, claim(), "2026-11-22T09:15:00.000Z").toString("utf8")) as unknown[];
    const v2 = JSON.parse(sourceSigningPayload(CASE_ID, claim({ payerExternalRef: "ACME-001" }), "2026-11-22T09:15:00.000Z").toString("utf8")) as unknown[];
    expect(v2).toHaveLength(v1.length + 1);
    expect(v2.slice(1, -2)).toEqual(v1.slice(1, -1)); // every shared element keeps its position
    expect(v2.at(-2)).toBe("ACME-001");
    expect(v2.at(-1)).toBe(v1.at(-1));                // issuedAt stays last in both
  });

  it("the scheme ids the document prints are the code's own", () => {
    expect(EVIDENCE_SIGNING_SCHEME_V1).toBe("nh-evidence-v1");
    expect(EVIDENCE_SIGNING_SCHEME_V2).toBe("nh-evidence-v2");
    expect(SPEC).toContain(`"${EVIDENCE_SIGNING_SCHEME_V1}"`);
    expect(SPEC).toContain(`"${EVIDENCE_SIGNING_SCHEME_V2}"`);
  });

  it("there is no whitespace and no object — a key-order ambiguity is unrepresentable", () => {
    const text = sourceSigningPayload(CASE_ID, claim(), "2026-11-22T09:15:00.000Z").toString("utf8");
    expect(text.startsWith("[")).toBe(true);
    expect(text).not.toMatch(/[ \n\t]/);
  });
});

describe("X1 · the evidence vocabulary the document tells a customer to send", () => {
  it("every type the document names derives the role it claims, from the real allowlist", () => {
    for (const t of ["corrective_invoice_issued", "billing_corrected"]) {
      expect(deriveEvidenceRole("billing", t)).toBe("correction");
      expect(SPEC).toContain(`\`${t}\``);
    }
    for (const t of ["invoice_paid", "payment_received"]) {
      expect(deriveEvidenceRole("billing", t)).toBe("outcome");
      expect(SPEC).toContain(`\`${t}\``);
    }
  });

  it("the document names ALL of them — a type the code accepts and the page omits is a silent gap", () => {
    const declared = [...(OUTCOME_EVIDENCE_TYPES.billing ?? []), ...(CORRECTION_EVIDENCE_TYPES.billing ?? [])];
    expect(declared.length).toBeGreaterThan(0);
    for (const t of declared) expect(SPEC, `the spec omits ${t}`).toContain(`\`${t}\``);
    expect(ALL_CORRECTION_EVIDENCE_TYPES).toContain("corrective_invoice_issued");
  });

  it("a credit note is NOT a correction type — the sign convention, asserted and not promised", () => {
    expect(deriveEvidenceRole("billing", "credit_note_issued")).toBe("supporting");
    expect(PROSE).toMatch(/credit note is deliberately absent/i);
  });
});

describe("X1 · the end-to-end vector, through the PRODUCTION verifier", () => {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const pem = publicKey.export({ type: "spki", format: "pem" }).toString();
  const keys = [{ keyId: "x1-ephemeral", sourceSystem: "billing", publicKey: pem }];
  const at = (iso: string) => new SourceVerifier(keys, () => Date.parse(iso));
  const attest = (c: EvidenceClaim, issuedAt: string) => ({
    keyId: "x1-ephemeral", issuedAt,
    signature: sign(null, sourceSigningPayload(CASE_ID, c, issuedAt), privateKey).toString("base64"),
  });

  it("a signer that follows the document is ACCEPTED, and the receipt re-verifies the claim later", () => {
    const c = claim();
    const issuedAt = "2026-11-22T09:15:00.000Z";
    const receipt = at("2026-11-22T09:15:05.000Z").verify(CASE_ID, c, attest(c, issuedAt))!;
    expect(receipt.method).toBe("ed25519-v1");
    expect(receipt.keyId).toBe("x1-ephemeral");
    expect(receipt.signedPayload).toBe(sourceSigningPayload(CASE_ID, c, issuedAt).toString("utf8"));
    expect(receipt.publicKeyPem).toBe(pem);
    expect(receipt.payloadSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(receipt.attestedPayerExternalRef).toBeUndefined(); // absent claim ⇒ absent on the receipt
  });

  it("the signature shape the document prints is the one enforced", () => {
    const c = claim();
    const a = attest(c, "2026-11-22T09:15:00.000Z");
    expect(a.signature).toMatch(/^[A-Za-z0-9+\/]{86}==$/);
    expect(SPEC).toContain("^[A-Za-z0-9+/]{86}==$");
    // base64url instead of base64 is the mistake a signer actually makes, and it is refused.
    const url = { ...a, signature: a.signature.replace(/\+/g, "-").replace(/\//g, "_") };
    if (url.signature !== a.signature) {
      expect(() => at("2026-11-22T09:15:05.000Z").verify(CASE_ID, c, url)).toThrow();
    }
  });

  it("the freshness window is EXACTLY the 30s/5min the document states — both edges", () => {
    const c = claim();
    const a = attest(c, "2026-11-22T09:15:00.000Z");
    const ok = (iso: string) => expect(at(iso).verify(CASE_ID, c, a)).toBeTruthy();
    const no = (iso: string) => expect(() => at(iso).verify(CASE_ID, c, a)).toThrow(/invalid or expired/);
    ok("2026-11-22T09:14:30.000Z");  // 30s in the future — the stated bound
    no("2026-11-22T09:14:29.999Z");  // 30.001s — refused
    ok("2026-11-22T09:20:00.000Z");  // exactly 5 minutes old
    no("2026-11-22T09:20:00.001Z");  // older — refused
    expect(PROSE).toMatch(/30\*{0,2} seconds\*{0,2} in the future/);
    expect(PROSE).toMatch(/5\*{0,2} minutes\*{0,2} old/);
  });

  it("a NON-CANONICAL issuedAt is refused, which is the document's round-trip rule", () => {
    const c = claim();
    const short = "2026-11-22T09:15Z";
    const a = { keyId: "x1-ephemeral", issuedAt: short,
      signature: sign(null, sourceSigningPayload(CASE_ID, c, short), privateKey).toString("base64") };
    expect(() => at("2026-11-22T09:15:05.000Z").verify(CASE_ID, c, a)).toThrow(/invalid or expired/);
  });

  it("TAMPERING IN EITHER DIRECTION fails — the property the two schemes exist for", () => {
    const issuedAt = "2026-11-22T09:15:00.000Z";
    const now = "2026-11-22T09:15:05.000Z";
    // (a) a payer reference ADDED to a v1-signed claim
    const signedV1 = attest(claim(), issuedAt);
    expect(() => at(now).verify(CASE_ID, claim({ payerExternalRef: "ACME-001" }), signedV1)).toThrow();
    // (b) a payer reference STRIPPED from a v2-signed claim
    const signedV2 = attest(claim({ payerExternalRef: "ACME-001" }), issuedAt);
    expect(() => at(now).verify(CASE_ID, claim(), signedV2)).toThrow();
    // (c) the amount changed after signing
    expect(() => at(now).verify(CASE_ID, claim({ amountMinor: 999_999 }), attest(claim(), issuedAt))).toThrow();
    // (d) replayed onto a different case
    expect(() => at(now).verify("RC-OTHER", claim(), signedV1)).toThrow();
  });

  it("a key registered for another source system cannot sign a billing claim", () => {
    const wrong = new SourceVerifier(
      [{ keyId: "x1-ephemeral", sourceSystem: "crm", publicKey: pem }],
      () => Date.parse("2026-11-22T09:15:05.000Z"),
    );
    expect(() => wrong.verify(CASE_ID, claim(), attest(claim(), "2026-11-22T09:15:00.000Z"))).toThrow();
  });

  it("only Ed25519 is accepted — the document's first bullet, enforced at construction", () => {
    const rsa = generateKeyPairSync("rsa", { modulusLength: 2048 });
    expect(() => new SourceVerifier([{ keyId: "k", sourceSystem: "billing",
      publicKey: rsa.publicKey.export({ type: "spki", format: "pem" }).toString() }]))
      .toThrow(/Ed25519/);
  });
});

describe("X1 · what the document must NOT claim", () => {
  it("states no registered key, no institution and no customer", () => {
    expect(PROSE).toMatch(/No key is registered/i);
    expect(SPEC).not.toMatch(/BEGIN (PRIVATE|OPENSSH PRIVATE) KEY/);
    // A PEM body would be a real key material block; only the PEM HEADER may appear, in the example.
    expect(SPEC.match(/-----BEGIN PUBLIC KEY-----\\n\.\.\./g) ?? []).toHaveLength(1);
  });

  it("does not present a PROVISIONAL figure as third-party corroborated", () => {
    expect(PROSE).toMatch(/PROVISIONAL/);
    expect(PROSE).toMatch(/attesting[^.]{0,30}not\*{0,2} a third party/i);
    expect(PROSE).toMatch(/turns no observed amount into Revenue Returned/i);
  });
});
