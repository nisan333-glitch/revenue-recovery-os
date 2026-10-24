# Security deployment contract · V1

Status: **implemented in code on the development branch; NOT deployed anywhere; no identity provider, key,
credential, certificate or hosted service was chosen, bought or created.** Everything below that needs an owner
decision is listed in §8 and is *refused at start-up* until the owner supplies it — never defaulted.

This document states what the process **enforces** (so it fails closed), what it **cannot** enforce (so the owner
must), and how secrets are handled and rotated. It changes no monetary, proof or governance semantics.

## 1. Authentication

| Mode | Selected by | Allowed where |
|---|---|---|
| `oidc` (default when `NODE_ENV=production`) | `NH_AUTH_MODE=oidc` or unset in production | anywhere |
| `dev-headers` | `NH_AUTH_MODE=dev-headers` (default outside production) | loopback / isolated container only |

**Dev-header identity is refused on two independent layers** (`server/auth/loopbackGuard.ts`):

1. **Start-up** — the process will not listen on anything but loopback; `0.0.0.0` is permitted only with *both*
   `NH_PRIVATE_PILOT=true` and `NH_TRUST_CONTAINER_NETWORK=true`. This holds for every `NODE_ENV` (previously the
   check was skipped whenever `NH_PRIVATE_PILOT` was unset).
2. **Per request** — refused if any of `Forwarded`, `X-Forwarded-For/Host/Proto/Port`, `X-Real-IP` is present, the
   `Host` is not a loopback name, or the TCP peer is a publicly routable address. A proxied, publicly reachable
   deployment therefore cannot be talked into trusting headers by a mis-set environment variable.

**OIDC** (`server/auth/verifiedIdentity.ts`): bearer JWT, RS256/384/512 only (no `none`, no HMAC), JWKS fetched over
HTTPS with redirects refused, `iss` / `aud` / `exp` / `nbf` / `sub` checked, role from `NH_OIDC_ROLE_CLAIM`
(default `nh_role`, closed set of five roles), boundary scope from `NH_OIDC_BOUNDARY_CLAIM` (default
`nh_boundaries`; empty, duplicate, or `*` refused). Every request is verified; there is no session the app trusts
on its own. **Server-side authorization and separation-of-duties are unchanged and are the only authority** — the
browser never decides a role.

**Browser** (`src/auth/*`): Authorization Code + PKCE (S256) as a *public client*; there is no client secret in the
bundle. The SPA renders nothing until `GET /api/auth/whoami` shows the server accepted the token. The token lives in
`sessionStorage` (per tab) and is dropped on expiry or any `401`. Dev headers are sent only by a Vite dev build.

### Known limits (stated, not hidden)
* No token revocation / replay protection: a stolen token is valid until `exp`. Keep access-token lifetimes short
  (the IdP's setting).
* `sessionStorage` is readable by script running in the page; the strict CSP (`script-src 'self'`) is the mitigation.
  A server-side session (backend-for-frontend with a confidential client and an `HttpOnly` cookie) is stronger and
  needs a client secret the owner must create — **decision D3**.
* The token endpoint is called from the browser, so the IdP must allow CORS from the app origin — **decision D4**.

## 2. Transport

The application speaks **plain HTTP**; TLS is terminated by a trusted proxy / load balancer in front of it
(`server/http/transportGuard.ts`). In production the process **refuses to start** unless `NH_TLS_TERMINATION=proxy`,
except for the supervised dev-header private pilot. Behind a proxy it additionally:

* answers `403` to any request whose `X-Forwarded-Proto` is not exactly `https` (liveness probes `/health`, `/ready`
  exempt), and
* sends `Strict-Transport-Security: max-age=31536000; includeSubDomains`.

**Owner obligations the application cannot verify:** the application port must be reachable *only* from the proxy
(security group / network policy), and the proxy must overwrite — not append to — `X-Forwarded-Proto`. Otherwise the
header is attacker-controlled. Certificates, renewal, TLS versions/ciphers and HTTP→HTTPS redirect live at the proxy.

### PostgreSQL (`server/persistence/databaseConfig.ts`)
Production start-up requires **verified** TLS: `sslmode=verify-full`, `verify-ca`, or `sslmode=require&sslaccept=strict`.
Refused always: `sslaccept=accept_invalid_certs`, `sslmode=no-verify|prefer|allow|disable`, and an absent mode.
`NH_PRIVATE_PILOT` now excuses plain transport **only** towards a private-network database host (single-label service
name, loopback, RFC 1918/link-local) — never a publicly routable one. Known placeholder/default passwords
(`changeme`, `postgres`, `*_only`, …) are refused outside that same private case. **Unconfirmed:** whether the pinned
Prisma 6.19 engine honours `verify-ca` / `verify-full` identically to libpq. The documented Prisma form
(`require` + `sslaccept=strict`, root CA via `sslcert=`) is accepted too; the owner must confirm the chosen form
against their managed Postgres before relying on it — **decision D6**.

## 3. Secrets: handling and rotation

Nothing in this repository is a production secret, and the process never logs one (`logger: false`; the public auth
config returns variable *names* only when misconfigured, never values).

| Secret / value | Where it must live | Never |
|---|---|---|
| `DATABASE_URL` (password) | the platform secret store, injected as an env var at deploy time | in the image, in git, in compose |
| `NH_SOURCE_TRUST_KEYS` / source-verification public keys | config (public keys) | private halves anywhere in the app |
| OIDC client id, endpoints, issuer, audience, JWKS URI | plain config (public by design) | — |
| OIDC client secret | **not used** (public client). If D3 chooses a BFF it goes in the secret store | the browser bundle |

**Rotation (owner-run, no downtime design):**
1. *Database password*: create a second role/password → deploy `DATABASE_URL` with the new one → verify `/ready` →
   revoke the old one. The migrate job uses the same URL.
2. *OIDC signing keys*: the IdP rotates; the API re-reads JWKS on an unknown `kid` and every `NH_OIDC_JWKS_TTL_SECONDS`
   (default 300 s). Nothing to deploy.
3. *Source-verification keys*: add the new public key beside the old, switch the source system, retire the old key
   after the last in-flight claim.
4. *Compromise*: rotate DB credential first, then force token re-issue at the IdP (revocation is not supported by the
   API — shorten lifetimes), then review the append-only authority ledger for the exposure window.
5. Record each rotation (date, who, what) outside the application; the app keeps no rotation state.

The compose file's `pilot_only_change_me` and the CI database passwords are fixed, labelled, local-only values; the
process refuses them for any non-private database host.

## 4. Container and CI
* Image runs as the non-root `node` user, drops all capabilities and forbids privilege gain in compose, and declares
  a `HEALTHCHECK` on `/health`.
* The workflow token is `contents: read` for every job; third-party actions are pinned to full commit SHAs; checkout
  does not persist credentials. Image digests for `postgres:16` and `node:20-bookworm-slim` are **not** pinned yet
  (**decision D7**).

## 5. Environment reference
`NODE_ENV`, `NH_AUTH_MODE`, `NH_TLS_TERMINATION` (`proxy`|`none`), `NH_PRIVATE_PILOT`, `NH_TRUST_CONTAINER_NETWORK`,
`HOST`, `PORT`, `DATABASE_URL`; OIDC verification: `NH_OIDC_ISSUER`, `NH_OIDC_AUDIENCE`, `NH_OIDC_JWKS_URI`,
`NH_OIDC_ROLE_CLAIM`, `NH_OIDC_BOUNDARY_CLAIM`, `NH_OIDC_CLOCK_SKEW_SECONDS`, `NH_OIDC_JWKS_TTL_SECONDS`,
`NH_OIDC_TIMEOUT_MS`; OIDC browser flow (public values): `NH_OIDC_CLIENT_ID`, `NH_OIDC_AUTHORIZATION_ENDPOINT`,
`NH_OIDC_TOKEN_ENDPOINT`, `NH_OIDC_SCOPES` (default `openid`), `NH_OIDC_TOKEN_USE` (`access_token`|`id_token`).
Until all required OIDC values are set, `GET /api/auth/config` answers `configured:false` with the *names* missing and
the SPA shows no data.

## 6. What is verified, and where
All of it only by the official GitHub Actions run — the authoring sandbox cannot reach the npm registry, so no test
here was executed locally. See the commit/CI list in the hand-off report.

## 7. Not done (and why)
* No IdP integration was exercised end to end: that needs a real provider, a registered client and redirect URI,
  which are owner-created. The flow is covered by unit tests of the PKCE/state/nonce/expiry logic and by server
  negative tests; a live sign-in is **unverified**.
* No TLS proxy, certificate, or hosted environment exists. The transport rules are tested as code.
* No token revocation, rate limiting, or WAF.

## 8. Owner decisions required (nothing below has been assumed)
* **D1** Identity provider (any OIDC provider that issues RS256 JWTs and supports Authorization Code + PKCE).
* **D2** Client id, redirect URI (`https://<app-origin>/`), audience, and how `nh_role` / `nh_boundaries` claims are
  produced for each user; whether the API verifies the access token or the ID token (`NH_OIDC_TOKEN_USE`).
* **D3** Browser token storage: accept `sessionStorage` + CSP, or fund a backend-for-frontend with a confidential
  client and `HttpOnly` cookie.
* **D4** Token-endpoint CORS at the IdP for the app origin (or D3).
* **D5** TLS terminator (cloud load balancer, ingress, Caddy/nginx…), certificate source, and the network rule that
  makes the app port proxy-only.
* **D6** Managed Postgres and the confirmed TLS form (`verify-full` vs `require&sslaccept=strict`) with its root CA.
* **D7** Secret store and who runs rotation; pinning container image digests.
* **D8** Access-token lifetime ceiling (no revocation exists).
