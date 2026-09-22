# Source verification and first detector gate

## Gap recorded before implementation

The governed evidence endpoint accepts a source-system label supplied by an operator.
The label allow-list alone cannot establish independent provenance. The existing
synthetic CSV-to-proof test verifies wiring, not an authenticated payment source.

## Change

Independent evidence requires an Ed25519 attestation from a preconfigured source key.
The signed envelope binds the case, evidence ID, source record, type, observed time,
amount and currency, and an issuance time. Unknown keys, wrong source, modified
fields and expired attestations fail closed. Public keys are operator configuration;
private signing keys belong to the independent source, never NH beneficiaries.
Unsigned evidence remains beneficiary-controlled. Persist the verification receipt
with the immutable evidence. Existing proofs are never rewritten.

The first worker detects a missed activation deadline from a normalized observation.
It emits candidates only; human review, promotion and proof approval remain separate.
It is opt-in and uses the existing lease, retry, deduplication and shutdown controls.

## Limits and activation prerequisites

A signature authenticates a configured source; it does not establish causality,
baseline quality, or independence of an organization that controls the signing key.
No real source or deployment credentials have been supplied. Real operation requires
a reviewed independent signer, customer activation definition, scoped observation
feed, verified identity configuration and a deployment target. Synthetic test keys
must never be installed as production trust anchors.

## Configuration and source contract

`NH_EVIDENCE_SOURCE_KEYS` is a JSON array of `{keyId, sourceSystem, publicKey}`.
`publicKey` is a PEM Ed25519 public key. No configured key means no independent
evidence admission. Existing proof snapshots are untouched; new auditable approvals
reject evidence without a verification receipt, including old unsigned evidence.

The evidence request may carry `sourceAttestation: {keyId, issuedAt, signature}`.
The source signs UTF-8 JSON of this ordered tuple with Ed25519 (base64 signature):
`["nh-evidence-v1", caseId, evidenceId, sourceSystem, sourceRecordId, evidenceType,
observedAt, amountMinor-or-null, currency-or-null, issuedAt]`.
Issuance must be within five minutes, with at most 30 seconds future clock skew.
Retries after expiry need a freshly signed envelope; source-record uniqueness still
prevents counting the same outcome twice. Attestations cannot transfer between cases.
The independent signer must validate the source record and case binding itself.

Enable the worker using both `NH_AGENTS_ENABLED=true` and
`NH_ACTIVATION_DETECTOR_ENABLED=true`, plus `NH_AGENT_BOUNDARIES` and
`NH_AGENT_ADMISSION_POLICIES=ActivationMissed:10000` (example threshold, not a customer decision).
Queue tasks for agent `activation-deadline-v1` through the trusted task-store producer.
Each task contains exactly `sourceRef` (HMAC-SHA256 pseudonym), `signedAt`,
`activationDueAt`, `activatedAt` (observed absence = null), `observedAt`,
`amountAtRiskMinor`, `currency`, and `actionAvailable`.
Timestamps are canonical UTC ISO strings. The customer must define the activation
milestone and deadline before sending observations. Missing source data must not be
mapped to an observed absence. This worker does not poll an external provider;
the provider-specific observation producer remains required for unattended operation.

Tests use ephemeral signing keys and disposable PostgreSQL. They demonstrate
authenticity enforcement and worker execution, not a connected customer source.
