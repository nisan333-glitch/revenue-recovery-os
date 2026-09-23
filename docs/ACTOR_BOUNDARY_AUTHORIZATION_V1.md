# Actor-to-boundary authorization v1

## Gap recorded before implementation

Candidate review and promotion require the `operator` role and filter database reads by the
caller-supplied `boundaryId`, but the verified identity did not state which boundaries that
operator may access. A valid operator token could therefore name another customer's boundary.
Database filtering prevented accidental mixing; it did not provide actor-to-boundary authorization.

## Required control

- Production OIDC tokens must carry a non-empty boundary claim (default: `nh_boundaries`).
- The verified identity resolver validates, normalizes and freezes that claim.
- Candidate list, review and promotion fail closed unless the requested boundary is in the
  verified identity scope.
- The wildcard scope is reserved for the explicitly isolated development-header and synthetic
  harness paths. It is rejected in OIDC tokens.
- A role alone never grants access to every customer boundary.

## Non-goals

This control does not create an OIDC login flow or configure a customer's identity provider.
Those remain deployment inputs. It also does not claim that the current private-pilot packaging
is ready for public multi-tenant production.
