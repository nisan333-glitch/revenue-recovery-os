# Server TypeScript in CI — decision record V1

**Date:** 2026-11-09 · **Measured on:** `bb17ecd20493abb1924c91be78fe9ea3f9a37a9f`
**Scope:** `tsconfig.server.test.json`, `scripts/typecheck/*`, two CI steps, three npm scripts
**Local development and testing only. Nothing pushed, merged, deployed or migrated.**

---

## 1. Root cause — and a correction to my own audit first

My previous report to Issue #18 stated that **"CI typechecks no part of `server/` at all — not the tests,
and not the production server code."** **That is false, and the correction is the most important line in
this record.**

`Dockerfile:29` is:

```dockerfile
RUN npm run build && npm run build:server
```

`build:server` is `tsc -p tsconfig.server.json && node scripts/mark-server-commonjs.mjs`. The EP-10
Docker pilot smoke job builds that image on every run, so the server's production typecheck **does**
execute in CI. It is not an inference — CI run #333's EP-10 log shows it:

```
#20 [migrate build 10/10] RUN npm run build && npm run build:server
#20 9.774 > revenue-recovery-os@0.1.0 build:server
#20 9.774 > tsc -p tsconfig.server.json && node scripts/mark-server-commonjs.mjs
#20 13.81 wrote /app/dist-server/package.json
```

My audit searched the workflow for `build:server` and for `tsc`, found neither, and concluded the
coverage was absent. It never occurred to me to look inside the Dockerfile the workflow builds. **A
command absent from a workflow is not a command absent from CI**, and an audit that reads only the
layer it thought to read reports a gap that is not there. This is the same error class the repository
keeps recording — a structural check that read the wrong construct — applied by me to a workflow.

**So the real root cause is narrower and different in kind:**

| | Before this change | Actually true |
|---|---|---|
| `server/**/*.ts` production | typechecked in CI, but **only as a side effect of a Docker image build**, in a job whose stated purpose is a runtime smoke test | real coverage, **fragile and unnamed** |
| `server/**/*.test.ts` | typechecked by **nothing** — excluded by `tsconfig.server.json`, included by no other project | **a genuine gap** |
| `server/test/**` helpers | typechecked by **nothing**, same reason | **a genuine gap** |

The production exposure was never "untyped code ships." It was: *the only server typecheck in CI is one
line inside a Dockerfile; nobody scanning the workflow would find it, it costs a full image build, and
the day that line is edited the server's type safety leaves CI in silence.* That is a real risk and it
is worth closing — but it is **not** the risk I reported.

The test-file gap is the one that had already bitten: `actor("auditor", "auditor", …)` compiled against
a `BackendRole` that has no `auditor` role, because **no project included the file**.

## 2. What was built

> **A gate is explicit, named, fail-closed, and cheap enough that nobody is tempted to remove it.**
> Coverage that exists only as a by-product of another job is coverage that can disappear without a
> single line of the workflow changing.

| Artefact | Purpose |
|---|---|
| `npm run typecheck:server` | **Hard gate.** `tsc --noEmit -p tsconfig.server.json`. Production server code, **zero errors required**. |
| `tsconfig.server.test.json` | A **separate program** for the server's test files. |
| `npm run typecheck:server:tests` | Runs that program directly, for a developer. |
| `npm run typecheck:server:ratchet` | **Ratchet gate.** Refuses any change to the measured debt. |
| `scripts/typecheck/serverTestBaseline.ts` | The **pure** decision — no I/O, no clock, no process. |
| `scripts/typecheck/serverTestRatchet.ts` | The gathering. Importing it runs nothing. |
| `scripts/typecheck/check-server-tests.ts` | The command: argv, stdout, exit code, nothing else. |
| `scripts/typecheck/server-test-baseline.json` | The pinned debt: **33 errors / 19 files**. |

Both gates run in the **Invariants + strict build** job — the fastest job, needing no database and no
browser — and the Dockerfile's `build:server` is **left in place**, because it must keep proving the
server also *emits*.

### 2a. Why the test config is a separate program, not a widening

`tsconfig.server.json` sets `module: CommonJS` because its job is to **emit** `dist-server` for a plain
`node`. The tests are never emitted: vitest runs them through esbuild as ES modules, where `import.meta`
is legal. Compiling them under the emit config produced **15 × TS1343** — *"`import.meta` is only allowed
when `module` is es2020/esnext/…"* — which is a fact about the **wrong config being applied**, not about
the code. Widening the emit config's `module` to satisfy the tests would change what the production
server compiles to, which is the one thing that must not move.

**Every other strictness flag is inherited unchanged** — `strict`, `noUnusedLocals`,
`noUnusedParameters`, `noFallthroughCasesInSwitch`. A test asserts the config contains no
`"strict": false`, no `"noUnusedLocals": false` and no `"noUnusedParameters": false`, so the debt can
never be paid by weakening the compiler.

**And the count is reported both ways so nothing looks fixed by the split:**

| Program | Errors | Files |
|---|---|---|
| Production only (`tsconfig.server.json`) | **0** | 0 |
| Tests under the **emit** config (wrong module) | 48 | 27 |
| Tests under the **test** config (correct module) | **33** | **19** |

The 15 that disappear are exactly the 15 TS1343. They were never defects.

### 2b. Why a ratchet and not a zero-error gate

33 errors is red on arrival. A hard gate would be switched off, or satisfied with `@ts-ignore` — which is
hiding errors, not fixing them, and the order forbids both. The ratchet refuses the only thing that
matters in the meantime: **the number getting worse**.

It refuses an **improvement** too, which is deliberate. An un-lowered pin stops describing the repository
and the guard quietly loses the ability to detect the next regression. Lowering the number is part of the
change that fixes an error — the same reason this repository pins dedupe keys to bare literals.

> **The pinned number records a known debt. It is not a budget to spend, and it is never raised to make a
> new error pass.** That sentence is in the JSON and a test asserts it is still there.

## 3. The 33 errors, and the plan to reach zero

**Nothing is suppressed and no setting is weakened.** Measured identically at `07590b4` and `bb17ecd` —
**error for error, after normalising line and column, `diff` reports no difference at all.**

| Code | Count | What it is | Remediation |
|---|---|---|---|
| **TS2322** | 19 | A test double assigned to a real interface it does not fully satisfy — mostly fake `$queryRaw`-shaped functions and partial record literals | Give each double a declared type and fill the missing members, or narrow the seam it is injected into. Mechanical but must be done per call site; **the risk is that a too-loose double is hiding a real signature drift**, so each one is a small review, not a sweep. |
| **TS6133** | 8 | Declared and never read (`noUnusedLocals`) | Delete, or use. **Check first whether an unused import is a test that stopped asserting something** — that is the interesting case and the reason this is not an auto-fix. |
| **TS2352** | 3 | A cast between insufficiently overlapping types when shaping raw-SQL rows in tests | Introduce a row interface and parse into it, the same shape-check-rather-than-cast rule the production code already follows. |
| **TS7053** | 1 | Implicit `any` from indexing a union by a literal | Narrow the union before indexing. |
| **TS2345** | 1 | An argument that does not match the parameter type | One call site. |
| **TS2339** | 1 | `.sort()` on `readonly string[]` in `absorbedObservations.test.ts` | `[...xs].sort()`. Pre-existing from `69c16d8`; it only moved line because later commits inserted above it. |

**Concentration:** 3 files hold 12 of the 33 (`reassessment` 4, `pilotJourneyMatrix` 4,
`governedSignalEmitter` 4). 11 files hold exactly 1 each.

**Suggested order, cheapest and safest first:** the 10 single-error files and the 8 TS6133 (one sitting,
low risk, takes the count to ~15) → the 3 TS2352 row casts (small, and they improve the tests) → the 19
TS2322 doubles, file by file, each with a real look at whether the loose double was masking a drift.

**This record does not promise a date.** It states what the work is; the ratchet guarantees only that the
number does not grow while it is outstanding.

## 4. Proof the gates detect errors

Not asserted — performed, and reverted, with the file proved byte-identical to `HEAD` afterwards.

| Injection | `typecheck:server` | ratchet | Verdict |
|---|---|---|---|
| `const x: number = "string"` in **production** `caseProvenGate.ts` | **exit 2**, `TS2322` named with file and line | — | caught |
| …removed | exit 0 | — | recovered, file identical to HEAD |
| `const x: number = "string"` in a **test** file | **exit 0** *(correct — it is not production)* | **exit 1**, `34 errors against a pinned 33` | caught, **and the separation proved in both directions** |
| …removed | exit 0 | exit 0, `33 … exactly as pinned` | recovered, file identical to HEAD |

**Three mutations against the wiring guards, all caught:** removing the ratchet step from `ci.yml`
(1 failure), swallowing the production gate with `|| true` (2 failures), and setting `"strict": false` in
the test config to lower the count (1 failure). All reverted; 17/17 green after.

## 5. Two defects in my own work, recorded because both are recurring classes

**The ratchet's first version could not fire.** It ended with `main()` behind
`process.argv[1].endsWith("check-server-tests.ts")`. Under `vite-node` — how every script in this
repository runs — `process.argv[1]` is the **vite-node binary** and the script path is consumed entirely,
so the guard was always false. The gate **exited 0 having done nothing**, which is indistinguishable from
passing. `scripts/coordination/endpoint.ts` had already recorded this exact failure in prose and I walked
into it anyway. The command is now unconditional, matching the `ciStatus.ts` / `ci-status.ts` split this
repository had already settled.

> **A guard that cannot fire is not a weaker guard, it is no guard** — and an exit code of 0 from a
> command that printed nothing is the signature.

**And my own structural test read prose instead of code.** It asserted `check-server-tests.ts` does not
contain `process.argv[1]` — and failed, on the command's own **comment explaining why the argv guard is
absent**. The **thirteenth** recorded instance in this repository of a guard matching a term rather than a
claim, produced inside a test about that very class of bug. It now strips comments first, **and asserts
the stripper actually stripped**, because an assertion against a string that was already emptied proves
nothing.

A **fourteenth** followed minutes later while verifying the workflow: a check for `|| true` reported a
violation in `ci.yml`, which turned out to be a pre-existing **comment stating there is no `|| true`**.
Both the test and the verification now read `run:` lines only.

## 6. What this does NOT touch

`prisma/schema.prisma` untouched. No migration. No production change. No customer data.

**No governance, financial or refusal mechanism is altered**, and the acceptance run proves it rather
than claiming it: PROVEN eligibility and bypass, obligation identity, candidate dedupe, absorption grain,
correction mapping, the correction ledger and the two-ledger separation all re-run green at the same
counts. `src/domain/invariants.ts` and `src/domain/outcomes.ts` are not in the diff at all.

**No observed amount became Revenue Returned.**
