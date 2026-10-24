import { describe, expect, it } from "vitest";
import {
  DEV_IDENTITY_KEY, TOKEN_EXP_KEY, TOKEN_KEY, beginAuthorization, completeAuthorization, parseCallback,
  pkceChallenge, randomToken, rememberFlow, signOut, validStoredToken, type OidcClientConfig,
} from "./oidc";

const config: OidcClientConfig = {
  issuer: "https://idp.example.test", clientId: "public-client",
  authorizationEndpoint: "https://idp.example.test/authorize", tokenEndpoint: "https://idp.example.test/token",
  scope: "openid", tokenUse: "access_token",
};
const REDIRECT = "https://app.example.test/";

function memoryStore() {
  const m = new Map<string, string>();
  return { m, getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
}
const jwt = (claims: Record<string, unknown>) =>
  `${Buffer.from("{}").toString("base64url")}.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.sig`;
const tokenResponse = (body: unknown, status = 200): typeof fetch => async () => new Response(JSON.stringify(body), { status });

describe("PKCE", () => {
  it("matches the RFC 7636 appendix B test vector", async () => {
    expect(await pkceChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
  });
  it("random tokens are URL-safe and differ", () => {
    const a = randomToken(48), b = randomToken(48);
    expect(a).toMatch(/^[A-Za-z0-9_-]{64}$/);
    expect(a).not.toBe(b);
  });
  it("authorization request carries S256 PKCE, state and nonce, and never a secret", async () => {
    const r = await beginAuthorization(config, REDIRECT);
    const u = new URL(r.url);
    expect(u.origin + u.pathname).toBe(config.authorizationEndpoint);
    expect(u.searchParams.get("response_type")).toBe("code");
    expect(u.searchParams.get("code_challenge_method")).toBe("S256");
    expect(u.searchParams.get("code_challenge")).toBe(await pkceChallenge(r.verifier));
    expect(u.searchParams.get("state")).toBe(r.state);
    expect(u.searchParams.get("redirect_uri")).toBe(REDIRECT);
    expect(u.searchParams.has("client_secret")).toBe(false);
    expect(u.searchParams.has("code_verifier")).toBe(false);
  });
});

describe("callback parsing", () => {
  it("distinguishes none / code / error and never echoes error_description", () => {
    expect(parseCallback("")).toEqual({ kind: "none" });
    expect(parseCallback("?code=c&state=s")).toEqual({ kind: "code", code: "c", state: "s" });
    expect(parseCallback("?code=c")).toEqual({ kind: "error", error: "invalid_response" });
    expect(parseCallback("?error=access_denied&error_description=<script>")).toEqual({ kind: "error", error: "access_denied" });
    expect(parseCallback("?error=<script>alert(1)</script>")).toEqual({ kind: "error", error: "invalid_response" });
  });
});

describe("completing the authorization", () => {
  const exp = Math.floor(Date.now() / 1000) + 600;

  async function begin(store: ReturnType<typeof memoryStore>) {
    const r = await beginAuthorization(config, REDIRECT);
    rememberFlow(r, store);
    return r;
  }

  it("exchanges the code with the verifier, stores the token and its expiry, and consumes the flow", async () => {
    const store = memoryStore();
    const r = await begin(store);
    const captured: { body?: URLSearchParams } = {};
    const f: typeof fetch = async (_url, init) => { captured.body = init?.body as URLSearchParams; return new Response(JSON.stringify({ access_token: jwt({ exp }) })); };
    await completeAuthorization(config, { kind: "code", code: "abc", state: r.state }, REDIRECT, f, store);
    expect(captured.body?.get("code_verifier")).toBe(r.verifier);
    expect(captured.body?.get("grant_type")).toBe("authorization_code");
    expect(captured.body?.has("client_secret")).toBe(false);
    expect(store.m.get(TOKEN_KEY)).toBeTruthy();
    expect(validStoredToken(store)).toBe(store.m.get(TOKEN_KEY));
    // replay: the flow was consumed
    await expect(completeAuthorization(config, { kind: "code", code: "abc", state: r.state }, REDIRECT, f, store)).rejects.toThrow(/state/);
  });

  it("refuses a state mismatch and a missing flow, without calling the token endpoint", async () => {
    const store = memoryStore();
    await begin(store);
    let called = false;
    const f: typeof fetch = async () => { called = true; return new Response("{}"); };
    await expect(completeAuthorization(config, { kind: "code", code: "c", state: "attacker" }, REDIRECT, f, store)).rejects.toThrow(/state/);
    await expect(completeAuthorization(config, { kind: "code", code: "c", state: "x" }, REDIRECT, f, memoryStore())).rejects.toThrow(/state/);
    expect(called).toBe(false);
  });

  it("refuses refused/invalid/empty/expired/non-JWT token responses and stores nothing", async () => {
    for (const [f, re] of [
      [tokenResponse({}, 400), /refused/],
      [tokenResponse({ id_token: jwt({ exp }) }), /no access_token/],
      [tokenResponse({ access_token: "not-a-jwt" }), /not a JWT/],
      [tokenResponse({ access_token: jwt({ exp: 1 }) }), /expired/],
      [tokenResponse({ access_token: jwt({}) }), /expired/],
      [(async () => { throw new Error("net"); }) as typeof fetch, /could not be reached/],
    ] as const) {
      const store = memoryStore();
      const r = await begin(store);
      await expect(completeAuthorization(config, { kind: "code", code: "c", state: r.state }, REDIRECT, f, store)).rejects.toThrow(re);
      expect(store.m.has(TOKEN_KEY)).toBe(false);
    }
  });

  it("binds the nonce when the ID token is the bearer", async () => {
    const idCfg: OidcClientConfig = { ...config, tokenUse: "id_token" };
    const store = memoryStore();
    const r = await begin(store);
    await expect(completeAuthorization(idCfg, { kind: "code", code: "c", state: r.state }, REDIRECT,
      tokenResponse({ id_token: jwt({ exp, nonce: "other" }) }), store)).rejects.toThrow(/nonce/);
    const store2 = memoryStore();
    const r2 = await begin(store2);
    await completeAuthorization(idCfg, { kind: "code", code: "c", state: r2.state }, REDIRECT,
      tokenResponse({ id_token: jwt({ exp, nonce: r2.nonce }) }), store2);
    expect(store2.m.has(TOKEN_KEY)).toBe(true);
  });
});

describe("stored token lifetime", () => {
  it("an expired or near-expiry token is removed, not returned; sign-out clears everything", () => {
    const store = memoryStore();
    store.setItem(TOKEN_KEY, "t"); store.setItem(TOKEN_EXP_KEY, String(Math.floor(Date.now() / 1000) - 1));
    expect(validStoredToken(store)).toBeNull();
    expect(store.m.has(TOKEN_KEY)).toBe(false);
    store.setItem(TOKEN_KEY, "t"); store.setItem(TOKEN_EXP_KEY, String(Math.floor(Date.now() / 1000) + 2));
    expect(validStoredToken(store)).toBeNull(); // inside the 5 s margin
    store.setItem(TOKEN_KEY, "t"); store.setItem(TOKEN_EXP_KEY, String(Math.floor(Date.now() / 1000) + 900));
    store.setItem(DEV_IDENTITY_KEY, "x");
    expect(validStoredToken(store)).toBe("t");
    signOut(store);
    expect(store.m.size).toBe(0);
  });
  it("a token with no recorded expiry is not trusted", () => {
    const store = memoryStore();
    store.setItem(TOKEN_KEY, "t");
    expect(validStoredToken(store)).toBeNull();
  });
});
