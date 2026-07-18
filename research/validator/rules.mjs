// NH Validator Stage A — deterministic rule catalog.
// Every rule cites its NH-ROP basis. Enforceability per Table C (README).
// Advisory rules emit WARNING (REVIEW_REQUIRED); enforceable rules emit ERROR (blocking).
// No rule invents a field or a threshold not present in NH-ROP v1.0.

import { compileSchema, validate } from "./schema-validate.mjs";
import { EVENT_TYPE, err, warn } from "./events.mjs";
import { TYPE_SCHEMAS } from "./load.mjs";

const STRONG = new Set(["Strong", "Very strong"]);
const WEAKISH = new Set(["Inadmissible", "Weak"]);
const POSITIVE_VERDICTS = new Set(["Confirmed", "Supported", "Partially Supported"]);

function index(norm) {
  const claimIds = new Set(norm.claims.map((c) => c.claim_id));
  const evidenceById = new Map(norm.evidence.map((e) => [e.evidence_id, e]));
  const sourceIds = new Set(norm.sources.map((s) => s.source_id));
  const contradictionsByClaim = new Map();
  for (const x of norm.contradictions) {
    for (const ref of x.in_conflict ?? []) {
      if (!contradictionsByClaim.has(ref)) contradictionsByClaim.set(ref, []);
      contradictionsByClaim.get(ref).push(x);
    }
  }
  const assumptionsByClaim = new Map();
  for (const a of norm.assumptions) {
    for (const ref of a.claims_affected ?? []) {
      if (!assumptionsByClaim.has(ref)) assumptionsByClaim.set(ref, []);
      assumptionsByClaim.get(ref).push(a);
    }
  }
  const usedSourceIds = new Set(norm.evidence.map((e) => e.source_id));
  return { claimIds, evidenceById, sourceIds, contradictionsByClaim, assumptionsByClaim, usedSourceIds };
}

// ---- R-SCHEMA + fail-closed unsupported-keyword (blocking) --------------------
export function ruleSchema(norm, schemas) {
  const events = [];
  // Compile each schema once; fail closed on unsupported keywords.
  const compiled = {};
  for (const [key, schema] of Object.entries(schemas)) {
    const unsupported = compileSchema(schema);
    if (unsupported.length > 0) {
      compiled[key] = null; // do not trust => skip element validation for this type
      for (const u of unsupported) {
        events.push(err({
          rule_id: "R-SCHEMA-UNSUPPORTED-KEYWORD",
          event_type: EVENT_TYPE.SCHEMA_VALIDATOR_UNSUPPORTED_KEYWORD,
          targets: [`${TYPE_SCHEMAS[key].file}${u.path === "#" ? "" : " " + u.path}`],
          observation: `Schema uses unsupported keyword '${u.keyword}'. Stage A fails closed rather than validate partially.`,
          protocol_ref: "Validator Table A",
        }));
      }
    } else {
      compiled[key] = schema;
    }
  }
  // Validate mission (single object) and each array element against its schema.
  const validateList = (key, kind, list) => {
    if (!compiled[key]) return; // skipped (unsupported keyword)
    for (const inst of list) {
      const errs = validate(compiled[key], inst);
      for (const e of errs) {
        events.push(err({
          rule_id: "R-SCHEMA",
          event_type: EVENT_TYPE.SCHEMA_INVALID,
          targets: [idOf(kind, inst)],
          observation: `${kind} schema violation: ${e}`,
          protocol_ref: "NH-ROP §16 / schema",
        }));
      }
    }
  };
  if (norm.mission == null) {
    events.push(err({
      rule_id: "R-SCHEMA", event_type: EVENT_TYPE.SCHEMA_INVALID, targets: ["mission"],
      observation: "mission object is missing from the dataset envelope.", protocol_ref: "NH-ROP §4.1",
    }));
  } else {
    validateList("mission", "mission", [norm.mission]);
  }
  validateList("claims", "claim", norm.claims);
  validateList("evidence", "evidence", norm.evidence);
  validateList("sources", "source", norm.sources);
  validateList("assumptions", "assumption", norm.assumptions);
  validateList("unknowns", "unknown", norm.unknowns);
  validateList("contradictions", "contradiction", norm.contradictions);
  validateList("verdicts", "verdict", norm.verdicts);
  return events;
}

function idOf(kind, inst) {
  const map = {
    mission: "mission_id", claim: "claim_id", evidence: "evidence_id", source: "source_id",
    assumption: "assumption_id", unknown: "unknown_id", contradiction: "contradiction_id",
    verdict: "claim_id",
  };
  return inst?.[map[kind]] ?? `(${kind} without id)`;
}

// ---- R-ID-UNIQUE (blocking) — NH-ROP §16 "IDs never reused" -------------------
export function ruleIdUnique(norm) {
  const events = [];
  const groups = {
    claim: norm.claims.map((c) => c.claim_id),
    evidence: norm.evidence.map((e) => e.evidence_id),
    source: norm.sources.map((s) => s.source_id),
    assumption: norm.assumptions.map((a) => a.assumption_id),
    unknown: norm.unknowns.map((u) => u.unknown_id),
    contradiction: norm.contradictions.map((x) => x.contradiction_id),
  };
  const globalSeen = new Map();
  for (const [kind, ids] of Object.entries(groups)) {
    const seen = new Set();
    for (const id of ids) {
      if (id == null) continue;
      if (seen.has(id)) {
        events.push(err({
          rule_id: "R-ID-UNIQUE", event_type: EVENT_TYPE.ID_DUPLICATE, targets: [id],
          observation: `Duplicate ${kind} id '${id}' within ${kind} registry.`, protocol_ref: "NH-ROP §16",
        }));
      }
      seen.add(id);
      if (globalSeen.has(id) && globalSeen.get(id) !== kind) {
        events.push(err({
          rule_id: "R-ID-UNIQUE", event_type: EVENT_TYPE.ID_DUPLICATE, targets: [id],
          observation: `Id '${id}' reused across types (${globalSeen.get(id)} and ${kind}).`, protocol_ref: "NH-ROP §16",
        }));
      }
      globalSeen.set(id, kind);
    }
  }
  return events;
}

// ---- R-XREF (blocking) — NH-ROP §16 "objects link by ID; no orphan evidence" --
export function ruleXref(norm, idx) {
  const events = [];
  const broke = (target, observation) => events.push(err({
    rule_id: "R-XREF", event_type: EVENT_TYPE.XREF_BROKEN, targets: [target], observation, protocol_ref: "NH-ROP §16",
  }));
  for (const e of norm.evidence) {
    if (!idx.claimIds.has(e.claim_id)) broke(e.evidence_id, `evidence.claim_id '${e.claim_id}' does not resolve to a claim.`);
    if (!idx.sourceIds.has(e.source_id)) broke(e.evidence_id, `evidence.source_id '${e.source_id}' does not resolve to a source.`);
  }
  for (const v of norm.verdicts) {
    if (!idx.claimIds.has(v.claim_id)) broke(v.claim_id, `verdict.claim_id '${v.claim_id}' does not resolve to a claim.`);
  }
  for (const c of norm.claims) {
    for (const ref of c.supporting_evidence ?? []) if (!idx.evidenceById.has(ref)) broke(c.claim_id, `claim.supporting_evidence '${ref}' does not resolve to an evidence item.`);
    for (const ref of c.contradicting_evidence ?? []) if (!idx.evidenceById.has(ref)) broke(c.claim_id, `claim.contradicting_evidence '${ref}' does not resolve to an evidence item.`);
  }
  for (const a of norm.assumptions) for (const ref of a.claims_affected ?? []) if (!idx.claimIds.has(ref)) broke(a.assumption_id, `assumption.claims_affected '${ref}' does not resolve to a claim.`);
  for (const u of norm.unknowns) for (const ref of u.claims_affected ?? []) if (!idx.claimIds.has(ref)) broke(u.unknown_id, `unknown.claims_affected '${ref}' does not resolve to a claim.`);
  for (const x of norm.contradictions) for (const ref of x.in_conflict ?? []) if (!idx.claimIds.has(ref) && !idx.evidenceById.has(ref)) broke(x.contradiction_id, `contradiction.in_conflict '${ref}' does not resolve to a claim or evidence item.`);
  return events;
}

// ---- R-UNSUPPORTED-REF (blocking) — NH-ROP §4.4/§4.5 -------------------------
export function ruleUnsupportedRef(norm, idx) {
  const events = [];
  for (const c of norm.claims) {
    for (const ref of c.supporting_evidence ?? []) {
      const e = idx.evidenceById.get(ref);
      if (e && e.direction !== "Supports") {
        events.push(err({
          rule_id: "R-UNSUPPORTED-REF", event_type: EVENT_TYPE.EVIDENCE_DIRECTION_MISMATCH, targets: [c.claim_id, ref],
          observation: `claim lists '${ref}' as supporting_evidence but its direction is '${e.direction}', not 'Supports'.`,
          protocol_ref: "NH-ROP §4.4/§4.5",
        }));
      }
    }
    for (const ref of c.contradicting_evidence ?? []) {
      const e = idx.evidenceById.get(ref);
      if (e && e.direction === "Supports") {
        events.push(err({
          rule_id: "R-UNSUPPORTED-REF", event_type: EVENT_TYPE.EVIDENCE_DIRECTION_MISMATCH, targets: [c.claim_id, ref],
          observation: `claim lists '${ref}' as contradicting_evidence but its direction is 'Supports'.`,
          protocol_ref: "NH-ROP §4.4/§4.5",
        }));
      }
    }
  }
  return events;
}

// ---- R-CONFIRMED-NEEDS-EVIDENCE (blocking) — NH-ROP §10 ----------------------
export function ruleNeedsEvidence(norm) {
  const events = [];
  for (const c of norm.claims) {
    if (POSITIVE_VERDICTS.has(c.current_verdict) && (c.supporting_evidence ?? []).length === 0) {
      events.push(err({
        rule_id: "R-CONFIRMED-NEEDS-EVIDENCE", event_type: EVENT_TYPE.VERDICT_UNSUPPORTED_BY_EVIDENCE, targets: [c.claim_id],
        observation: `verdict '${c.current_verdict}' asserted with zero supporting_evidence.`, protocol_ref: "NH-ROP §10",
      }));
    }
  }
  return events;
}

// ---- R-VERDICT-CEILING (blocking) + strength-unknown (advisory) — §10/§7 -----
export function ruleVerdictCeiling(norm, idx) {
  const events = [];
  for (const c of norm.claims) {
    if (c.current_verdict !== "Confirmed") continue;
    const evs = (c.supporting_evidence ?? []).map((id) => idx.evidenceById.get(id)).filter(Boolean);
    const withStrength = evs.filter((e) => typeof e.strength_category === "string");
    if (withStrength.length === 0) {
      events.push(warn({
        rule_id: "R-VERDICT-STRENGTH-UNKNOWN", event_type: EVENT_TYPE.VERDICT_STRENGTH_UNKNOWN, targets: [c.claim_id],
        observation: `Confirmed claim has no supporting evidence with a strength_category; ceiling (Strong/Very strong) cannot be deterministically verified — review required.`,
        protocol_ref: "NH-ROP §10/§7",
      }));
      continue;
    }
    if (!withStrength.some((e) => STRONG.has(e.strength_category))) {
      events.push(err({
        rule_id: "R-VERDICT-CEILING", event_type: EVENT_TYPE.VERDICT_EXCEEDS_EVIDENCE, targets: [c.claim_id],
        observation: `Confirmed requires >=1 supporting evidence of strength Strong/Very strong; strongest present is '${strongest(withStrength)}'.`,
        protocol_ref: "NH-ROP §10 (Confirmed = Strong evidence) / §7",
      }));
    }
  }
  return events;
}
function strongest(evs) {
  const order = ["Inadmissible", "Weak", "Limited", "Moderate", "Strong", "Very strong"];
  return evs.map((e) => e.strength_category).sort((a, b) => order.indexOf(b) - order.indexOf(a))[0];
}

// ---- R-CONTRADICTION (material=blocking, open=advisory) — NH-ROP §10 ----------
export function ruleContradiction(norm, idx) {
  const events = [];
  for (const c of norm.claims) {
    if (c.current_verdict !== "Confirmed") continue;
    for (const x of idx.contradictionsByClaim.get(c.claim_id) ?? []) {
      if (x.resolution_status === "Material-remains") {
        events.push(err({
          rule_id: "R-CONTRADICTION-MATERIAL", event_type: EVENT_TYPE.CONTRADICTION_MATERIAL_UNRESOLVED, targets: [c.claim_id, x.contradiction_id],
          observation: `Confirmed claim has an unresolved material contradiction (${x.contradiction_id}, resolution_status 'Material-remains').`,
          protocol_ref: "NH-ROP §10",
        }));
      } else if (x.resolution_status === "Open" || x.resolution_status === "Methodologically-unresolved") {
        events.push(warn({
          rule_id: "R-CONTRADICTION-OPEN", event_type: EVENT_TYPE.CONTRADICTION_OPEN_REVIEW, targets: [c.claim_id, x.contradiction_id],
          observation: `Confirmed claim has a contradiction (${x.contradiction_id}) with resolution_status '${x.resolution_status}'; materiality is not a v1.0 field — review required.`,
          protocol_ref: "NH-ROP §10",
        }));
      }
    }
  }
  return events;
}

// ---- R-ASSUMPTION-FATAL (blocking) — ASSUMPTION_REGISTRY / §4.7 ---------------
export function ruleAssumptionFatal(norm, idx) {
  const events = [];
  for (const c of norm.claims) {
    if (c.current_verdict !== "Confirmed") continue;
    for (const a of idx.assumptionsByClaim.get(c.claim_id) ?? []) {
      if (a.risk_if_false === "Fatal" && a.status === "Open") {
        events.push(err({
          rule_id: "R-ASSUMPTION-FATAL", event_type: EVENT_TYPE.ASSUMPTION_FATAL_OPEN, targets: [c.claim_id, a.assumption_id],
          observation: `Confirmed claim depends on an Open assumption with risk_if_false 'Fatal' (${a.assumption_id}).`,
          protocol_ref: "NH-ROP §4.7 / ASSUMPTION_REGISTRY",
        }));
      }
    }
  }
  return events;
}

// ---- R-UNKNOWN-BLOCKING (blocking) — NH-ROP §14/§4.8 -------------------------
export function ruleUnknownBlocking(norm) {
  const events = [];
  const closing = norm.mission && (norm.mission.completion_status === "Conditions-met" || norm.mission.completion_status === "Closed");
  if (!closing) return events;
  for (const u of norm.unknowns) {
    if (u.blocks_decision === true && u.status !== "Resolved") {
      events.push(err({
        rule_id: "R-UNKNOWN-BLOCKING", event_type: EVENT_TYPE.UNKNOWN_BLOCKS_CLOSURE, targets: [u.unknown_id],
        observation: `mission.completion_status '${norm.mission.completion_status}' but unknown ${u.unknown_id} has blocks_decision=true and status '${u.status}'.`,
        protocol_ref: "NH-ROP §14/§4.8",
      }));
    }
  }
  return events;
}

// ---- R-LINEAGE-FALSE-INDEP (advisory) — NH-ROP §8 ---------------------------
export function ruleLineage(norm, idx) {
  const events = [];
  for (const c of norm.claims) {
    if (!(c.current_verdict === "Confirmed" || c.current_verdict === "Supported")) continue;
    const evs = (c.supporting_evidence ?? []).map((id) => idx.evidenceById.get(id)).filter(Boolean);
    if (evs.length < 2) continue;
    const groups = new Set(evs.map((e) => e.independence_group));
    if (groups.size === 1) {
      events.push(warn({
        rule_id: "R-LINEAGE-FALSE-INDEP", event_type: EVENT_TYPE.LINEAGE_POSSIBLE_FALSE_INDEPENDENCE, targets: [c.claim_id],
        observation: `${evs.length} supporting evidence items all share independence_group '${[...groups][0]}'; multiple items from one lineage are one confirmation — review whether independence is over-counted.`,
        protocol_ref: "NH-ROP §8",
      }));
    }
  }
  return events;
}

// ---- R-CONFIDENCE-CONSISTENCY (advisory) — NH-ROP §11 ------------------------
export function ruleConfidenceConsistency(norm, idx) {
  const events = [];
  for (const c of norm.claims) {
    if (!(c.confidence === "High" || c.confidence === "Very high")) continue;
    const evs = (c.supporting_evidence ?? []).map((id) => idx.evidenceById.get(id)).filter(Boolean);
    const weak = evs.find((e) => WEAKISH.has(e.strength_category) || (e.gating_flaw && String(e.gating_flaw).length > 0));
    const openX = (idx.contradictionsByClaim.get(c.claim_id) ?? []).find((x) => x.resolution_status === "Open" || x.resolution_status === "Material-remains");
    if (weak || openX) {
      events.push(warn({
        rule_id: "R-CONFIDENCE-CONSISTENCY", event_type: EVENT_TYPE.CONFIDENCE_POSSIBLE_INFLATION, targets: [c.claim_id],
        observation: `confidence '${c.confidence}' with ${weak ? "weak/gating-flawed supporting evidence" : ""}${weak && openX ? " and " : ""}${openX ? "an unresolved contradiction" : ""} — possible confidence inflation, review required.`,
        protocol_ref: "NH-ROP §11",
      }));
    }
  }
  return events;
}

// ---- R-REVENUE-PROVEN-REVIEW (advisory) — NH-ROP §12 -------------------------
// NOT ENFORCEABLE as a block: collected-cash / documented-methodology /
// independent-verification are not v1.0 fields. Any "Proven" => review required.
export function ruleRevenueProven(norm) {
  const events = [];
  for (const v of norm.verdicts) {
    if (v.outcome_ladder_classification === "Proven") {
      events.push(warn({
        rule_id: "R-REVENUE-PROVEN-REVIEW", event_type: EVENT_TYPE.REVENUE_PROVEN_REVIEW_REQUIRED, targets: [v.claim_id],
        observation: `outcome_ladder_classification 'Proven' asserted. §12 requires collected cash + documented methodology + independent verification — none representable as v1.0 fields. Independent/human review required; not deterministically verifiable.`,
        protocol_ref: "NH-ROP §12",
      }));
    }
  }
  return events;
}

// ---- R-ORPHAN-SOURCE (advisory) — NH-ROP §16 --------------------------------
export function ruleOrphanSource(norm, idx) {
  const events = [];
  for (const s of norm.sources) {
    if (!idx.usedSourceIds.has(s.source_id)) {
      events.push(warn({
        rule_id: "R-ORPHAN-SOURCE", event_type: EVENT_TYPE.SOURCE_ORPHAN, targets: [s.source_id],
        observation: `source '${s.source_id}' is not referenced by any evidence item.`, protocol_ref: "NH-ROP §16",
      }));
    }
  }
  return events;
}

export function runAllRules(norm, schemas) {
  const events = [];
  // Schema first (fail-closed). If schema is invalid the semantic rules still run
  // but may add noise; that is acceptable — every event is independent and typed.
  events.push(...ruleSchema(norm, schemas));
  const idx = index(norm);
  events.push(...ruleIdUnique(norm));
  events.push(...ruleXref(norm, idx));
  events.push(...ruleUnsupportedRef(norm, idx));
  events.push(...ruleNeedsEvidence(norm));
  events.push(...ruleVerdictCeiling(norm, idx));
  events.push(...ruleContradiction(norm, idx));
  events.push(...ruleAssumptionFatal(norm, idx));
  events.push(...ruleUnknownBlocking(norm));
  events.push(...ruleLineage(norm, idx));
  events.push(...ruleConfidenceConsistency(norm, idx));
  events.push(...ruleRevenueProven(norm));
  events.push(...ruleOrphanSource(norm, idx));
  return events;
}
