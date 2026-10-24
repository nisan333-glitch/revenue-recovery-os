// Falsifiers for the NH coordination status record. Every rule that stops a record over-claiming is paired
// with a case that tries to over-claim and must be refused; a test that cannot fail is not a control.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  SCHEMA,
  extractStatusRecords,
  validateSequence,
  validateStatusRecord,
  type StatusRecord,
} from "./statusRecord.ts";

const NOW = new Date("2026-10-24T20:00:00Z");
const SHA_A = "9c18c82b4266c89f7f1151c1ee909b7acb75d5a8";
const SHA_B = "b15b3f7000000000000000000000000000000000";
const REPO = "https://github.com/example-org/example-repo";

function base(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schema: SCHEMA,
    id: "issue-12-phase-1",
    subject: { kind: "issue", number: 12 },
    author: { name: "claude-code", agent: "claude-code" },
    owner: "claude-code",
    branch: "claude/pilot-reconciler-demo-v1",
    commit: SHA_A,
    state: "in_progress",
    summary: "Building the status record contract.",
    evidence: [],
    blockers: [],
    approval_gates: [],
    timestamps: { created_at: "2026-10-24T19:30:00Z", updated_at: "2026-10-24T19:45:00Z" },
    ...over,
  };
}

const ciRun = (sha: string, conclusion: string) => ({
  kind: "ci_run",
  url: `${REPO}/actions/runs/123456`,
  head_sha: sha,
  conclusion,
});

function errorsOf(rec: unknown): string[] {
  return validateStatusRecord(rec, NOW).errors;
}

describe("a well-formed record", () => {
  it("passes in every state when its obligations are met", () => {
    expect(validateStatusRecord(base(), NOW)).toEqual({ ok: true, errors: [] });
    expect(validateStatusRecord(base({ state: "requested", commit: undefined }), NOW).ok).toBe(true);
    expect(validateStatusRecord(base({ state: "acknowledged", commit: undefined }), NOW).ok).toBe(true);
    expect(validateStatusRecord(base({ state: "tested", evidence: [ciRun(SHA_A, "success")] }), NOW).ok).toBe(true);
    expect(validateStatusRecord(base({ state: "completed", evidence: [ciRun(SHA_A, "success")] }), NOW).ok).toBe(true);
    expect(
      validateStatusRecord(base({ state: "blocked", blockers: [{ id: "d1", text: "Owner picks the OIDC provider." }] }), NOW).ok,
    ).toBe(true);
  });
});

describe("shape is closed", () => {
  it("rejects non-objects and wrong schema ids", () => {
    expect(errorsOf(null)).toEqual(["record: must be a JSON object"]);
    expect(errorsOf([])).toEqual(["record: must be a JSON object"]);
    expect(errorsOf(base({ schema: "nh-status/v2" })).join("\n")).toMatch(/schema:/);
  });

  it("rejects an unknown top-level field, so nothing unreviewed rides along", () => {
    expect(errorsOf(base({ transcript: "x" })).join("\n")).toMatch(/transcript: unknown field/);
  });

  it("rejects unknown fields nested in evidence, blockers, gates and timestamps", () => {
    expect(errorsOf(base({ evidence: [{ kind: "file", url: `${REPO}/blob/x`, extra: 1 }] })).join("\n")).toMatch(/evidence\[0\]\.extra/);
    expect(errorsOf(base({ blockers: [{ id: "b", text: "t", extra: 1 }] })).join("\n")).toMatch(/blockers\[0\]\.extra/);
    expect(errorsOf(base({ approval_gates: [{ id: "g", text: "t", status: "open", extra: 1 }] })).join("\n")).toMatch(/approval_gates\[0\]\.extra/);
    expect(errorsOf(base({ timestamps: { created_at: "2026-10-24T19:30:00Z", updated_at: "2026-10-24T19:45:00Z", x: 1 } })).join("\n")).toMatch(/timestamps\.x/);
  });

  it("requires exact 40-character SHAs and refuses abbreviations", () => {
    expect(errorsOf(base({ commit: "9c18c82" })).join("\n")).toMatch(/commit: must be a full 40/);
    expect(errorsOf(base({ commit: SHA_A.toUpperCase() })).join("\n")).toMatch(/commit: must be a full 40/);
  });

  it("requires a commit once work exists, but not before", () => {
    expect(errorsOf(base({ state: "in_progress", commit: undefined })).join("\n")).toMatch(/commit: required/);
    expect(errorsOf(base({ state: "requested", commit: undefined }))).toEqual([]);
  });

  it("limits id, branch, and string sizes", () => {
    expect(errorsOf(base({ id: "Bad ID" })).join("\n")).toMatch(/id:/);
    expect(errorsOf(base({ branch: "has space" })).join("\n")).toMatch(/branch:/);
    expect(errorsOf(base({ summary: "x".repeat(501) })).join("\n")).toMatch(/not a transcript/);
  });

  it("caps array sizes", () => {
    const many = Array.from({ length: 21 }, (_, i) => ({ id: `b${i}`, text: "t" }));
    expect(errorsOf(base({ blockers: many })).join("\n")).toMatch(/blockers: more than 20/);
  });
});

describe("over-claiming is refused", () => {
  it("tested without a CI run is a claim with nothing behind it", () => {
    expect(errorsOf(base({ state: "tested" })).join("\n")).toMatch(/requires a ci_run/);
  });

  it("tested citing CI for a DIFFERENT commit is refused", () => {
    const e = errorsOf(base({ state: "tested", evidence: [ciRun(SHA_B, "success")] })).join("\n");
    expect(e).toMatch(/no ci_run ran against this record's commit/);
  });

  it("tested citing a failed or running CI run is refused", () => {
    expect(errorsOf(base({ state: "tested", evidence: [ciRun(SHA_A, "failure")] })).join("\n")).toMatch(/concluded "success"/);
    expect(errorsOf(base({ state: "tested", evidence: [ciRun(SHA_A, "in_progress")] })).join("\n")).toMatch(/concluded "success"/);
  });

  it("one green run for the commit is enough even beside a red one for it", () => {
    const rec = base({ state: "tested", evidence: [ciRun(SHA_A, "failure"), ciRun(SHA_A, "success")] });
    expect(validateStatusRecord(rec, NOW).ok).toBe(true);
  });

  it("completed with an open approval gate is refused", () => {
    const rec = base({
      state: "completed",
      evidence: [ciRun(SHA_A, "success")],
      approval_gates: [{ id: "g1", text: "Owner approves merge.", status: "open" }],
    });
    expect(errorsOf(rec).join("\n")).toMatch(/1 open gate/);
  });

  it("a declined gate is not an open gate, but is not a grant either", () => {
    const rec = base({
      state: "completed",
      evidence: [ciRun(SHA_A, "success")],
      approval_gates: [{ id: "g1", text: "Owner approves merge.", status: "declined" }],
    });
    expect(validateStatusRecord(rec, NOW).ok).toBe(true);
  });

  it("completed with unresolved blockers is refused", () => {
    const rec = base({ state: "completed", evidence: [ciRun(SHA_A, "success")], blockers: [{ id: "b", text: "t" }] });
    expect(errorsOf(rec).join("\n")).toMatch(/unresolved blockers/);
  });

  it("blocked with no blocker is refused", () => {
    expect(errorsOf(base({ state: "blocked" })).join("\n")).toMatch(/requires at least one blocker/);
  });

  it("a granted gate must point at where the grant was written", () => {
    const noLink = base({ approval_gates: [{ id: "g", text: "t", status: "granted", granted_by: "owner" }] });
    expect(errorsOf(noLink).join("\n")).toMatch(/evidence_url/);
    const noWho = base({ approval_gates: [{ id: "g", text: "t", status: "granted", evidence_url: `${REPO}/issues/12#issuecomment-1` }] });
    expect(errorsOf(noWho).join("\n")).toMatch(/granted_by/);
    const ok = base({
      approval_gates: [{ id: "g", text: "t", status: "granted", granted_by: "owner", evidence_url: `${REPO}/issues/12#issuecomment-1` }],
    });
    expect(validateStatusRecord(ok, NOW).ok).toBe(true);
  });

  it("grant fields on a non-granted gate are refused", () => {
    const rec = base({ approval_gates: [{ id: "g", text: "t", status: "open", granted_by: "owner" }] });
    expect(errorsOf(rec).join("\n")).toMatch(/only valid on a granted gate/);
  });
});

describe("evidence links", () => {
  it("accepts only GitHub links; private-conversation links are refused", () => {
    for (const url of ["https://claude.ai/code/session_abc", "https://chatgpt.com/c/123", "http://github.com/a/b/x", "https://evil.example/github.com/a/b/x"]) {
      expect(errorsOf(base({ evidence: [{ kind: "file", url }] })).join("\n")).toMatch(/evidence\[0\]\.url/);
    }
  });

  it("a ci_run must link to an actions run and name its SHA and conclusion", () => {
    expect(errorsOf(base({ evidence: [{ kind: "ci_run", url: `${REPO}/pull/1`, head_sha: SHA_A, conclusion: "success" }] })).join("\n")).toMatch(/actions\/runs/);
    expect(errorsOf(base({ evidence: [{ kind: "ci_run", url: `${REPO}/actions/runs/1` }] })).join("\n")).toMatch(/head_sha/);
    expect(errorsOf(base({ evidence: [{ kind: "ci_run", url: `${REPO}/actions/runs/1`, head_sha: SHA_A, conclusion: "green" }] })).join("\n")).toMatch(/conclusion/);
  });

  it("head_sha/conclusion on non-CI evidence is refused", () => {
    expect(errorsOf(base({ evidence: [{ kind: "file", url: `${REPO}/blob/x`, conclusion: "success" }] })).join("\n")).toMatch(/belong to ci_run/);
  });

  it("a commit link must carry a full SHA", () => {
    expect(errorsOf(base({ evidence: [{ kind: "commit", url: `${REPO}/commit/9c18c82` }] })).join("\n")).toMatch(/40-char sha/);
    expect(validateStatusRecord(base({ evidence: [{ kind: "commit", url: `${REPO}/commit/${SHA_A}` }] }), NOW).ok).toBe(true);
  });
});

describe("timestamps", () => {
  it("requires ISO-8601 UTC", () => {
    expect(errorsOf(base({ timestamps: { created_at: "2026-10-24 19:30", updated_at: "2026-10-24T19:45:00Z" } })).join("\n")).toMatch(/created_at/);
    expect(errorsOf(base({ timestamps: { created_at: "2026-10-24T19:30:00+02:00", updated_at: "2026-10-24T19:45:00Z" } })).join("\n")).toMatch(/created_at/);
  });

  it("refuses updated_at before created_at and times in the future", () => {
    expect(errorsOf(base({ timestamps: { created_at: "2026-10-24T19:45:00Z", updated_at: "2026-10-24T19:30:00Z" } })).join("\n")).toMatch(/earlier than created_at/);
    expect(errorsOf(base({ timestamps: { created_at: "2026-10-24T19:30:00Z", updated_at: "2026-10-25T19:30:00Z" } })).join("\n")).toMatch(/in the future/);
  });

  it("tolerates small clock skew", () => {
    expect(errorsOf(base({ timestamps: { created_at: "2026-10-24T19:30:00Z", updated_at: "2026-10-24T20:03:00Z" } }))).toEqual([]);
  });
});

describe("credentials and transcripts never ride along", () => {
  const cases: Array<[string, string]> = [
    ["GitHub token", "token ghp_abcdefghijklmnopqrstuvwxyz0123456789"],
    ["GitHub fine-grained token", "github_pat_11ABCDEFG0123456789_abcdefghijklmnop"],
    ["API secret key", "key sk-abcdefghijklmnopqrstuvwxyz"],
    ["AWS access key id", "AKIAABCDEFGHIJKLMNOP"],
    ["private key block", "-----BEGIN RSA PRIVATE KEY-----"],
    ["JWT", "eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghijklmnop"],
    ["bearer token", "Authorization: Bearer abcdefghijklmnopqrstuvwxyz012345"],
    ["credentials embedded in a URL", "postgres://admin:hunter2@db.internal/app"],
  ];
  for (const [label, text] of cases) {
    it(`refuses a ${label} in the summary`, () => {
      expect(errorsOf(base({ summary: text })).join("\n")).toContain(label);
    });
  }

  it("refuses a secret hidden in a nested field", () => {
    const rec = base({ blockers: [{ id: "b", text: "use ghp_abcdefghijklmnopqrstuvwxyz0123456789 to log in" }] });
    expect(errorsOf(rec).join("\n")).toMatch(/blockers\[0\]\.text: looks like a GitHub token/);
  });

  it("refuses a pasted conversation", () => {
    expect(errorsOf(base({ summary: "ok\nUser: please do it\nAssistant: done" })).join("\n")).toMatch(/pasted conversation/);
  });

  it("does NOT flag ordinary prose or SHAs", () => {
    expect(errorsOf(base({ summary: "Commit 9c18c82b4266c89f7f1151c1ee909b7acb75d5a8 is green; the user flow is unchanged." }))).toEqual([]);
  });

  it("never echoes the secret value back in the error", () => {
    const secret = "ghp_abcdefghijklmnopqrstuvwxyz0123456789";
    expect(errorsOf(base({ summary: secret })).join("\n")).not.toContain(secret);
  });
});

describe("extractStatusRecords", () => {
  const body = (json: string) => `Status update\n\n\`\`\`nh-status\n${json}\n\`\`\`\n\nthanks`;

  it("extracts a block from a comment and ignores the prose around it", () => {
    const { records, parseErrors } = extractStatusRecords(body(JSON.stringify(base())));
    expect(parseErrors).toEqual([]);
    expect(records).toHaveLength(1);
  });

  it("handles CRLF line endings", () => {
    const crlf = body(JSON.stringify(base())).replace(/\n/g, "\r\n");
    expect(extractStatusRecords(crlf).records).toHaveLength(1);
  });

  it("extracts several blocks in order", () => {
    const two = `${body('{"a":1}')}\n${body('{"a":2}')}`;
    expect(extractStatusRecords(two).records).toEqual([{ a: 1 }, { a: 2 }]);
  });

  it("reports invalid JSON instead of skipping it", () => {
    const { records, parseErrors } = extractStatusRecords(body("{not json"));
    expect(records).toEqual([]);
    expect(parseErrors[0]).toMatch(/block #1: not valid JSON/);
  });

  it("returns nothing for a comment with no block, and ignores other fences", () => {
    expect(extractStatusRecords("just words")).toEqual({ records: [], parseErrors: [] });
    expect(extractStatusRecords("```json\n{}\n```").records).toEqual([]);
  });
});

describe("validateSequence", () => {
  const rec = (over: Record<string, unknown>) => ({ ...base(), ...over }) as unknown as StatusRecord;
  const at = (updated_at: string) => ({ created_at: "2026-10-24T19:00:00Z", updated_at });

  it("accepts a normal forward history", () => {
    const seq = [
      rec({ state: "acknowledged", commit: undefined, timestamps: at("2026-10-24T19:10:00Z") }),
      rec({ state: "in_progress", timestamps: at("2026-10-24T19:20:00Z") }),
      rec({ state: "tested", evidence: [ciRun(SHA_A, "success")], timestamps: at("2026-10-24T19:30:00Z") }),
    ];
    expect(validateSequence(seq)).toEqual({ ok: true, errors: [] });
  });

  it("refuses time running backwards", () => {
    const seq = [rec({ timestamps: at("2026-10-24T19:20:00Z") }), rec({ timestamps: at("2026-10-24T19:10:00Z") })];
    expect(validateSequence(seq).errors.join("\n")).toMatch(/updated_at went backwards/);
  });

  it("refuses walking a verified state back on the SAME commit", () => {
    const seq = [
      rec({ state: "tested", evidence: [ciRun(SHA_A, "success")], timestamps: at("2026-10-24T19:20:00Z") }),
      rec({ state: "in_progress", timestamps: at("2026-10-24T19:30:00Z") }),
    ];
    expect(validateSequence(seq).errors.join("\n")).toMatch(/fell from "tested" to "in_progress" on the same commit/);
  });

  it("allows the state to restart after a NEW commit", () => {
    const seq = [
      rec({ state: "tested", evidence: [ciRun(SHA_A, "success")], timestamps: at("2026-10-24T19:20:00Z") }),
      rec({ state: "in_progress", commit: SHA_B, timestamps: at("2026-10-24T19:30:00Z") }),
    ];
    expect(validateSequence(seq).ok).toBe(true);
  });

  it("treats blocked as lateral and different ids as independent", () => {
    const seq = [
      rec({ state: "tested", evidence: [ciRun(SHA_A, "success")], timestamps: at("2026-10-24T19:20:00Z") }),
      rec({ state: "blocked", blockers: [{ id: "b", text: "t" }], timestamps: at("2026-10-24T19:25:00Z") }),
      rec({ id: "other-thread", state: "acknowledged", commit: undefined, timestamps: at("2026-10-24T19:10:00Z") }),
    ];
    expect(validateSequence(seq).ok).toBe(true);
  });
});

describe("the protocol document", () => {
  const doc = readFileSync(new URL("../../docs/NH_COORDINATION_PROTOCOL_V1.md", import.meta.url), "utf8");

  it("its example record is valid under the validator participants will actually meet", () => {
    const { records, parseErrors } = extractStatusRecords(doc);
    expect(parseErrors).toEqual([]);
    expect(records).toHaveLength(1);
    expect(validateStatusRecord(records[0], NOW)).toEqual({ ok: true, errors: [] });
  });

  it("names every state the validator knows, so the table cannot drift", () => {
    for (const state of ["requested", "acknowledged", "in_progress", "tested", "completed", "blocked"]) {
      expect(doc).toContain(`\`${state}\``);
    }
  });
});
