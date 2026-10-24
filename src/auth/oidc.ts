// Browser sign-in: OpenID Connect Authorization Code flow with PKCE (S256) as a PUBLIC client.
//
// WHAT THIS DOES NOT DO, ON PURPOSE. It decides nothing about who the user is or what they may do. The token it
// obtains is sent as `Authorization: Bearer` and the SERVER verifies signature, issuer, audience, expiry and the
// role / boundary claims on every request (server/auth/verifiedIdentity.ts), then enforces role and
// separation-of-duties rules. Reading `exp` here is only to avoid sending a token that is plainly dead.
//
// PROVIDER-NEUTRAL. Endpoints and the client id arrive from `GET /api/auth/config`, which the owner populates
// with the identity provider of their choice. Nothing is hardcoded, bundled or defaulted.
//
// STORAGE TRADE-OFF, STATED. The token lives in sessionStorage (per tab, gone on close). A script that runs in
// the page could read it, which is why the server sends a strict CSP (`script-src 'self'`). A server-side
// session (a backend-for-frontend holding a confidential-client secret in an HttpOnly cookie) is stronger and
// needs a client secret the owner must create — recorded as a decision in docs/SECURITY_DEPLOYMENT_CONTRACT_V1.md.
export interface OidcClientConfig {
  readonly issuer: string;
  readonly clientId: string;
  readonly authorizationEndpoint: string;
  readonly tokenEndpoint: string;
  readonly scope: string;
  readonly tokenUse: "access_token" | "id_token";
}

export type AuthConfigDTO =
  | { readonly mode: "dev-headers" }
  | { readonly mode: "oidc"; readonly configured: false; readonly missing: readonly string[] }
  | ({ readonly mode: "oidc"; readonly configured: true } & OidcClientConfig);

export const TOKEN_KEY = "nh_access_token";
export const TOKEN_EXP_KEY = "nh_access_token_exp";
export const DEV_IDENTITY_KEY = "nh_dev_identity";
const FLOW_KEY = "nh_oidc_flow";

interface Store {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function defaultStore(): Store | null {
  try { return typeof sessionStorage === "undefined" ? null : sessionStorage; } catch { return null; }
}

export function isDevBuild(): boolean {
  return Boolean((import.meta as ImportMeta & { env?: { DEV?: boolean } }).env?.DEV);
}

const b64url = (bytes: Uint8Array): string => {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

export function randomToken(byteLength = 32, crypto_: Crypto = globalThis.crypto): string {
  const bytes = new Uint8Array(byteLength);
  crypto_.getRandomValues(bytes);
  return b64url(bytes);
}

export async function pkceChallenge(verifier: string, crypto_: Crypto = globalThis.crypto): Promise<string> {
  const digest = await crypto_.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return b64url(new Uint8Array(digest));
}

export interface AuthorizationRequest { readonly url: string; readonly state: string; readonly verifier: string; readonly nonce: string }

export async function beginAuthorization(
  config: OidcClientConfig, redirectUri: string, crypto_: Crypto = globalThis.crypto,
): Promise<AuthorizationRequest> {
  const verifier = randomToken(48, crypto_); // 64 chars, within RFC 7636's 43–128
  const state = randomToken(24, crypto_);
  const nonce = randomToken(24, crypto_);
  const url = new URL(config.authorizationEndpoint);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("scope", config.scope);
  url.searchParams.set("state", state);
  url.searchParams.set("nonce", nonce);
  url.searchParams.set("code_challenge", await pkceChallenge(verifier, crypto_));
  url.searchParams.set("code_challenge_method", "S256");
  return { url: url.toString(), state, verifier, nonce };
}

export function rememberFlow(flow: Pick<AuthorizationRequest, "state" | "verifier" | "nonce">, store: Store | null = defaultStore()): void {
  try { store?.setItem(FLOW_KEY, JSON.stringify({ state: flow.state, verifier: flow.verifier, nonce: flow.nonce })); } catch { /* sign-in will simply fail closed */ }
}

function takeFlow(store: Store | null): { state: string; verifier: string; nonce: string } | null {
  try {
    const raw = store?.getItem(FLOW_KEY);
    store?.removeItem(FLOW_KEY); // one use: a replayed callback finds nothing
    if (!raw) return null;
    const v = JSON.parse(raw) as Record<string, unknown>;
    return typeof v.state === "string" && typeof v.verifier === "string" && typeof v.nonce === "string"
      ? { state: v.state, verifier: v.verifier, nonce: v.nonce } : null;
  } catch { return null; }
}

export type CallbackParams =
  | { readonly kind: "none" }
  | { readonly kind: "error"; readonly error: string }
  | { readonly kind: "code"; readonly code: string; readonly state: string };

/** Names the IdP's error code only; never echoes `error_description` (attacker-controlled text). */
export function parseCallback(search: string): CallbackParams {
  const params = new URLSearchParams(search);
  const error = params.get("error");
  if (error) return { kind: "error", error: /^[a-z_]{1,64}$/.test(error) ? error : "invalid_response" };
  const code = params.get("code");
  const state = params.get("state");
  if (!code && !state) return { kind: "none" };
  if (!code || !state) return { kind: "error", error: "invalid_response" };
  return { kind: "code", code, state };
}

export class SignInError extends Error {}

function decodePayload(token: string): Record<string, unknown> | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const padded = parts[1]!.replace(/-/g, "+").replace(/_/g, "/");
    const json = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
    const v = JSON.parse(json) as unknown;
    return v && typeof v === "object" ? (v as Record<string, unknown>) : null;
  } catch { return null; }
}

export async function completeAuthorization(
  config: OidcClientConfig,
  callback: Extract<CallbackParams, { kind: "code" }>,
  redirectUri: string,
  fetchImpl: typeof fetch = fetch,
  store: Store | null = defaultStore(),
  now: () => number = () => Date.now(),
): Promise<void> {
  const flow = takeFlow(store);
  if (!flow || flow.state !== callback.state) throw new SignInError("sign-in could not be verified (state mismatch)");
  const body = new URLSearchParams({
    grant_type: "authorization_code", code: callback.code, redirect_uri: redirectUri,
    client_id: config.clientId, code_verifier: flow.verifier,
  });
  let res: Response;
  try {
    res = await fetchImpl(config.tokenEndpoint, {
      method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" }, body,
    });
  } catch { throw new SignInError("the identity provider could not be reached"); }
  if (!res.ok) throw new SignInError("the identity provider refused the sign-in");
  let json: Record<string, unknown>;
  try { json = (await res.json()) as Record<string, unknown>; } catch { throw new SignInError("the identity provider returned an invalid response"); }
  const token = json[config.tokenUse];
  if (typeof token !== "string" || !token) throw new SignInError(`the identity provider returned no ${config.tokenUse}`);
  const payload = decodePayload(token);
  if (!payload) throw new SignInError("the token is not a JWT this application can use");
  // The nonce is bound to an ID token; an access token has none to compare.
  if (config.tokenUse === "id_token" && payload.nonce !== flow.nonce) throw new SignInError("sign-in could not be verified (nonce mismatch)");
  const exp = payload.exp;
  if (typeof exp !== "number" || exp * 1000 <= now()) throw new SignInError("the token is already expired");
  try {
    store?.setItem(TOKEN_KEY, token);
    store?.setItem(TOKEN_EXP_KEY, String(exp));
  } catch { throw new SignInError("this browser would not keep the sign-in for this tab"); }
}

/** The stored bearer token, only while it is not expired. An expired one is removed, not returned. */
export function validStoredToken(store: Store | null = defaultStore(), now: () => number = () => Date.now()): string | null {
  try {
    const token = store?.getItem(TOKEN_KEY);
    const exp = Number(store?.getItem(TOKEN_EXP_KEY));
    if (!token) return null;
    if (!Number.isFinite(exp) || exp * 1000 <= now() + 5_000) { signOut(store); return null; }
    return token;
  } catch { return null; }
}

export function signOut(store: Store | null = defaultStore()): void {
  try {
    store?.removeItem(TOKEN_KEY);
    store?.removeItem(TOKEN_EXP_KEY);
    store?.removeItem(DEV_IDENTITY_KEY);
    store?.removeItem(FLOW_KEY);
  } catch { /* nothing to clear */ }
}

export const AUTH_EXPIRED_EVENT = "nh-auth-expired";
