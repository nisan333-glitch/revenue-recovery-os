// EP-20 · Browser sign-in, end to end: a REAL Chromium, the REAL production SPA bundle (not the Vite dev server,
// so the dev-header identity is physically absent), the REAL Fastify app and the REAL OIDC verifier.
//
// THE ONLY SUBSTITUTION is the identity provider, which does not exist here and which this harness will not
// invent credentials for: requests to https://idp.journey.test are answered inside the browser by
// Playwright, and the server's JWKS fetch is answered with the public half of a key generated for this run.
// So what is proven is OUR side of the protocol — PKCE, state, callback handling, token storage, server-side
// verification, role enforcement, fail-closed behaviour — and NOT any real provider's behaviour. That is stated
// rather than implied: a live sign-in against a real provider is still unverified (owner decisions D1–D4).
//
// Negative scenarios (each in a fresh browser context, so no state leaks between them):
//   unauthenticated · state mismatch · provider error · token endpoint refusal · expired token · token signed
//   by a stranger's key · wrong role · forged dev headers · header escalation · replayed callback · CSP.
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { createHash, generateKeyPairSync, sign } from "node:crypto";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.env.AUTH_JOURNEY_PORT ?? 4100);
const BASE = `http://127.0.0.1:${PORT}`;
const IDP = "https://idp.journey.test";
const CHROMIUM = "/opt/pw-browsers/chromium";
const executablePath = existsSync(CHROMIUM) ? CHROMIUM : undefined;

if (!existsSync(resolve(ROOT, "dist/index.html"))) {
  console.error("dist/ is missing — run `vite build` first (npm run test:auth-journey does).");
  process.exit(2);
}

let failures = 0;
function annotate(message) {
  const text = String(message).replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A").slice(0, 900);
  console.log(`::error title=auth-journey::${text}`);
}
function check(name, ok, detail = "") {
  if (!ok) failures += 1;
  console.log(`${ok ? "PASS" : "FAIL"} · ${name}${detail ? ` · ${detail}` : ""}`);
  if (!ok) annotate(`FAIL · ${name}${detail ? ` · ${detail}` : ""}`);
}

// ── Synthetic key material: generated per run, never persisted, never a credential for anything real. ──
const good = generateKeyPairSync("rsa", { modulusLength: 2048 });
const stranger = generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = { ...good.publicKey.export({ format: "jwk" }), kid: "journey-key", alg: "RS256", use: "sig", key_ops: ["verify"] };
const enc = (v) => Buffer.from(JSON.stringify(v)).toString("base64url");
function makeToken({ role = "operator", key = good.privateKey, exp = Math.floor(Date.now() / 1000) + 600, boundaries = ["journey-tenant"] } = {}) {
  const header = enc({ alg: "RS256", kid: "journey-key", typ: "JWT" });
  const claims = enc({ iss: IDP, aud: "nh-api", sub: "journey-operator", nh_role: role, nh_boundaries: boundaries, exp });
  return `${header}.${claims}.${sign("RSA-SHA256", Buffer.from(`${header}.${claims}`), key).toString("base64url")}`;
}
const s256 = (verifier) => createHash("sha256").update(verifier).digest("base64url");

// ── Server process ──
function startServer() {
  const child = spawn(process.execPath, [resolve(ROOT, "node_modules/.bin/vite-node"), "e2e/auth-journey-server.ts"], {
    cwd: ROOT, detached: true, stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, PORT: String(PORT), AUTH_JOURNEY_JWK: JSON.stringify(jwk), NODE_ENV: "test" },
  });
  child.stdout.on("data", (b) => process.env.AUTH_JOURNEY_VERBOSE && console.log(`[server] ${b}`));
  child.stderr.on("data", (b) => console.error(`[server] ${b}`));
  return child;
}
async function waitFor(label, probe, timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  let last = "";
  while (Date.now() < deadline) {
    try { if (await probe()) return; } catch (e) { last = e instanceof Error ? e.message : String(e); }
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error(`${label} did not become reachable within ${timeoutMs}ms${last ? ` (${last})` : ""}`);
}
const stop = (child) => { if (child?.pid) { try { process.kill(-child.pid, "SIGTERM"); } catch { /* gone */ } } };

// ── A fresh browser context whose identity provider is a scripted stand-in. ──
async function newScenario(browser, { authorize = "ok", token = "ok", tokenValue } = {}) {
  const context = await browser.newContext();
  const page = await context.newPage();
  const seen = { api: [], tokenRequests: [], csp: [], authorizeUrl: null, pkce: null };
  page.on("request", (r) => { const u = new URL(r.url()); if (u.origin === BASE && u.pathname.startsWith("/api/")) seen.api.push(u.pathname); });
  page.on("console", (m) => { if (/content security policy/i.test(m.text())) seen.csp.push(m.text()); });
  const challenges = new Map(); // code -> code_challenge

  await context.route(`${IDP}/authorize*`, async (route) => {
    const url = new URL(route.request().url());
    seen.authorizeUrl = url;
    const redirect = new URL(`${BASE}/`);
    if (authorize === "error") {
      redirect.searchParams.set("error", "access_denied");
      redirect.searchParams.set("error_description", "<img src=x onerror=alert(1)>");
    } else {
      const code = `code-${Math.random().toString(36).slice(2)}`;
      challenges.set(code, url.searchParams.get("code_challenge"));
      redirect.searchParams.set("code", code);
      redirect.searchParams.set("state", authorize === "wrong-state" ? "forged-state" : url.searchParams.get("state"));
    }
    await route.fulfill({ status: 302, headers: { location: redirect.toString() } });
  });
  await context.route(`${IDP}/token`, async (route) => {
    const body = new URLSearchParams(route.request().postData() ?? "");
    seen.tokenRequests.push(Object.fromEntries(body));
    const cors = { "access-control-allow-origin": BASE, "content-type": "application/json" };
    if (token === "refuse") return route.fulfill({ status: 400, headers: cors, body: JSON.stringify({ error: "invalid_grant" }) });
    // A faithful provider verifies PKCE: the verifier must hash to the challenge issued with this code.
    const pkceOk = challenges.get(body.get("code")) === s256(body.get("code_verifier") ?? "");
    seen.pkce = pkceOk;
    if (!pkceOk) return route.fulfill({ status: 400, headers: cors, body: JSON.stringify({ error: "invalid_grant" }) });
    return route.fulfill({ status: 200, headers: cors, body: JSON.stringify({ access_token: tokenValue ?? makeToken() }) });
  });
  return { context, page, seen };
}
const stored = (page) => page.evaluate(() => sessionStorage.getItem("nh_access_token"));
const bodyText = (page) => page.evaluate(() => document.body.innerText);
async function waitForText(page, re, timeout = 15_000) {
  try { await page.waitForFunction((src) => new RegExp(src, "i").test(document.body.innerText), re.source, { timeout }); return true; }
  catch { return false; }
}
const appRendered = (page) => page.locator('[data-testid="auth-bar"]').count().then((n) => n > 0);

let server, browser;
try {
  server = startServer();
  await waitFor("server", async () => (await fetch(`${BASE}/health`)).ok);
  browser = await chromium.launch({ executablePath });

  // ── 1 · Unauthenticated ──────────────────────────────────────────────────────────────────────────
  {
    const { context, page, seen } = await newScenario(browser);
    await page.goto(BASE);
    await page.getByRole("button", { name: "Sign in" }).waitFor({ timeout: 20_000 });
    check("unauthenticated visitor sees only the sign-in screen", await page.locator('[data-testid="auth-gate"]').count() === 1 && !(await appRendered(page)));
    check("…and the page made no governed API request (only the public auth config)",
      seen.api.every((p) => p === "/api/auth/config"), JSON.stringify(seen.api));
    check("…and holds no token", (await stored(page)) === null);
    // The server itself also refuses: no token, and forged dev headers are not an identity under OIDC.
    const bare = await page.evaluate(async () => (await fetch("/api/auth/whoami")).status);
    const forged = await page.evaluate(async () => (await fetch("/api/auth/whoami", {
      headers: { "x-actor-id": "attacker@evil", "x-actor-role": "steward" },
    })).status);
    check("server: unauthenticated whoami is 401", bare === 401, String(bare));
    check("server: forged x-actor-* headers are 401 under OIDC", forged === 401, String(forged));
    await context.close();
  }

  // ── 2 · Happy path, PKCE, CSP, reload, wrong role, escalation, sign-out ─────────────────────────
  {
    const { context, page, seen } = await newScenario(browser);
    await page.goto(BASE);
    await page.getByRole("button", { name: "Sign in" }).click();
    const signedIn = await page.locator('[data-testid="auth-bar"]').waitFor({ timeout: 20_000 }).then(() => true, () => false);
    check("sign-in completes: the app renders only after the server accepted the token", signedIn);
    const barText = signedIn ? await page.locator('[data-testid="auth-bar"]').innerText() : "";
    check("the identity shown is the SERVER's reading (actor and role from the verified token)",
      /journey-operator/.test(barText) && /operator/.test(barText), barText);
    const u = seen.authorizeUrl;
    check("authorization request used S256 PKCE, state and nonce, no secret",
      u?.searchParams.get("code_challenge_method") === "S256" && !!u.searchParams.get("state") && !!u.searchParams.get("nonce")
        && !u.searchParams.has("client_secret"));
    check("the token request carried the verifier whose S256 is the issued challenge (provider-side PKCE check passed)", seen.pkce === true);
    check("exactly one token request, and none carried a client secret",
      seen.tokenRequests.length === 1 && !("client_secret" in seen.tokenRequests[0]), JSON.stringify(seen.tokenRequests.map((t) => Object.keys(t))));
    check("code and state were removed from the address bar", new URL(page.url()).search === "", page.url());
    check("no Content-Security-Policy violation occurred (the token endpoint origin is allowed, nothing else)", seen.csp.length === 0, seen.csp.join(" | "));

    // Reload: the session survives within the tab, and is still re-verified by the server.
    await page.reload();
    check("after reload the session is re-verified and the app renders again",
      await page.locator('[data-testid="auth-bar"]').waitFor({ timeout: 20_000 }).then(() => true, () => false));

    // Server-side authorization is the only authority: an operator token cannot read oversight surfaces.
    const token = await stored(page);
    const rc = await page.evaluate(async (t) => (await fetch("/api/recovery-cases/RC-1", { headers: { authorization: `Bearer ${t}` } })).status, token);
    check("wrong role: an operator token is refused 403 on an oversight (AuditRead) surface", rc === 403, String(rc));
    const esc = await page.evaluate(async (t) => {
      const r = await fetch("/api/auth/whoami", { headers: { authorization: `Bearer ${t}`, "x-actor-id": "root@company", "x-actor-role": "steward" } });
      return r.json();
    }, token);
    check("privilege escalation by header: a valid operator token plus x-actor-role: steward is still an operator",
      esc.role === "operator" && esc.actorId === "journey-operator", JSON.stringify(esc));
    const noBearer = await page.evaluate(async () => (await fetch("/api/recovery-cases/RC-1", { headers: { "x-actor-role": "approver", "x-actor-id": "x@y" } })).status);
    check("forged approver headers without a token are 401, not 403 and not data", noBearer === 401, String(noBearer));

    // Replay: the callback URL is single-use.
    const tokenRequestsBefore = seen.tokenRequests.length;
    await page.goto(`${BASE}/?code=replayed-code&state=${u.searchParams.get("state")}`);
    const replayRefused = await waitForText(page, /state mismatch/);
    check("replayed callback (state already consumed) is refused before any token request",
      replayRefused && seen.tokenRequests.length === tokenRequestsBefore, `tokenRequests ${tokenRequestsBefore}→${seen.tokenRequests.length}`);

    // Sign-out from a fresh load of the app.
    await page.goto(BASE);
    await page.locator('[data-testid="auth-bar"]').waitFor({ timeout: 20_000 }).catch(() => undefined);
    await page.getByRole("button", { name: "Sign out" }).click();
    check("sign-out clears the token and closes the app",
      await page.getByRole("button", { name: "Sign in" }).waitFor({ timeout: 15_000 }).then(() => true, () => false)
        && (await stored(page)) === null && !(await appRendered(page)));
    await context.close();
  }

  // ── 3 · Callback and token failures: every one ends closed with nothing stored ─────────────────
  const closed = async (name, opts, expectText, { tokenRequests } = {}) => {
    const { context, page, seen } = await newScenario(browser, opts);
    await page.goto(BASE);
    await page.getByRole("button", { name: "Sign in" }).click();
    const shown = await waitForText(page, expectText);
    const text = await bodyText(page);
    check(`${name}: shows ${expectText}`, shown, text.slice(0, 200).replace(/\s+/g, " "));
    check(`${name}: the app never renders and no token is stored`, !(await appRendered(page)) && (await stored(page)) === null);
    if (tokenRequests !== undefined) check(`${name}: token endpoint requests = ${tokenRequests}`, seen.tokenRequests.length === tokenRequests, String(seen.tokenRequests.length));
    return { page, seen, text, context };
  };

  {
    const r = await closed("state mismatch (forged state in the callback)", { authorize: "wrong-state" }, /state mismatch/, { tokenRequests: 0 });
    await r.context.close();
  }
  {
    const r = await closed("provider error", { authorize: "error" }, /access_denied/, { tokenRequests: 0 });
    check("provider error: the provider's free text is never rendered or executed", !/onerror/.test(r.text) && (await r.page.locator("img").count()) === 0);
    await r.context.close();
  }
  {
    const r = await closed("token endpoint refuses the code", { token: "refuse" }, /refused/, { tokenRequests: 1 });
    await r.context.close();
  }
  {
    const r = await closed("expired token", { tokenValue: makeToken({ exp: Math.floor(Date.now() / 1000) - 60 }) }, /expired/);
    await r.context.close();
  }
  {
    // Signed by a key the server has never heard of: the browser cannot tell (it does not verify), the SERVER must.
    const r = await closed("token signed by a stranger's key", { tokenValue: makeToken({ key: stranger.privateKey }) }, /not accepted/);
    check("stranger-key token: the server was asked and said no (whoami was called)", r.seen.api.includes("/api/auth/whoami"));
    await r.context.close();
  }
  {
    const r = await closed("token with an unknown role claim", { tokenValue: makeToken({ role: "admin" }) }, /not accepted/);
    await r.context.close();
  }
  {
    const r = await closed("token with a wildcard boundary", { tokenValue: makeToken({ boundaries: ["*"] }) }, /not accepted/);
    await r.context.close();
  }
} catch (e) {
  failures += 1;
  console.error(e);
  annotate(`HARNESS ERROR · ${e instanceof Error ? e.message : String(e)}`);
} finally {
  await browser?.close().catch(() => undefined);
  stop(server);
}

console.log(failures === 0 ? "AUTH JOURNEY · all checks passed" : `AUTH JOURNEY · ${failures} check(s) FAILED`);
process.exit(failures === 0 ? 0 : 1);
