// EP-19 · Pilot policy governance — a SEPARATE screen, deliberately.
//
// WHY IT IS NOT PART OF THE ASSESSMENT FLOW. Proposing a fitness bar and putting one in force are two
// acts by two people, and the server enforces that: it refuses an activation by the actor who proposed
// the policy, comparing actorId as well as role. A single screen where a customer walked from "propose"
// to "activate" would model a beneficiary setting the bar that judges them — the one thing the trust
// invariant forbids outright — even while the server refused it. So the assessment flow reads policy
// state and blocks; this screen is where governance acts, under its own identity.
//
// THE ACTOR SWITCH IS DEV-ONLY, and labelled as such. It mirrors the backend's `x-actor-id` /
// `x-actor-role` header scheme, which `server/auth/actorContext.ts` itself documents as not production
// authentication. It supplies identity; every authorization and separation-of-duties rule is enforced
// server-side and cannot be bypassed from here.
//
// Nothing on this screen computes a threshold, a verdict, or a number. It states thresholds and reports
// what the server decided about them.
import { useRef, useState } from "react";
import { Panel, Pill, SectionHeader } from "../../components/ui";
import { ADMISSION_CALC_VERSION, validateAdmissionPolicy, type PilotAdmissionPolicy, type RequiredLifecycleState } from "../../contract/pilotAdmissionPolicy";
import type { PolicyState } from "../../contract/policyLifecycle";
import {
  forSelection,
  mayApplyRead,
  selectedPolicyKey,
  mayJudge,
  nextGovernanceAction,
  proposeAdmissionPolicy,
  readPolicyGovernance,
  transitionAdmissionPolicy,
  type PolicyGovernanceView,
} from "../../data/pilotPolicyClient";
import { STEWARD, operatorActorFor } from "../../data/devActor";
import { AnalysisTermsGovernance } from "./AnalysisTermsGovernance";

// NOTHING IS SEEDED HERE ANY MORE. This form used to open with a full set of plausible thresholds,
// described as "a starting point for a conversation". The trouble with a seeded bar is that it anchors
// the commercial judgement it claims not to make: the path of least resistance is to accept it, and the
// bar a pilot is judged against is the first input to the number the pilot benefits from. So every
// field starts blank, blank is not zero, and an incomplete policy cannot be proposed at all.
const NUMERIC_FIELDS = ["minAcceptedRows", "minDistinctEntities", "minCoverageDays", "maxMissingRecommendedColumns", "maxRejectionRate", "maxSingleReasonShare", "maxDuplicateRate", "maxOrderingDefectRate"] as const;
type NumericField = (typeof NUMERIC_FIELDS)[number];
const EMPTY_THRESHOLDS: Record<NumericField, string> = {
  minAcceptedRows: "", minDistinctEntities: "", minCoverageDays: "", maxMissingRecommendedColumns: "",
  maxRejectionRate: "", maxSingleReasonShare: "", maxDuplicateRate: "", maxOrderingDefectRate: "",
};

/**
 * The policy as stated so far, or null while any choice is still unmade.
 *
 * It does NOT validate — that is deliberate. An unfinished form is not an invalid one, and showing
 * "must be a fraction between 0 and 1" against a box nobody has typed in yet trains people to ignore
 * the message. Validation runs separately on a complete policy, so defects mean something when shown.
 */
function completePolicy(
  fields: Record<NumericField, string>,
  lifecycle: readonly RequiredLifecycleState[] | null,
  provenanceRequired: boolean | null,
  policyId: string,
  policyVersion: string,
): PilotAdmissionPolicy | null {
  if (NUMERIC_FIELDS.some(field => fields[field].trim() === "") || lifecycle === null || provenanceRequired === null) return null;
  const numeric = Object.fromEntries(NUMERIC_FIELDS.map(field => [field, Number(fields[field])])) as Record<NumericField, number>;
  return { ...numeric, policyId, policyVersion, calculationMethodVersion: ADMISSION_CALC_VERSION,
    requiredLifecycleStates: lifecycle, requireProvenanceDeclaration: provenanceRequired };
}

function stateTone(state: PolicyState | null): "proof" | "detect" | "neutral" {
  if (state === "ACTIVE") return "proof";
  if (state === "FROZEN" || state === "RETIRED") return "detect";
  return "neutral";
}

export function PilotPolicyGovernance() {
  const [boundaryId, setBoundaryId] = useState("");
  const [policyId, setPolicyId] = useState("");
  const [policyVersion, setPolicyVersion] = useState("1.0.0");
  const [thresholds, setThresholds] = useState(EMPTY_THRESHOLDS);
  // null means "not yet reviewed", [] means "reviewed, none required". Collapsing those two would let
  // an untouched form read as a deliberate decision that no lifecycle state need be present.
  const [requiredLifecycleStates, setRequiredLifecycleStates] = useState<readonly RequiredLifecycleState[] | null>(null);
  const [requireProvenanceDeclaration, setRequireProvenanceDeclaration] = useState<boolean | null>(null);
  const [rationale, setRationale] = useState("");
  const [governance, setGovernance] = useState<PolicyGovernanceView | null>(null);
  const [policyHash, setPolicyHash] = useState<string | null>(null);
  // Which identity the held view and hash were read for. Null means "nothing read for what is selected".
  const [loadedPolicyKey, setLoadedPolicyKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // A ref, not state: `refresh()` needs to know, AFTER its await, whether the selection has moved since
  // it started. Derived state cannot tell it that — the in-flight closure would never learn.
  const selectedKeyRef = useRef(selectedPolicyKey(boundaryId, policyId, policyVersion));

  const proposer = operatorActorFor(null);
  const identified = Boolean(boundaryId.trim() && policyId.trim() && policyVersion.trim());
  const complete = completePolicy(thresholds, requiredLifecycleStates, requireProvenanceDeclaration, policyId.trim(), policyVersion.trim());
  const policyDefects = complete ? validateAdmissionPolicy(complete) : [];
  const policyToPropose = complete && policyDefects.length === 0 ? complete : null;
  // A verdict is shown only beside the identity it was read for. Everything below renders these, never
  // `governance`/`policyHash` directly.
  const currentPolicyKey = selectedPolicyKey(boundaryId, policyId, policyVersion);
  const currentGovernance = forSelection(governance, loadedPolicyKey, currentPolicyKey);
  const currentPolicyHash = forSelection(policyHash, loadedPolicyKey, currentPolicyKey);
  const state = currentGovernance?.state ?? null;

  /**
   * Editing the selection drops what was read for the old one.
   *
   * Clearing the state looks redundant beside the derived gate above, and is not: it makes editing away
   * and back require an explicit re-read, instead of silently restoring a view that may no longer match
   * the server. Do not "simplify" it out.
   */
  function invalidateSelection(nextBoundary: string, nextId: string, nextVersion: string): void {
    selectedKeyRef.current = selectedPolicyKey(nextBoundary, nextId, nextVersion);
    setGovernance(null);
    setPolicyHash(null);
    setLoadedPolicyKey(null);
  }

  function numberField(key: NumericField, label: string, step: string) {
    const value = thresholds[key];
    return (
      <label className="block" key={key}>
        <span className="mb-1 block text-[11px] uppercase tracking-wide text-slate-500">{label}</span>
        <input
          type="number"
          step={step}
          className="num-input w-full"
          value={value}
          onChange={(e) => setThresholds({ ...thresholds, [key]: e.target.value })}
        />
      </label>
    );
  }

  async function refresh(): Promise<void> {
    if (!identified) return;
    const requestedPolicyKey = currentPolicyKey;
    setError(null);
    try {
      // Read as the steward: the governance read requires `AuditRead`, which the customer-side
      // operator role does not hold. Reading it as the proposer would 403, and papering over that
      // would hide a real authorization boundary.
      const view = await readPolicyGovernance(
        { boundaryId: boundaryId.trim(), policyId: policyId.trim(), policyVersion: policyVersion.trim() },
        STEWARD,
      );
      if (!mayApplyRead(requestedPolicyKey, selectedKeyRef.current)) return;
      setGovernance(view);
      setPolicyHash(view.policyHash);
      setLoadedPolicyKey(requestedPolicyKey);
    } catch (e) {
      if (!mayApplyRead(requestedPolicyKey, selectedKeyRef.current)) return;
      setGovernance(null);
      setPolicyHash(null);
      setLoadedPolicyKey(null);
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function act(run: () => Promise<void>): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await run();
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const propose = () =>
    act(async () => {
      if (!policyToPropose) throw new Error("State every threshold and lifecycle choice before proposing a policy.");
      const result = await proposeAdmissionPolicy(
        {
          boundaryId: boundaryId.trim(),
          policy: policyToPropose,
          rationale: rationale.trim(),
        },
        proposer,
      );
      // The hash is deliberately NOT set from here. It is only ever displayed from a successful
      // lifecycle read (`refresh`, which runs next via `act`), because a hash shown beside a lifecycle
      // the screen could not read would assert more than is known. A failed read surfaces its error.
      void result;
    });

  const move = (transition: "ACTIVATED" | "FROZEN" | "UNFROZEN" | "RETIRED") =>
    act(async () => {
      await transitionAdmissionPolicy(
        transition,
        {
          boundaryId: boundaryId.trim(),
          policyId: policyId.trim(),
          policyVersion: policyVersion.trim(),
          rationale: rationale.trim(),
        },
        STEWARD,
      );
    });

  return (
    <div>
      <SectionHeader
        title="Pilot Policy Governance"
        subtitle="Propose a pilot fitness bar, and put one in force. Two acts, two identities — the server refuses them from the same actor."
      />

      <Panel className="mb-4 p-3 text-[12px] text-slate-400">
        <Pill tone="detect">dev-only identities</Pill> This screen acts as two identities so one
        machine can demonstrate both halves. It mirrors the backend&rsquo;s development header scheme,
        which is <span className="text-slate-300">not production authentication</span>. Authorization
        and separation of duties are enforced on the server and cannot be changed from here: an
        activation by the actor who proposed the policy is refused, by identity as well as by role.
      </Panel>

      {/* EP-26 · The other governed object on this screen. Separate panel, separate identity space:
          an act on the fitness bar is never an act on the definition of "stalled". */}
      <AnalysisTermsGovernance />

      <Panel className="mb-4 p-5">
        <div className="mb-3 text-sm font-semibold text-slate-200">1 · Which policy</div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <label className="block">
            <span className="mb-1 block text-[11px] uppercase tracking-wide text-slate-500">Boundary (tenant)</span>
            <input className="num-input w-full" value={boundaryId} onChange={(e) => {
              invalidateSelection(e.target.value, policyId, policyVersion);
              setBoundaryId(e.target.value);
            }} />
          </label>
          <label className="block">
            <span className="mb-1 block text-[11px] uppercase tracking-wide text-slate-500">Policy id</span>
            <input className="num-input w-full" value={policyId} onChange={(e) => {
              invalidateSelection(boundaryId, e.target.value, policyVersion);
              setPolicyId(e.target.value);
            }} />
          </label>
          <label className="block">
            <span className="mb-1 block text-[11px] uppercase tracking-wide text-slate-500">Policy version</span>
            <input className="num-input w-full" value={policyVersion} onChange={(e) => {
              invalidateSelection(boundaryId, policyId, e.target.value);
              setPolicyVersion(e.target.value);
            }} />
          </label>
        </div>
        <button
          type="button"
          className="mt-3 rounded-lg border border-ink-500/50 px-3 py-1.5 text-sm text-slate-300 hover:bg-ink-700/50 disabled:opacity-40"
          disabled={!identified || busy}
          onClick={() => void refresh()}
        >
          Read lifecycle
        </button>
      </Panel>

      <Panel className="mb-4 p-5">
        <div className="mb-1 text-sm font-semibold text-slate-200">2 · Thresholds</div>
        <p className="mb-3 text-[12px] text-slate-500">
          Every threshold must be stated deliberately. Blank is not zero and cannot be proposed.
          The system has no default for any of them; absence is never read as no limit.
          A fitness bar is a commercial judgement belonging to whoever runs the pilot.
        </p>
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          {numberField("minAcceptedRows", "Min accepted rows", "1")}
          {numberField("minDistinctEntities", "Min distinct entities", "1")}
          {numberField("minCoverageDays", "Min coverage (days)", "1")}
          {numberField("maxMissingRecommendedColumns", "Max missing recommended cols", "1")}
          {numberField("maxRejectionRate", "Max rejection rate", "0.01")}
          {numberField("maxSingleReasonShare", "Max single-reason share", "0.01")}
          {numberField("maxDuplicateRate", "Max duplicate rate", "0.01")}
          {numberField("maxOrderingDefectRate", "Max ordering-defect rate", "0.01")}
        </div>
        <div className="mt-3 grid grid-cols-1 gap-4 md:grid-cols-2">
          <fieldset className="block text-sm text-slate-300">
            <legend>Required lifecycle states</legend>
            {/* The gate exists so an EMPTY selection can be a decision rather than an omission. Three
                unticked boxes on an untouched form say nothing; ticking this says "none required". */}
            <label className="mt-1 block">
              <input type="checkbox" checked={requiredLifecycleStates !== null}
                onChange={e => setRequiredLifecycleStates(e.target.checked ? [] : null)} />
              {" "}I have reviewed lifecycle coverage (none required if no states are selected)
            </label>
            {(["stalled", "reference", "undetermined"] as const).map(state => (
              <label className="mt-1 block" key={state}>
                <input type="checkbox" disabled={requiredLifecycleStates === null}
                  checked={requiredLifecycleStates?.includes(state) ?? false}
                  onChange={e => setRequiredLifecycleStates(current => current === null ? null :
                    e.target.checked ? [...current, state] : current.filter(value => value !== state))} />
                {" "}{state}
              </label>
            ))}
          </fieldset>
          <label className="block text-sm text-slate-300">Require provenance declaration
            <select className="num-input mt-1 w-full" value={requireProvenanceDeclaration === null ? "" : String(requireProvenanceDeclaration)}
              onChange={(e) => setRequireProvenanceDeclaration(e.target.value === "" ? null : e.target.value === "true")}>
              <option value="">Choose explicitly</option><option value="true">Yes</option><option value="false">No</option>
            </select>
          </label>
        </div>
        {/* Named defects, not a silently disabled button. `validateAdmissionPolicy` returns the field
            and the reason precisely so a caller holding user input can say which box is wrong. */}
        {policyDefects.length > 0 && (
          <ul className="mt-3 text-[12px] text-detect-500" aria-label="Policy threshold errors">
            {policyDefects.map(defect => <li key={`${defect.field}:${defect.spec.code}`}>{defect.field}: {defect.detail}</li>)}
          </ul>
        )}
        <label className="mt-3 block">
          <span className="mb-1 block text-[11px] uppercase tracking-wide text-slate-500">
            Rationale (required on every act)
          </span>
          <input
            className="num-input w-full"
            value={rationale}
            onChange={(e) => setRationale(e.target.value)}
            placeholder="why this bar, or why this transition"
          />
        </label>
      </Panel>

      <Panel className="mb-4 p-5">
        {/* EP-26 · Labelled, because the screen now shows TWO governed objects and their state words are
            the same words. An unscoped assertion on "ACTIVE" could be satisfied by the other panel. */}
        <div aria-label="Admission bar state" className="mb-3 flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold text-slate-200">3 · Lifecycle</span>
          <Pill tone={stateTone(state)}>{state ?? "not proposed"}</Pill>
          {mayJudge(state) ? (
            <Pill tone="proof">may judge a dataset</Pill>
          ) : (
            <Pill tone="detect">judges nothing</Pill>
          )}
        </div>
        <p className="mb-3 text-[12px] text-slate-400">{nextGovernanceAction(state)}</p>

        <div className="flex flex-wrap gap-2">
          <button type="button" className="rounded-lg border border-proof-600/40 bg-proof-600/10 px-3 py-1.5 text-sm text-proof-500 hover:bg-proof-600/20 disabled:opacity-40" disabled={!identified || !policyToPropose || busy || !rationale.trim()} onClick={() => void propose()}>
            Propose as {proposer.actorId} ({proposer.role})
          </button>
          <button type="button" className="rounded-lg border border-proof-600/40 bg-proof-600/10 px-3 py-1.5 text-sm text-proof-500 hover:bg-proof-600/20 disabled:opacity-40" disabled={!identified || busy || !rationale.trim()} onClick={() => void move("ACTIVATED")}>
            Activate as {STEWARD.actorId} (steward)
          </button>
          <button type="button" className="rounded-lg border border-ink-500/50 px-3 py-1.5 text-sm text-slate-300 hover:bg-ink-700/50 disabled:opacity-40" disabled={!identified || busy || !rationale.trim()} onClick={() => void move("FROZEN")}>
            Freeze
          </button>
          <button type="button" className="rounded-lg border border-ink-500/50 px-3 py-1.5 text-sm text-slate-300 hover:bg-ink-700/50 disabled:opacity-40" disabled={!identified || busy || !rationale.trim()} onClick={() => void move("UNFROZEN")}>
            Resume
          </button>
          <button type="button" className="rounded-lg border border-ink-500/50 px-3 py-1.5 text-sm text-slate-300 hover:bg-ink-700/50 disabled:opacity-40" disabled={!identified || busy || !rationale.trim()} onClick={() => void move("RETIRED")}>
            Retire
          </button>
        </div>

        {currentPolicyHash && (
          <div className="mt-3 text-[11px] text-slate-500">
            Policy hash <span className="font-mono text-slate-300">{currentPolicyHash}</span> — stamped into
            every decision, so retiring or superseding this version can never alter a verdict already
            made under it.
          </div>
        )}
        {error && (
          <div className="mt-3 rounded-lg border border-detect-600/40 p-3 text-[12px] text-detect-500">
            {error}
          </div>
        )}
      </Panel>

      {currentGovernance && currentGovernance.events.length > 0 && (
        <Panel className="p-5">
          <div className="mb-2 text-[11px] uppercase tracking-wide text-slate-500">
            Who decided what — append-only, nothing here is editable
          </div>
          <ol className="space-y-2">
            {currentGovernance.events.map((event, i) => (
              <li key={`${event.at}-${i}`} className="rounded-lg border border-ink-500/50 p-3 text-[12px]">
                <div className="flex flex-wrap items-center gap-2">
                  <Pill tone="neutral">{event.transition}</Pill>
                  <span className="text-slate-300">{event.actorId}</span>
                  <span className="text-slate-500">({event.actorRole})</span>
                  <span className="text-slate-500">{event.at}</span>
                </div>
                <div className="mt-1 text-slate-400">{event.rationale}</div>
              </li>
            ))}
          </ol>
          {currentGovernance.proposedBy && currentGovernance.activatedBy && (
            <p className="mt-3 text-[11px] text-slate-500">
              Proposed by <span className="text-slate-300">{currentGovernance.proposedBy}</span>, activated by{" "}
              <span className="text-slate-300">{currentGovernance.activatedBy}</span> —{" "}
              {currentGovernance.proposedBy === currentGovernance.activatedBy
                ? "the same identity, which the server should not have allowed."
                : "two different identities, which is the point."}
            </p>
          )}
        </Panel>
      )}
    </div>
  );
}
