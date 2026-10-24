// Test-only server for e2e/auth-journey.mjs. It is the REAL production composition — `buildProductionApp`
// serving the REAL built SPA from ./dist over the REAL Fastify app with the REAL OIDC verifier — with exactly
// one substitution: the JWKS fetch is answered from the public key the harness generated, because there is no
// identity provider to reach. Nothing here is a bypass: tokens are verified by the same code as production, and
// a token signed by any other key is refused (the harness proves that).
//
// SYNTHETIC ONLY. The key pair lives in the harness process; this process receives the PUBLIC half.
import { buildProductionApp } from "../server/productionServer";
import { createOidcIdentityResolver } from "../server/auth/verifiedIdentity";

const jwk = JSON.parse(process.env.AUTH_JOURNEY_JWK ?? "null");
if (!jwk) throw new Error("AUTH_JOURNEY_JWK is required");
const port = Number(process.env.PORT ?? 4100);
const IDP = "https://idp.journey.test";

const jwks: typeof fetch = async () =>
  new Response(JSON.stringify({ keys: [jwk] }), { status: 200, headers: { "content-type": "application/json" } });

const app = buildProductionApp({
  syntheticDemo: null,
  identityResolver: createOidcIdentityResolver({
    issuer: IDP, audience: "nh-api", jwksUri: `${IDP}/jwks.json`, roleClaim: "nh_role", boundaryClaim: "nh_boundaries",
    clockSkewSeconds: 0, cacheTtlMs: 60_000, timeoutMs: 2_000,
  }, jwks),
  publicAuthConfig: {
    mode: "oidc", configured: true, issuer: IDP, clientId: "nh-journey-client",
    authorizationEndpoint: `${IDP}/authorize`, tokenEndpoint: `${IDP}/token`, scope: "openid", tokenUse: "access_token",
  },
});
await app.listen({ port, host: "127.0.0.1" });
console.log(`auth-journey server listening on ${port}`);
