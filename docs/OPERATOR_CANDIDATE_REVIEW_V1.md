# Operator Candidate Review v1

## Gap closed

The server already allowed a detector to emit a `CandidateSignal`, required an immutable human review,
and promoted only accepted candidates into an authoritative `RecoveryCase`. The product had no operator
surface for that governed path.

## Flow

`Detector → CandidateSignal → Human Accept/Reject → Explicit Promotion → RecoveryCase`

The operator must enter the exact pilot boundary. The server enforces boundary isolation and role
authorization. A reason is mandatory and the review decision is immutable. Accepting a candidate does
not create a Case; promotion remains a separate operator action. Rejection creates no Case.

## Money boundary

Candidate amounts are Revenue Opportunity only. Review and promotion always show Revenue Returned as
zero. No detector, review or promotion endpoint can approve Proof or move money into the proven ledger.

## Production boundary

The interface uses the existing same-origin governed API. Development may use dev identity headers;
production requires the configured bearer identity path. A real pilot still requires a reviewed boundary,
source adapter, OIDC/JWKS configuration and customer-defined admission policy.
