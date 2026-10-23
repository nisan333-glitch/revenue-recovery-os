// JOURNEY SUPPORT ONLY · ingest ONE outcome-role evidence record for the browser journey's case.
//
// Run by `e2e/journey.mjs`, never by the application.
//
// WHY THE BROWSER CANNOT DO THIS. Outcome evidence must carry an Ed25519 attestation from the source
// system, and the signing key is the SOURCE'S — the whole point of the mechanism is that the party who
// benefits from a larger recovery number does not hold it. A page script that could mint an attestation
// would be the Trust Invariant's standing test answered the wrong way. So the journey generates an
// ephemeral synthetic source keypair, gives the API only the PUBLIC half through
// `NH_EVIDENCE_SOURCE_KEYS`, and the private half reaches this script and nothing else.
//
// The key is ephemeral and per run: nothing is written to disk, nothing is reused between runs, and no
// deployment ever sees it. It stands in for a real billing system's key, which is why the evidence it
// attests is classified `independent` rather than beneficiary-controlled.
//
// IT POSTS TO THE REAL ENDPOINT. `/cases/:id/evidence` runs the real verifier, the real role gate and
// the real halt gate. Nothing is written to the database by this script directly.
import { createPrivateKey, sign } from "node:crypto";
import { sourceSigningPayload } from "../server/services/sourceVerification";

const recoveryCaseId = process.argv[2];
// NEGATIVE CONTROL MODE. `tampered` signs the claim for 9 000 and then SENDS 90 000, so the attestation
// does not cover what was submitted. The verifier must refuse it; the journey asserts that it does. The
// script exits 0 in this mode either way and reports the status, because the point is what the SERVER
// answered — a non-zero exit would make a correct refusal indistinguishable from a harness failure.
const tampered = process.argv[3] === "tampered";
const privateKeyPem = process.env.JOURNEY_EVIDENCE_PRIVATE_KEY ?? "";
const keyId = process.env.JOURNEY_EVIDENCE_KEY_ID ?? "";
const apiPort = process.env.JOURNEY_API_PORT ?? "4000";

if (!recoveryCaseId || !privateKeyPem || !keyId) {
  console.error("usage: seed-journey-case-evidence.ts <recoveryCaseId> (with JOURNEY_EVIDENCE_* in env)");
  process.exit(2);
}

async function main(): Promise<void> {
  const evidenceId = `EV-journey-${tampered ? "tamper-" : ""}${recoveryCaseId!.slice(3, 11)}`;
  const claim = {
    evidenceId,
    sourceSystem: "billing",
    sourceRecordId: `inv-journey-${recoveryCaseId!.slice(3, 11)}`,
    evidenceType: "invoice_paid",
    observedAt: "2026-07-25T00:00:00.000Z",
    amountMinor: 9_000,
    currency: "USD",
  };
  const issuedAt = new Date().toISOString();
  const signature = sign(
    null,
    sourceSigningPayload(recoveryCaseId!, claim, issuedAt),
    createPrivateKey(privateKeyPem),
  ).toString("base64");

  const res = await fetch(`http://127.0.0.1:${apiPort}/cases/${recoveryCaseId}/evidence`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-actor-id": "dana@company",
      "x-actor-role": "author",
    },
    body: JSON.stringify({
      ...claim,
      ...(tampered ? { amountMinor: claim.amountMinor * 10 } : {}),
      sourceAttestation: { keyId, issuedAt, signature },
    }),
  });
  const body = await res.text();
  // The journey asserts `ingested`; the status and body are printed so a failure names itself rather
  // than surfacing later as a case that never reaches EVIDENCED for no stated reason.
  console.log(JSON.stringify({ ingested: res.status === 201, status: res.status, evidenceId, body: body.slice(0, 300) }));
  if (res.status !== 201 && !tampered) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exitCode = 1;
});
