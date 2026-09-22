# Synthetic Identify → Fix → Prove pilot

This command executes the real activation worker and governed proof path against a disposable
PostgreSQL database. It is a technical verification harness. It does not contain customer data,
does not contact a customer system and does not prove real recovered revenue.

## Safety gate

The command refuses to start unless all of the following are true:

1. `NH_SYNTHETIC_PILOT=true` is set explicitly.
2. `DATABASE_URL` uses PostgreSQL.
3. The database name contains `test`, `synthetic` or `pilot` as a distinct token.
4. The host is local or a disposable service host (`localhost`, loopback, `db` or `postgres`).

It never drops or truncates data. Every run uses unique synthetic identifiers.

## Run

Apply migrations to a disposable database, then run:

```bash
NH_SYNTHETIC_PILOT=true \
DATABASE_URL='postgresql://USER:PASSWORD@localhost:5432/nh_synthetic_test?schema=public' \
npm run pilot:synthetic
```

The command exits non-zero on any failed control. On success it prints one JSON report explicitly
marked with:

```json
{
  "syntheticOnly": true,
  "containsRealCustomerData": false,
  "claimsRealRevenue": false
}
```

## What success proves

- The production activation worker can turn a normalized, actionable missed-activation observation
  into exactly one candidate under the configured economic threshold.
- A candidate cannot become a Recovery Case without a separate accepted review.
- Replaying promotion does not create a second case.
- A baseline is locked before the synthetic outcome is submitted.
- The author and approver are separate identities.
- Outcome evidence is signed by an ephemeral Ed25519 key and retains a verification receipt.
- Opportunity is kept separate from Revenue Returned.
- The CFO export reconciles to the immutable governed proof.

## What success does not prove

- Access to a real CRM, billing, product or payment source.
- Detector precision on a customer's data.
- Causal incrementality in a live workflow.
- Real revenue returned, customer willingness to pay or production readiness.

The ephemeral private signing key exists only in process memory and is discarded at exit. It must
never be reused as a production trust anchor.
