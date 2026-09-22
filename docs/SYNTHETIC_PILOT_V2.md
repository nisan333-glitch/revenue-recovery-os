# Synthetic Pilot v2 — product acceptance

## Purpose

Synthetic Pilot v2 demonstrates the complete Identify → Fix → Prove decision path without using
customer data or claiming real recovered revenue. It complements the PostgreSQL-backed technical
harness in `docs/SYNTHETIC_PILOT_RUN.md`; it does not replace a customer-data pilot.

## Start the product demo

```bash
npm run dev -- --host 127.0.0.1
```

Open the product and choose **Synthetic Pilot v2** under **Demo**.

## Governed scenarios

| Scenario | Expected path | Counted result |
|---|---|---:|
| Verified recovery | candidate → accepted review → case → action → signed evidence → proof | $5,000.00 synthetic Revenue Returned and Auditable Revenue |
| Human rejection | candidate → rejected review | $0; no Recovery Case |
| Insufficient evidence | candidate → accepted review → case → action → beneficiary-controlled evidence → proof blocked | $0; claimed collection excluded |

The three fictional opportunities total $40,000.00. That total remains a forecast and is never added
to Revenue Returned or Auditable Revenue.

## Acceptance criteria

1. The screen is visibly marked `SYNTHETIC ONLY` and states that no real revenue is claimed.
2. Revenue Opportunity, Revenue Returned and Auditable Revenue are displayed as separate values.
3. No candidate becomes a Recovery Case before a human review decision.
4. A rejected candidate terminates without a case, action or proof.
5. A successful scenario requires a recorded action and independent signed evidence before proof.
6. Beneficiary-controlled outcome evidence is blocked and contributes zero returned revenue.
7. CFO export remains disabled until proof approval.
8. Every step appears in a scenario-specific append-only Audit Trail.
9. Reset returns all scenarios to pending review and zero returned revenue.

## Verification commands

Portable UI and domain verification:

```bash
npm run test
npm run build
```

PostgreSQL-backed worker and proof verification, using a disposable migrated database:

```bash
NH_SYNTHETIC_PILOT=true \
DATABASE_URL='postgresql://USER:PASSWORD@localhost:5432/nh_synthetic_test?schema=public' \
npm run pilot:synthetic
```

## Evidence boundary

Passing this Pilot proves technical workflow behavior, safety gates and ledger separation. It does
not establish detector precision on customer data, causal incrementality, production security,
customer willingness to pay or real revenue returned.
