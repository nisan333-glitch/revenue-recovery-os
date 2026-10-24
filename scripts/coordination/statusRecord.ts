// NH coordination protocol v1 — the status record and its validator.
//
// WHAT THIS IS. A small, machine-readable record that a person or an agent attaches to a GitHub issue or
// pull-request comment, so that "who is doing what, on which commit, with what evidence, blocked on whom"
// is stated in one shape that any other participant can read and check. GitHub is the transport; this file
// only defines the shape and refuses malformed or over-claiming records.
//
// WHAT THIS IS NOT. A record is a CLAIM by its author. Passing this validator proves the record is
// well-formed and internally consistent (for example, that a `tested` record cites a CI run whose head SHA
// equals the record's own commit). It does NOT prove the CI run exists or is green; whoever relies on a
// record opens the cited link. Nothing here reads, stores, or can reach a private conversation.
//
// Deliberately pure: no network, no filesystem, no clock except an injectable `now`. Erasable TypeScript
// only (no enums, no parameter properties) so it also runs under plain `node --experimental-strip-types`.

export const SCHEMA = "nh-status/v1";

/** Ordered lifecycle. `blocked` is lateral: it can occur at any point and carries no rank. */
export const STATES = ["requested", "acknowledged", "in_progress", "tested", "completed", "blocked"] as const;
export type State = (typeof STATES)[number];

const RANK: Record<Exclude<State, "blocked">, number> = {
  requested: 0,
  acknowledged: 1,
  in_progress: 2,
  tested: 3,
  completed: 4,
};

export const AGENTS = ["claude-code", "chatgpt", "owner", "other"] as const;
export type Agent = (typeof AGENTS)[number];

export const EVIDENCE_KINDS = ["ci_run", "commit", "comment", "file"] as const;
export type EvidenceKind = (typeof EVIDENCE_KINDS)[number];

export interface Evidence {
  kind: EvidenceKind;
  url: string;
  /** ci_run only: the commit the run was executed against. */
  head_sha?: string;
  /** ci_run only: the run's conclusion as the author reports it. */
  conclusion?: "success" | "failure" | "cancelled" | "in_progress";
  note?: string;
}

export interface Blocker {
  id: string;
  text: string;
  /** Who can unblock it. */
  owner?: string;
}

export interface ApprovalGate {
  id: string;
  text: string;
  status: "open" | "granted" | "declined";
  /** granted only: who granted it, and the GitHub link where the grant is written. */
  granted_by?: string;
  evidence_url?: string;
}

export interface StatusRecord {
  schema: typeof SCHEMA;
  id: string;
  subject: { kind: "issue" | "pull_request"; number: number };
  author: { name: string; agent: Agent };
  /** The party accountable for the next move on this record. */
  owner: string;
  branch: string;
  commit?: string;
  state: State;
  summary: string;
  evidence: Evidence[];
  blockers: Blocker[];
  approval_gates: ApprovalGate[];
  timestamps: { created_at: string; updated_at: string };
}

export interface ValidationResult {
  ok: boolean;
  errors: string[];
}

// ── limits ──────────────────────────────────────────────────────────────────────────────────────────────
// A record is a status line, not a transcript. Hard caps keep it that way and make a pasted conversation
// fail loudly instead of being committed or posted by accident.
const MAX_STRING = 500;
const MAX_ARRAY = 20;
const CLOCK_SKEW_MS = 5 * 60 * 1000;

const TOP_KEYS = new Set([
  "schema",
  "id",
  "subject",
  "author",
  "owner",
  "branch",
  "commit",
  "state",
  "summary",
  "evidence",
  "blockers",
  "approval_gates",
  "timestamps",
]);

const SHA_RE = /^[0-9a-f]{40}$/;
const ID_RE = /^[a-z0-9][a-z0-9-]{2,63}$/;
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;
const BRANCH_RE = /^[A-Za-z0-9._\-/]{1,200}$/;
const GITHUB_URL_RE = /^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/[^\s]*$/;
const CI_RUN_URL_RE = /^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/actions\/runs\/\d+(\/.*)?$/;
const COMMIT_URL_RE = /^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/commit\/([0-9a-f]{40})$/;

/**
 * Strings that look like credentials. Matching ANY string value anywhere in a record rejects the record.
 * Conservative on purpose: a false positive costs one edit; a false negative publishes a secret.
 */
const SECRET_PATTERNS: Array<[RegExp, string]> = [
  [/gh[pousr]_[A-Za-z0-9]{20,}/, "GitHub token"],
  [/github_pat_[A-Za-z0-9_]{20,}/, "GitHub fine-grained token"],
  [/\bsk-[A-Za-z0-9_-]{20,}/, "API secret key"],
  [/\bAKIA[0-9A-Z]{16}\b/, "AWS access key id"],
  [/\bxox[abprs]-[A-Za-z0-9-]{10,}/, "Slack token"],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, "private key block"],
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/, "JWT"],
  [/\bBearer\s+[A-Za-z0-9._~+/-]{20,}/, "bearer token"],
  [/\b[a-z][a-z0-9+.-]*:\/\/[^\s/:@]+:[^\s/@]+@/i, "credentials embedded in a URL"],
];

/** Free-text markers of a pasted conversation. A status line has no speaker turns. */
const TRANSCRIPT_PATTERN = /(^|\n)\s*(user|human|assistant|claude|chatgpt|system)\s*:\s/i;

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function checkString(errors: string[], path: string, v: unknown, opts: { max?: number } = {}): v is string {
  if (typeof v !== "string" || v.trim().length === 0) {
    errors.push(`${path}: must be a non-empty string`);
    return false;
  }
  if (v.length > (opts.max ?? MAX_STRING)) {
    errors.push(`${path}: longer than ${opts.max ?? MAX_STRING} characters — a status record is not a transcript`);
    return false;
  }
  return true;
}

function scanStrings(errors: string[], path: string, v: unknown): void {
  if (typeof v === "string") {
    for (const [re, label] of SECRET_PATTERNS) {
      if (re.test(v)) errors.push(`${path}: looks like a ${label} — credentials must never appear in a record`);
    }
    if (TRANSCRIPT_PATTERN.test(v)) errors.push(`${path}: looks like a pasted conversation — transcripts must never appear in a record`);
  } else if (Array.isArray(v)) {
    v.forEach((x, i) => scanStrings(errors, `${path}[${i}]`, x));
  } else if (isObject(v)) {
    for (const [k, x] of Object.entries(v)) scanStrings(errors, `${path}.${k}`, x);
  }
}

function checkGithubUrl(errors: string[], path: string, v: unknown): v is string {
  if (!checkString(errors, path, v, { max: 300 })) return false;
  if (!GITHUB_URL_RE.test(v)) {
    errors.push(`${path}: must be an https://github.com/<owner>/<repo>/… link (GitHub is the only transport; private-conversation links are refused)`);
    return false;
  }
  return true;
}

/**
 * Validate one record. `now` is injectable so tests are deterministic; it is only used to refuse
 * timestamps from the future (a backdated or forward-dated claim of when work happened).
 */
export function validateStatusRecord(input: unknown, now: Date = new Date()): ValidationResult {
  const errors: string[] = [];
  if (!isObject(input)) return { ok: false, errors: ["record: must be a JSON object"] };

  for (const k of Object.keys(input)) {
    if (!TOP_KEYS.has(k)) errors.push(`${k}: unknown field — the contract is closed so nothing unreviewed rides along`);
  }
  scanStrings(errors, "record", input);

  if (input.schema !== SCHEMA) errors.push(`schema: must be exactly "${SCHEMA}"`);

  if (checkString(errors, "id", input.id, { max: 64 }) && !ID_RE.test(input.id)) {
    errors.push("id: must be lowercase letters, digits and hyphens, 3–64 characters");
  }

  const subject = input.subject;
  if (!isObject(subject)) {
    errors.push("subject: must be { kind, number }");
  } else {
    if (subject.kind !== "issue" && subject.kind !== "pull_request") errors.push('subject.kind: must be "issue" or "pull_request"');
    if (typeof subject.number !== "number" || !Number.isInteger(subject.number) || subject.number < 1) {
      errors.push("subject.number: must be a positive integer");
    }
  }

  const author = input.author;
  if (!isObject(author)) {
    errors.push("author: must be { name, agent }");
  } else {
    checkString(errors, "author.name", author.name, { max: 100 });
    if (!(AGENTS as readonly unknown[]).includes(author.agent)) errors.push(`author.agent: must be one of ${AGENTS.join(", ")}`);
  }

  checkString(errors, "owner", input.owner, { max: 100 });

  if (checkString(errors, "branch", input.branch, { max: 200 }) && !BRANCH_RE.test(input.branch)) {
    errors.push("branch: contains characters a git branch name should not need");
  }

  const state = input.state;
  const stateOk = (STATES as readonly unknown[]).includes(state);
  if (!stateOk) errors.push(`state: must be one of ${STATES.join(", ")}`);

  const commit = input.commit;
  if (commit !== undefined && (typeof commit !== "string" || !SHA_RE.test(commit))) {
    errors.push("commit: must be a full 40-character lowercase hex SHA (an abbreviated SHA is not exact)");
  }
  // From the moment work exists, the record names the exact commit it speaks about.
  if ((state === "in_progress" || state === "tested" || state === "completed") && commit === undefined) {
    errors.push(`commit: required when state is "${String(state)}" — a status without an exact commit cannot be checked`);
  }

  checkString(errors, "summary", input.summary);

  // ── evidence ──
  const evidence: Evidence[] = [];
  if (!Array.isArray(input.evidence)) {
    errors.push("evidence: must be an array (use [] when there is none)");
  } else if (input.evidence.length > MAX_ARRAY) {
    errors.push(`evidence: more than ${MAX_ARRAY} items`);
  } else {
    input.evidence.forEach((e: unknown, i: number) => {
      const p = `evidence[${i}]`;
      if (!isObject(e)) return void errors.push(`${p}: must be an object`);
      for (const k of Object.keys(e)) {
        if (!["kind", "url", "head_sha", "conclusion", "note"].includes(k)) errors.push(`${p}.${k}: unknown field`);
      }
      if (!(EVIDENCE_KINDS as readonly unknown[]).includes(e.kind)) errors.push(`${p}.kind: must be one of ${EVIDENCE_KINDS.join(", ")}`);
      const urlOk = checkGithubUrl(errors, `${p}.url`, e.url);
      if (e.note !== undefined) checkString(errors, `${p}.note`, e.note);
      if (e.kind === "ci_run") {
        if (urlOk && !CI_RUN_URL_RE.test(e.url as string)) errors.push(`${p}.url: a ci_run must link to …/actions/runs/<id>`);
        if (typeof e.head_sha !== "string" || !SHA_RE.test(e.head_sha)) errors.push(`${p}.head_sha: a ci_run must state the full SHA it ran against`);
        if (!["success", "failure", "cancelled", "in_progress"].includes(e.conclusion as string)) {
          errors.push(`${p}.conclusion: must be success, failure, cancelled or in_progress`);
        }
      } else {
        if (e.head_sha !== undefined || e.conclusion !== undefined) errors.push(`${p}: head_sha/conclusion belong to ci_run evidence only`);
        if (e.kind === "commit" && urlOk) {
          const m = COMMIT_URL_RE.exec(e.url as string);
          if (!m) errors.push(`${p}.url: a commit must link to …/commit/<40-char sha>`);
        }
      }
      if (urlOk && isObject(e)) evidence.push(e as unknown as Evidence);
    });
  }

  // ── blockers ──
  let blockerCount = 0;
  if (!Array.isArray(input.blockers)) {
    errors.push("blockers: must be an array (use [] when there are none)");
  } else if (input.blockers.length > MAX_ARRAY) {
    errors.push(`blockers: more than ${MAX_ARRAY} items`);
  } else {
    blockerCount = input.blockers.length;
    input.blockers.forEach((b: unknown, i: number) => {
      const p = `blockers[${i}]`;
      if (!isObject(b)) return void errors.push(`${p}: must be an object`);
      for (const k of Object.keys(b)) if (!["id", "text", "owner"].includes(k)) errors.push(`${p}.${k}: unknown field`);
      checkString(errors, `${p}.id`, b.id, { max: 64 });
      checkString(errors, `${p}.text`, b.text);
      if (b.owner !== undefined) checkString(errors, `${p}.owner`, b.owner, { max: 100 });
    });
  }

  // ── approval gates ──
  let openGates = 0;
  if (!Array.isArray(input.approval_gates)) {
    errors.push("approval_gates: must be an array (use [] when there are none)");
  } else if (input.approval_gates.length > MAX_ARRAY) {
    errors.push(`approval_gates: more than ${MAX_ARRAY} items`);
  } else {
    input.approval_gates.forEach((g: unknown, i: number) => {
      const p = `approval_gates[${i}]`;
      if (!isObject(g)) return void errors.push(`${p}: must be an object`);
      for (const k of Object.keys(g)) {
        if (!["id", "text", "status", "granted_by", "evidence_url"].includes(k)) errors.push(`${p}.${k}: unknown field`);
      }
      checkString(errors, `${p}.id`, g.id, { max: 64 });
      checkString(errors, `${p}.text`, g.text);
      if (!["open", "granted", "declined"].includes(g.status as string)) {
        errors.push(`${p}.status: must be open, granted or declined`);
      }
      if (g.status === "open") openGates += 1;
      if (g.status === "granted") {
        // An approval that cannot be pointed at is an assumed approval.
        checkString(errors, `${p}.granted_by`, g.granted_by, { max: 100 });
        checkGithubUrl(errors, `${p}.evidence_url`, g.evidence_url);
      } else if (g.granted_by !== undefined || g.evidence_url !== undefined) {
        errors.push(`${p}: granted_by/evidence_url are only valid on a granted gate`);
      }
    });
  }

  // ── timestamps ──
  const ts = input.timestamps;
  if (!isObject(ts)) {
    errors.push("timestamps: must be { created_at, updated_at }");
  } else {
    for (const k of Object.keys(ts)) if (k !== "created_at" && k !== "updated_at") errors.push(`timestamps.${k}: unknown field`);
    const parsed: Record<string, number> = {};
    for (const k of ["created_at", "updated_at"] as const) {
      const v = ts[k];
      if (typeof v !== "string" || !ISO_RE.test(v) || Number.isNaN(Date.parse(v))) {
        errors.push(`timestamps.${k}: must be an ISO-8601 UTC time like 2026-10-24T19:17:08Z`);
      } else {
        parsed[k] = Date.parse(v);
        if (parsed[k]! > now.getTime() + CLOCK_SKEW_MS) errors.push(`timestamps.${k}: is in the future`);
      }
    }
    if (parsed.created_at !== undefined && parsed.updated_at !== undefined && parsed.updated_at < parsed.created_at) {
      errors.push("timestamps.updated_at: earlier than created_at");
    }
  }

  // ── cross-field rules: the part that stops a record over-claiming ──
  if (state === "blocked" && blockerCount === 0) errors.push('blockers: state "blocked" requires at least one blocker');

  if (state === "tested" || state === "completed") {
    const runs = evidence.filter((e) => e.kind === "ci_run");
    if (runs.length === 0) {
      errors.push(`evidence: state "${state}" requires a ci_run — "tested" without a linked run is a claim with nothing behind it`);
    } else {
      const matching = runs.filter((r) => r.head_sha === commit);
      if (matching.length === 0) {
        errors.push("evidence: no ci_run ran against this record's commit — CI evidence for a different SHA says nothing about this one");
      } else if (!matching.some((r) => r.conclusion === "success")) {
        errors.push(`evidence: no ci_run for this commit concluded "success"`);
      }
    }
  }
  if (state === "completed") {
    if (openGates > 0) errors.push(`approval_gates: state "completed" with ${openGates} open gate(s) — completion cannot outrun an approval it still needs`);
    if (blockerCount > 0) errors.push('blockers: state "completed" with unresolved blockers — remove them or use "blocked"');
  }

  return { ok: errors.length === 0, errors };
}

/**
 * Check a sequence of records, oldest first as posted, for one `id`'s history.
 *   - `updated_at` never goes backwards.
 *   - A verified state is not quietly downgraded: if the rank drops (e.g. tested → in_progress) the
 *     commit must have changed. Moving backwards on the SAME commit is how a result gets walked back
 *     without anyone saying so. `blocked` carries no rank and is exempt.
 * Records with different ids are independent.
 */
export function validateSequence(records: StatusRecord[]): ValidationResult {
  const errors: string[] = [];
  const last = new Map<string, StatusRecord>();
  for (const r of records) {
    const prev = last.get(r.id);
    if (prev) {
      if (Date.parse(r.timestamps.updated_at) < Date.parse(prev.timestamps.updated_at)) {
        errors.push(`${r.id}: updated_at went backwards (${prev.timestamps.updated_at} → ${r.timestamps.updated_at})`);
      }
      if (r.state !== "blocked" && prev.state !== "blocked" && RANK[r.state] < RANK[prev.state] && r.commit === prev.commit) {
        errors.push(`${r.id}: state fell from "${prev.state}" to "${r.state}" on the same commit — a downgrade needs a new commit or a new id`);
      }
    }
    last.set(r.id, r);
  }
  return { ok: errors.length === 0, errors };
}

export interface Extraction {
  records: unknown[];
  parseErrors: string[];
}

/**
 * Pull every ```nh-status fenced block out of a GitHub comment body. Prose around the block is ignored,
 * so a human-readable summary and the machine record can live in the same comment.
 */
export function extractStatusRecords(body: string): Extraction {
  const records: unknown[] = [];
  const parseErrors: string[] = [];
  const re = /```nh-status[ \t]*\r?\n([\s\S]*?)\r?\n```/g;
  let m: RegExpExecArray | null;
  let n = 0;
  while ((m = re.exec(body)) !== null) {
    n += 1;
    try {
      records.push(JSON.parse(m[1] ?? ""));
    } catch (err) {
      parseErrors.push(`nh-status block #${n}: not valid JSON (${err instanceof Error ? err.message : "parse error"})`);
    }
  }
  return { records, parseErrors };
}
