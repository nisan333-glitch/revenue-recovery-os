// THE PRODUCTION CONFIGURATION CHAIN, VERIFIED BY BOOTING IT · FIRST REAL MONEY PROOF §2.
//
// WHY THIS EXISTS. `docs/PILOT_BLOCKER_MAP_V1.md` C1 lists eighteen variables a production pilot
// needs. That list was assembled by READING the code, and this repository has already recorded what
// that produces: *a list assembled by reading the code path you expected is a list of the variables
// you expected* — the count went 3 → 5 → 18 by exactly that route. So this script does not read. It
// starts the real process entrypoint (`server/index.ts`, the chain `configuredAgentHandlers` →
// `createAgentProcessFromEnvironment` → `createIdentityResolverFromEnvironment` → `buildApp`) once
// per case and records WHAT HAPPENED.
//
// WHAT A CASE IS. A complete would-be-pilot environment, with exactly one variable removed or
// corrupted. The outcome is classified from observed behaviour, never from an expectation:
//
//   STARTUP_REFUSED   the process exited non-zero before listening — the strongest outcome, because a
//                     misconfigured deployment cannot run at all
//   DEGRADED          it listened, and a probe shows the capability is absent or refused
//   NO_OBSERVED_EFFECT it listened and the probes read the same as the baseline
//
// `NO_OBSERVED_EFFECT` IS A FINDING, NOT A PASS. It means this harness could not observe the
// variable's effect from startup plus two unauthenticated probes — which is a statement about the
// probe, not a claim that the variable is unnecessary. Said in the output rather than implied.
//
// ISOLATION. Synthetic values only, every secret generated per run and discarded, an isolated
// database whose name must carry `test`/`synthetic`/`pilot`, a loopback port, and NOTHING is
// deployed, pushed or written outside that database. No customer data, no real key, no real
// endpoint: the OIDC endpoints are `127.0.0.1` URLs that nothing is expected to answer, because the
// subject is the CONFIGURATION CONTRACT and not an identity provider.
import { spawn } from "node:child_process";
import { generateKeyPairSync, randomBytes } from "node:crypto";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const PORT = Number(process.env.CONFIG_PROBE_PORT ?? 4311);
const DB = process.env.CONFIG_PROBE_DATABASE_URL
  ?? "postgresql://pgtest@127.0.0.1:5434/mandate_config_synthetic";
const BOOT_TIMEOUT_MS = Number(process.env.CONFIG_PROBE_TIMEOUT_MS ?? 40000);

if (!/test|synthetic|pilot/.test(DB)) {
  console.error("REFUSED: the probe database name must carry test/synthetic/pilot");
  process.exit(2);
}

// Synthetic, per run, never persisted. Only the PUBLIC half of the evidence key is ever given to the
// process under test — the same split the browser journey uses, so a page can never mint a source
// attestation.
const evidence = generateKeyPairSync("ed25519");
const EVIDENCE_SOURCE_KEYS = JSON.stringify([{
  keyId: `CONFIG-PROBE-${randomBytes(4).toString("hex")}`,
  sourceSystem: "billing",
  publicKey: evidence.publicKey.export({ type: "spki", format: "pem" }).toString(),
}]);
const settlement = generateKeyPairSync("ed25519");
const SETTLEMENT_SOURCE_KEYS = JSON.stringify([{
  keyId: `CONFIG-PROBE-SETTLE-${randomBytes(4).toString("hex")}`,
  sourceSystem: "bank",
  publicKey: settlement.publicKey.export({ type: "spki", format: "pem" }).toString(),
}]);
const secret = () => randomBytes(32).toString("hex");
const BOUNDARY = `cfgprobe-${randomBytes(4).toString("hex")}`;

// ── THE TWO CANDIDATE PILOT SHAPES ────────────────────────────────────────────────────────────────
//
// They are not variants of one configuration; they are two different trust postures, and the pilot
// has to pick one. PRIVATE is the supervised shape `transportGuard.ts` admits without TLS
// termination; OIDC is the full public shape. A variable required in one and not the other is a fact
// about the posture, so both are measured rather than one being assumed.
const TIER_A = {
  NH_AGENTS_ENABLED: "true",
  NH_AGENT_BOUNDARIES: BOUNDARY,
  NH_AGENT_IDLE_DELAY_MS: "200",
  NH_RECONCILIATION_OBSERVER_ENABLED: "true",
  NH_RECONCILER_PSEUDONYM_KEY: secret(),
  NH_AGENT_ADMISSION_POLICIES: "RevenueUnderBilled:10000",
};
const TIER_C = { NH_EVIDENCE_SOURCE_KEYS: EVIDENCE_SOURCE_KEYS };
const TIER_D = {
  NH_EXTERNAL_SETTLEMENT_ENABLED: "true",
  NH_SETTLEMENT_SOURCE_KEYS: SETTLEMENT_SOURCE_KEYS,
  NH_SETTLEMENT_DIGEST_KEY: secret(),
};
const OIDC = {
  NH_OIDC_ISSUER: "https://127.0.0.1:9/realms/nh-config-probe",
  NH_OIDC_AUDIENCE: "nh-config-probe",
  NH_OIDC_JWKS_URI: "https://127.0.0.1:9/realms/nh-config-probe/protocol/openid-connect/certs",
  NH_OIDC_CLIENT_ID: "nh-config-probe-client",
  NH_OIDC_AUTHORIZATION_ENDPOINT: "https://127.0.0.1:9/realms/nh-config-probe/protocol/openid-connect/auth",
  NH_OIDC_TOKEN_ENDPOINT: "https://127.0.0.1:9/realms/nh-config-probe/protocol/openid-connect/token",
  // `access_token`, NOT `access`. The first form of this harness wrote `access`, which
  // `readPublicAuthConfig` rejects — so the OIDC control itself reported
  // `{configured:false,missing:["NH_OIDC_TOKEN_USE"]}` and every case in that shape was compared
  // against a control that was already misconfigured. A control that is already failing cannot
  // show that anything else changed: *a test that cannot fail is not a control*, met in my own
  // instrument again. The control's own body is now printed so a reader can check it rather than
  // trust it.
  NH_OIDC_TOKEN_USE: "access_token",
  NH_OIDC_SCOPES: "openid profile email",
};
// THE DATABASE URL IS PART OF THE POSTURE, NOT A CONSTANT — found by measurement, not by reading.
// `assertProductionDatabaseConfiguration` refuses a production boot unless the URL itself REQUIRES
// verified TLS, and the only exception is the conjunction `NH_PRIVATE_PILOT=true` AND a private or
// loopback database host (`databaseConfig.ts:55`). So the public shape needs a DIFFERENT VALUE in the
// same variable, which is a required configuration fact no variable COUNT can express: the first run
// of this harness used one URL for both shapes and the whole OIDC shape failed its control.
const DB_VERIFIED_TLS = `${DB}${DB.includes("?") ? "&" : "?"}sslmode=require&sslaccept=strict`;
const BASE = { PORT: String(PORT), HOST: "127.0.0.1" };

const SHAPES = {
  PRIVATE: {
    ...BASE, DATABASE_URL: DB,
    NODE_ENV: "production", NH_AUTH_MODE: "dev-headers", NH_PRIVATE_PILOT: "true",
    ...TIER_A, ...TIER_C, ...TIER_D,
  },
  OIDC: {
    ...BASE, DATABASE_URL: DB_VERIFIED_TLS,
    NODE_ENV: "production", NH_AUTH_MODE: "oidc", NH_TLS_TERMINATION: "proxy",
    ...OIDC, ...TIER_A, ...TIER_C, ...TIER_D,
  },
};

// ── THE CASES ─────────────────────────────────────────────────────────────────────────────────────
//
// `drop` removes the variable; `set` replaces it with a value a real operator could plausibly type.
// The corruption cases matter more than the removals: a missing secret is an obvious outage, and a
// MISTYPED flag is the configuration defect that ships.
const CASES = [
  // Tier A · detection
  ["A", "NH_AGENTS_ENABLED", "drop"],
  ["A", "NH_AGENTS_ENABLED", "set", "yes"],
  ["A", "NH_AGENT_BOUNDARIES", "drop"],
  ["A", "NH_RECONCILIATION_OBSERVER_ENABLED", "drop"],
  ["A", "NH_RECONCILIATION_OBSERVER_ENABLED", "set", "1"],
  ["A", "NH_RECONCILER_PSEUDONYM_KEY", "drop"],
  ["A", "NH_RECONCILER_PSEUDONYM_KEY", "set", "too-short"],
  ["A", "NH_AGENT_ADMISSION_POLICIES", "drop"],
  ["A", "NH_AGENT_ADMISSION_POLICIES", "set", "RevenueUnderBilled"],
  // Tier B · serving and identity
  ["B", "DATABASE_URL", "drop"],
  // THE VALUE, NOT THE VARIABLE. Plain transport to the sandbox, which the private shape permits and
  // the public shape must refuse.
  ["B", "DATABASE_URL", "set", DB],
  // AND THE CONTROL THAT MATTERS MOST HERE: the private-pilot flag must NOT excuse plain transport to
  // a PUBLICLY ROUTABLE database host. A flag that relaxed TLS unconditionally would be a security
  // defect wearing the word "pilot", so the refusal is asserted rather than trusted to a comment.
  ["B", "DATABASE_URL", "set", "postgresql://pgtest@db.example.com:5432/pilot_synthetic"],
  ["B", "NH_AUTH_MODE", "set", "bogus"],
  ["B", "NH_AUTH_MODE", "drop"],
  ["B", "NH_TLS_TERMINATION", "drop"],
  ["B", "NH_TLS_TERMINATION", "set", "direct"],
  ["B", "NH_PRIVATE_PILOT", "drop"],
  ["B", "NH_OIDC_ISSUER", "drop"],
  ["B", "NH_OIDC_AUDIENCE", "drop"],
  ["B", "NH_OIDC_JWKS_URI", "drop"],
  ["B", "NH_OIDC_CLIENT_ID", "drop"],
  ["B", "NH_OIDC_AUTHORIZATION_ENDPOINT", "drop"],
  ["B", "NH_OIDC_TOKEN_ENDPOINT", "drop"],
  ["B", "NH_OIDC_TOKEN_USE", "drop"],
  ["B", "NH_OIDC_SCOPES", "drop"],
  // Tier C · proof
  ["C", "NH_EVIDENCE_SOURCE_KEYS", "drop"],
  ["C", "NH_EVIDENCE_SOURCE_KEYS", "set", "[]"],
  // Tier D · external settlement — ABSENT FROM THE EIGHTEEN, which is why it is measured
  ["D", "NH_EXTERNAL_SETTLEMENT_ENABLED", "drop"],
  ["D", "NH_EXTERNAL_SETTLEMENT_ENABLED", "set", "on"],
  ["D", "NH_SETTLEMENT_SOURCE_KEYS", "drop"],
  ["D", "NH_SETTLEMENT_DIGEST_KEY", "drop"],
  ["D", "NH_SETTLEMENT_DIGEST_KEY", "set", "short"],
];

// ── BOOTING ONE CASE ──────────────────────────────────────────────────────────────────────────────
function boot(env) {
  return new Promise((done) => {
    const child = spawn(process.execPath, [resolve(ROOT, "node_modules/.bin/vite-node"), "server/index.ts"], {
      cwd: ROOT, detached: true, stdio: ["ignore", "pipe", "pipe"],
      // A CLEAN SLATE, NOT `...process.env`. Inheriting the shell would let a variable this harness
      // believes it removed arrive anyway, and the run would report a refusal it never tested.
      env: { PATH: process.env.PATH, HOME: process.env.HOME, ...env },
    });
    let out = "", err = "", settled = false;
    // THE PROCESS IS NOT KILLED HERE WHEN IT LISTENED. The first form of this function killed on
    // every path and then probed the corpse, so `/health` would have read 0 for the control and the
    // whole run would have been thrown away for the wrong reason. The caller owns the kill now: a
    // listening process has to still be listening when the probe arrives.
    const finish = (r) => {
      if (settled) return;
      settled = true;
      if (!r.listened) { try { process.kill(-child.pid, "SIGKILL"); } catch { /* already gone */ } }
      done({ ...r, kill: () => { try { process.kill(-child.pid, "SIGKILL"); } catch { /* already gone */ } } });
    };
    const timer = setTimeout(() => finish({ listened: false, code: null, out, err, timedOut: true }), BOOT_TIMEOUT_MS);
    child.stdout.on("data", (b) => {
      out += b;
      if (out.includes("listening on")) { clearTimeout(timer); finish({ listened: true, code: null, out, err }); }
    });
    child.stderr.on("data", (b) => { err += b; });
    child.on("exit", (code) => { clearTimeout(timer); finish({ listened: false, code, out, err }); });
  });
}

const probe = async (path) => {
  try {
    const r = await fetch(`http://127.0.0.1:${PORT}${path}`);
    return { status: r.status, body: (await r.text()).slice(0, 400) };
  } catch (e) { return { status: 0, body: String(e.message ?? e) }; }
};

// A listening process is probed for the two facts an unauthenticated caller can establish: that it
// serves at all, and what it reports about its own identity configuration.
async function bootAndProbe(env) {
  const r = await boot(env);
  if (!r.listened) return { ...r, health: null, authConfig: null };
  // The boot resolves on the log line, so the listener is already accepting.
  const health = await probe("/health");
  const authConfig = await probe("/auth/config");
  r.kill();
  return { ...r, health, authConfig };
}

const firstError = (r) => {
  const lines = `${r.err}\n${r.out}`.split("\n")
    .map((l) => l.replace(/\u001b\[[0-9;]*m/g, "").trim())
    .filter((l) => l.length > 0);
  // THE MESSAGE, NOT THE SOURCE LINE THAT THREW IT. The first form matched `/throw|must|error/` and
  // happily returned the literal text `throw new Error(` — which is where the throw is written, not
  // what it says. Two of the first run's rows read that way and one of them was the OIDC control,
  // so the one case whose diagnosis the whole shape depended on reported nothing at all.
  const message = lines.find((l) => /^(Error|TypeError|RangeError):/.test(l))
    ?? lines.find((l) => /(must|is required|forbidden|cannot|not acceptable|refus)/i.test(l) && !l.includes("throw new"));
  return (message ?? lines[0] ?? "(no diagnostic line captured)").slice(0, 240);
};

async function main() {
  const results = [];
  let failures = 0;

  for (const shape of ["PRIVATE", "OIDC"]) {
    // POSITIVE CONTROL FIRST, AND THE WHOLE RUN DEPENDS ON IT. Without it every refusal below could
    // be a refusal for a reason this harness never varied — the shape might simply never boot. A
    // run whose control fails reports nothing else as evidence.
    const control = await bootAndProbe(SHAPES[shape]);
    const controlOk = control.listened && control.health?.status === 200;
    results.push({ shape, variable: "(none)", mutation: "CONTROL", outcome: controlOk ? "LISTENING" : "CONTROL_FAILED",
      detail: controlOk
        ? `GET /health ${control.health.status} · /auth/config ${(control.authConfig?.body ?? "").slice(0, 160)}`
        : firstError(control) });
    if (!controlOk) {
      failures += 1;
      console.error(`\n${shape} · CONTROL FAILED — no case in this shape is evidence of anything.`);
      console.error(firstError(control));
      continue;
    }
    const controlAuth = control.authConfig?.body ?? "";

    for (const [tier, variable, mutation, value] of CASES) {
      const env = { ...SHAPES[shape] };
      if (!(variable in env) && mutation === "drop") {
        results.push({ shape, tier, variable, mutation: "drop",
          outcome: "NOT_IN_THIS_SHAPE", detail: "this posture does not set the variable at all" });
        continue;
      }
      if (mutation === "drop") delete env[variable]; else env[variable] = value;

      const r = await bootAndProbe(env);
      let outcome, detail;
      if (r.timedOut) { outcome = "TIMEOUT"; detail = `no listen line within ${BOOT_TIMEOUT_MS}ms`; }
      else if (!r.listened) { outcome = "STARTUP_REFUSED"; detail = firstError(r); }
      else if (r.health?.status !== 200) { outcome = "DEGRADED"; detail = `GET /health ${r.health?.status}`; }
      else if ((r.authConfig?.body ?? "") !== controlAuth) {
        outcome = "DEGRADED";
        // The REPORTED difference, not a paraphrase of it: `/auth/config` names each missing key
        // itself, so quoting it is quoting the server.
        detail = `GET /auth/config differs from the control · ${(r.authConfig?.body ?? "").slice(0, 200)}`;
      } else { outcome = "NO_OBSERVED_EFFECT"; detail = "listened, /health 200, /auth/config identical to the control"; }
      results.push({ shape, tier, variable, mutation: mutation === "drop" ? "drop" : `set=${value}`, outcome, detail });
      process.stdout.write(".");
    }
  }

  console.log("\n");
  const pad = (s, n) => String(s).padEnd(n);
  for (const shape of ["PRIVATE", "OIDC"]) {
    console.log(`\n═══ SHAPE ${shape} ═══`);
    for (const r of results.filter((x) => x.shape === shape)) {
      console.log(`${pad(r.tier ?? "-", 2)} ${pad(r.variable, 36)} ${pad(r.mutation, 14)} ${pad(r.outcome, 19)} ${r.detail}`);
    }
  }

  const byOutcome = {};
  for (const r of results) byOutcome[r.outcome] = (byOutcome[r.outcome] ?? 0) + 1;
  console.log(`\nOUTCOMES · ${Object.entries(byOutcome).map(([k, v]) => `${k}=${v}`).join(" · ")}`);
  const unobserved = results.filter((r) => r.outcome === "NO_OBSERVED_EFFECT");
  if (unobserved.length > 0) {
    console.log(
      `\n${unobserved.length} case(s) produced NO OBSERVED EFFECT. That is a limit of this harness — `
      + "startup plus two unauthenticated probes — and NOT evidence the variable is unnecessary:");
    for (const r of unobserved) console.log(`  ${r.shape} · ${r.variable} · ${r.mutation}`);
  }
  console.log(
    "\nSYNTHETIC AND LOCAL. Every secret was generated for this run and is discarded with the process; "
    + "no deployment, no production configuration, no customer data, and no observed amount became "
    + "Revenue Returned.");
  process.exit(failures > 0 ? 1 : 0);
}

main().catch((e) => { console.error(`CONFIG PROBE ERROR · ${e?.stack ?? e}`); process.exit(2); });
