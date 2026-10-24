// @vitest-environment jsdom
// The browser integration of sign-in, rendered for real (react-dom + jsdom) with the network stubbed.
// What is asserted is the GATE's behaviour: nothing is shown to an unauthenticated visitor, every failure of the
// callback (missing/forged state, provider error, refused code, bad token, rejected session) ends at a closed
// screen with no token stored, and a token is trusted only after the SERVER's /auth/whoami accepted it.
import { webcrypto } from "node:crypto";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AuthGate } from "./AuthGate";
import { AUTH_EXPIRED_EVENT, TOKEN_KEY } from "./oidc";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
Object.defineProperty(globalThis, "crypto", { value: webcrypto, configurable: true });

const CONFIG = {
  mode: "oidc", configured: true, issuer: "https://idp.example.test", clientId: "public-client",
  authorizationEndpoint: "https://idp.example.test/authorize", tokenEndpoint: "https://idp.example.test/token",
  scope: "openid", tokenUse: "access_token",
};
const jwt = (claims: Record<string, unknown>) =>
  `${Buffer.from("{}").toString("base64url")}.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.sig`;
const future = () => Math.floor(Date.now() / 1000) + 900;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

type Handler = (init?: RequestInit) => Response | Promise<Response>;
interface Net { calls: string[]; bodies: Record<string, string>; routes: Record<string, Handler> }
function net(routes: Record<string, Handler>): Net {
  const state: Net = { calls: [], bodies: {}, routes };
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    state.calls.push(url);
    if (init?.body) state.bodies[url] = String(init.body);
    const handler = routes[url];
    if (!handler) throw new Error(`unexpected request ${url}`);
    return handler(init);
  }) as typeof fetch;
  return state;
}

let root: Root | null = null;
let container: HTMLElement;
const realFetch = globalThis.fetch;
beforeEach(() => {
  sessionStorage.clear();
  window.history.replaceState(null, "", "/");
  container = document.createElement("div");
  document.body.appendChild(container);
});
afterEach(async () => {
  if (root) { const r = root; await act(async () => { r.unmount(); }); root = null; }
  container.remove();
  globalThis.fetch = realFetch;
});

async function settle() {
  for (let i = 0; i < 20; i++) await act(async () => { await new Promise((r) => setTimeout(r, 5)); });
}
async function mount(props: { devBuild?: boolean; navigate?: (u: string) => void } = {}) {
  root = createRoot(container);
  await act(async () => {
    root!.render(createElement(AuthGate, { devBuild: false, ...props }, createElement("div", { "data-testid": "app-content" }, "APP CONTENT")));
  });
  await settle();
}
const text = () => container.textContent ?? "";
const hasApp = () => container.querySelector('[data-testid="app-content"]') !== null;
const button = (label: string) => Array.from(container.querySelectorAll("button")).find((b) => b.textContent === label);
async function click(label: string) {
  const b = button(label);
  expect(b, `button "${label}"`).toBeTruthy();
  await act(async () => { b!.click(); });
  await settle();
}
/** Run a real sign-in click and return the authorization URL the browser would have been sent to. */
async function startSignIn(): Promise<URL> {
  let target = "";
  await mount({ navigate: (u) => { target = u; } });
  await click("Sign in");
  expect(target).not.toBe("");
  await act(async () => { root!.unmount(); }); root = null;
  return new URL(target);
}

describe("AuthGate — closed by default", () => {
  it("an unconfigured server shows the missing variable NAMES and no application", async () => {
    const n = net({ "/api/auth/config": () => json({ mode: "oidc", configured: false, missing: ["NH_OIDC_ISSUER", "NH_OIDC_CLIENT_ID"] }) });
    await mount();
    expect(hasApp()).toBe(false);
    expect(text()).toContain("not configured");
    expect(text()).toContain("NH_OIDC_ISSUER, NH_OIDC_CLIENT_ID");
    expect(n.calls).toEqual(["/api/auth/config"]);
  });

  it("no token: only a sign-in button, no application, and no protected request", async () => {
    const n = net({ "/api/auth/config": () => json(CONFIG) });
    await mount();
    expect(hasApp()).toBe(false);
    expect(button("Sign in")).toBeTruthy();
    expect(n.calls).toEqual(["/api/auth/config"]);
  });

  it("an unreachable config endpoint fails closed with a retry, never open", async () => {
    net({ "/api/auth/config": () => json({}, 500) });
    await mount();
    expect(hasApp()).toBe(false);
    expect(button("Try again")).toBeTruthy();
  });

  it("the dev-headers answer from the SERVER opens the app (the server enforces its own loopback rule)", async () => {
    net({ "/api/auth/config": () => json({ mode: "dev-headers" }) });
    await mount();
    expect(hasApp()).toBe(true);
  });

  it("a Vite dev build opens without asking the server anything", async () => {
    const n = net({});
    await mount({ devBuild: true });
    expect(hasApp()).toBe(true);
    expect(n.calls).toEqual([]);
  });
});

describe("AuthGate — sign-in start", () => {
  it("redirects to the provider with S256 PKCE, state and nonce, and stores the one-time flow", async () => {
    net({ "/api/auth/config": () => json(CONFIG) });
    const url = await startSignIn();
    expect(url.origin + url.pathname).toBe(CONFIG.authorizationEndpoint);
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("code_challenge")).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(url.searchParams.get("state")).toBeTruthy();
    expect(url.searchParams.get("client_id")).toBe("public-client");
    expect(url.searchParams.has("client_secret")).toBe(false);
    expect(sessionStorage.getItem(TOKEN_KEY)).toBeNull();
  });
});

describe("AuthGate — callback failures all end closed with nothing stored", () => {
  const tokenUrl = CONFIG.tokenEndpoint;

  it("a callback with no stored flow (forged or replayed state) is refused before the token endpoint", async () => {
    const n = net({ "/api/auth/config": () => json(CONFIG), [tokenUrl]: () => json({ access_token: jwt({ exp: future() }) }) });
    window.history.replaceState(null, "", "/?code=attacker-code&state=attacker-state");
    await mount();
    expect(hasApp()).toBe(false);
    expect(text()).toContain("state mismatch");
    expect(n.calls).not.toContain(tokenUrl);
    expect(sessionStorage.getItem(TOKEN_KEY)).toBeNull();
    expect(window.location.search).toBe(""); // code and state are removed from the address bar
    expect(button("Try again")).toBeTruthy();
  });

  it("a callback whose state differs from the one we issued is refused", async () => {
    net({ "/api/auth/config": () => json(CONFIG) });
    await startSignIn();
    const n = net({ "/api/auth/config": () => json(CONFIG), [tokenUrl]: () => json({ access_token: jwt({ exp: future() }) }) });
    window.history.replaceState(null, "", "/?code=c&state=NOT-THE-ISSUED-STATE");
    await mount();
    expect(text()).toContain("state mismatch");
    expect(n.calls).not.toContain(tokenUrl);
    expect(sessionStorage.getItem(TOKEN_KEY)).toBeNull();
  });

  it("a provider error is named by its code only; its free text is never rendered", async () => {
    net({ "/api/auth/config": () => json(CONFIG) });
    window.history.replaceState(null, "", "/?error=access_denied&error_description=%3Cimg%20src%3Dx%20onerror%3Dalert(1)%3E");
    await mount();
    expect(hasApp()).toBe(false);
    expect(text()).toContain("access_denied");
    expect(text()).not.toContain("onerror");
    expect(container.querySelector("img")).toBeNull();
    expect(button("Sign in")).toBeTruthy();
  });

  it("a code missing its state is an invalid response", async () => {
    net({ "/api/auth/config": () => json(CONFIG) });
    window.history.replaceState(null, "", "/?code=only-a-code");
    await mount();
    expect(hasApp()).toBe(false);
    expect(text()).toContain("invalid_response");
  });

  async function withIssuedFlow(token: Handler, whoami?: Handler) {
    net({ "/api/auth/config": () => json(CONFIG) });
    const url = await startSignIn();
    const n = net({
      "/api/auth/config": () => json(CONFIG),
      [tokenUrl]: token,
      "/api/auth/whoami": whoami ?? (() => json({ actorId: "operator-1", role: "operator", boundaryIds: ["t"] })),
    });
    window.history.replaceState(null, "", `/?code=good-code&state=${url.searchParams.get("state")}`);
    await mount();
    return n;
  }

  it("a token endpoint that refuses the code ends closed", async () => {
    await withIssuedFlow(() => json({ error: "invalid_grant" }, 400));
    expect(hasApp()).toBe(false);
    expect(text()).toContain("refused");
    expect(sessionStorage.getItem(TOKEN_KEY)).toBeNull();
  });

  it("an expired, non-JWT or empty token response is never stored", async () => {
    for (const body of [{ access_token: jwt({ exp: 1 }) }, { access_token: "opaque" }, {}]) {
      await withIssuedFlow(() => json(body));
      expect(hasApp(), JSON.stringify(body)).toBe(false);
      expect(sessionStorage.getItem(TOKEN_KEY), JSON.stringify(body)).toBeNull();
      if (root) { await act(async () => { root!.unmount(); }); root = null; }
    }
  });

  it("a token the SERVER does not accept (forged / wrong key / wrong audience) is discarded and the app stays closed", async () => {
    const n = await withIssuedFlow(() => json({ access_token: jwt({ exp: future() }) }), () => json({ error: "unauthorized" }, 401));
    expect(n.calls).toContain("/api/auth/whoami");
    expect(hasApp()).toBe(false);
    expect(text()).toContain("not accepted");
    expect(sessionStorage.getItem(TOKEN_KEY)).toBeNull();
  });
});

describe("AuthGate — a verified session", () => {
  async function signedIn() {
    net({ "/api/auth/config": () => json(CONFIG) });
    const url = await startSignIn();
    const token = jwt({ exp: future() });
    const n = net({
      "/api/auth/config": () => json(CONFIG),
      [CONFIG.tokenEndpoint]: () => json({ access_token: token }),
      "/api/auth/whoami": () => json({ actorId: "operator-1", role: "operator", boundaryIds: ["tenant-1"] }),
    });
    window.history.replaceState(null, "", `/?code=good-code&state=${url.searchParams.get("state")}`);
    await mount();
    return { n, token, challenge: url.searchParams.get("code_challenge") };
  }

  it("shows the application only after the server accepted the token, with the server's reading of the identity", async () => {
    const { n, token, challenge } = await signedIn();
    expect(hasApp()).toBe(true);
    expect(container.querySelector('[data-testid="auth-bar"]')?.textContent).toContain("operator-1");
    expect(container.querySelector('[data-testid="auth-bar"]')?.textContent).toContain("operator");
    expect(sessionStorage.getItem(TOKEN_KEY)).toBe(token);
    expect(window.location.search).toBe("");
    const body = new URLSearchParams(n.bodies[CONFIG.tokenEndpoint]);
    expect(body.get("grant_type")).toBe("authorization_code");
    expect(body.get("code")).toBe("good-code");
    expect(body.get("code_verifier")).toMatch(/^[A-Za-z0-9_-]{64}$/);
    expect(body.has("client_secret")).toBe(false);
    // The verifier really is the preimage of the challenge sent to the provider (RFC 7636 S256).
    const digest = Buffer.from(await webcrypto.subtle.digest("SHA-256", new TextEncoder().encode(body.get("code_verifier")!))).toString("base64url");
    expect(digest).toBe(challenge);
  });

  it("sign-out clears the token and closes the app", async () => {
    await signedIn();
    await click("Sign out");
    expect(hasApp()).toBe(false);
    expect(sessionStorage.getItem(TOKEN_KEY)).toBeNull();
  });

  it("when the API reports the session expired, the app closes again", async () => {
    await signedIn();
    net({
      "/api/auth/config": () => json(CONFIG),
      "/api/auth/whoami": () => json({ error: "unauthorized" }, 401),
    });
    await act(async () => { window.dispatchEvent(new Event(AUTH_EXPIRED_EVENT)); });
    await settle();
    expect(hasApp()).toBe(false);
    expect(sessionStorage.getItem(TOKEN_KEY)).toBeNull();
  });
});
