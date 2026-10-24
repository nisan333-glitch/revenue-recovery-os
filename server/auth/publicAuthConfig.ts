// What the browser needs to start a sign-in, and NOTHING it must not have.
//
// PROVIDER-NEUTRAL BY CONSTRUCTION. No identity provider is chosen, bundled or assumed here: the owner names
// one by setting the variables below, and until they do the answer is `configured: false` and the SPA refuses
// to proceed — it never falls back to anything weaker. Nothing in this module is a secret: the client is a
// PUBLIC client (Authorization Code + PKCE), so there is no client secret to hold, log or leak, and every value
// returned is something the browser would have to be told anyway. Tokens are verified by the server
// (`verifiedIdentity.ts`) on every request; this module only describes where to go to get one.
import { authModeFromEnvironment, type AuthMode } from "./verifiedIdentity";

export type PublicAuthConfig =
  | { readonly mode: "dev-headers" }
  | { readonly mode: "oidc"; readonly configured: false; readonly missing: readonly string[] }
  | {
      readonly mode: "oidc";
      readonly configured: true;
      readonly issuer: string;
      readonly clientId: string;
      readonly authorizationEndpoint: string;
      readonly tokenEndpoint: string;
      readonly scope: string;
      /** Which token the API is configured to verify. The audience (`NH_OIDC_AUDIENCE`) must match THIS token. */
      readonly tokenUse: "access_token" | "id_token";
    };

const NOT_CONFIGURED = (missing: readonly string[]): PublicAuthConfig => ({ mode: "oidc", configured: false, missing });

function httpsUrl(raw: string | undefined): string | null {
  if (!raw?.trim()) return null;
  try {
    const url = new URL(raw.trim());
    if (url.protocol !== "https:" || url.username || url.password || url.hash) return null;
    return url.toString();
  } catch {
    return null;
  }
}

export function readPublicAuthConfig(env: Readonly<Record<string, string | undefined>> = process.env): PublicAuthConfig {
  let mode: AuthMode;
  try {
    mode = authModeFromEnvironment(env);
  } catch {
    return NOT_CONFIGURED(["NH_AUTH_MODE"]);
  }
  if (mode === "dev-headers") return { mode };

  // Names only, never values: a misconfiguration must be diagnosable without echoing anything back.
  const missing: string[] = [];
  const issuer = httpsUrl(env.NH_OIDC_ISSUER);
  if (!issuer) missing.push("NH_OIDC_ISSUER");
  if (!env.NH_OIDC_AUDIENCE?.trim()) missing.push("NH_OIDC_AUDIENCE");
  if (!httpsUrl(env.NH_OIDC_JWKS_URI)) missing.push("NH_OIDC_JWKS_URI");
  const clientId = env.NH_OIDC_CLIENT_ID?.trim();
  if (!clientId) missing.push("NH_OIDC_CLIENT_ID");
  const authorizationEndpoint = httpsUrl(env.NH_OIDC_AUTHORIZATION_ENDPOINT);
  if (!authorizationEndpoint) missing.push("NH_OIDC_AUTHORIZATION_ENDPOINT");
  const tokenEndpoint = httpsUrl(env.NH_OIDC_TOKEN_ENDPOINT);
  if (!tokenEndpoint) missing.push("NH_OIDC_TOKEN_ENDPOINT");
  const tokenUse = (env.NH_OIDC_TOKEN_USE?.trim() || "access_token");
  if (tokenUse !== "access_token" && tokenUse !== "id_token") missing.push("NH_OIDC_TOKEN_USE");
  const scope = env.NH_OIDC_SCOPES?.trim() || "openid";
  if (!/^[\x21\x23-\x5b\x5d-\x7e]+( [\x21\x23-\x5b\x5d-\x7e]+)*$/.test(scope)) missing.push("NH_OIDC_SCOPES");
  if (missing.length > 0) return NOT_CONFIGURED(missing);
  return {
    mode: "oidc", configured: true,
    issuer: issuer!, clientId: clientId!,
    authorizationEndpoint: authorizationEndpoint!, tokenEndpoint: tokenEndpoint!,
    scope, tokenUse: tokenUse as "access_token" | "id_token",
  };
}

/**
 * The page's Content-Security-Policy. `connect-src` is `'self'` plus, ONLY when browser sign-in is fully
 * configured, the single origin of the identity provider's token endpoint. Scripts stay `'self'`-only.
 */
export function buildContentSecurityPolicy(config: PublicAuthConfig): string {
  const connect = ["'self'"];
  if (config.mode === "oidc" && config.configured) connect.push(new URL(config.tokenEndpoint).origin);
  return [
    "default-src 'self'", "script-src 'self'", "style-src 'self' 'unsafe-inline'", `connect-src ${connect.join(" ")}`,
    "img-src 'self' data:", "frame-ancestors 'none'", "base-uri 'self'", "object-src 'none'",
  ].join("; ");
}

/**
 * Start-up rule for the process that SERVES THE BROWSER APP in OIDC mode: if the verifier is configured but the
 * browser sign-in values are not, the deployment would come up as a screen that can never sign anyone in. Refuse
 * to start instead, naming the variables (never values). Dev-headers deployments are unaffected.
 */
export function assertBrowserSignInConfigured(env: Readonly<Record<string, string | undefined>> = process.env): void {
  const config = readPublicAuthConfig(env);
  if (config.mode === "oidc" && !config.configured) {
    throw new Error(`browser sign-in is not configured; set: ${config.missing.join(", ")}`);
  }
}
