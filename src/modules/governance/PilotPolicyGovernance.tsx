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
import { useState } from "react";
import { Panel, Pill, SectionHeader } from "../../components/ui";
import { ADMISSION_CALC_VERSION, type PilotAdmissionPolicy } from "../../contract/pilotAdmissionPolicy";
import type { PolicyState } from "../../contract/policyLifecycle";
import {
  mayJudge,
  nextGovernanceAction,
  proposeAdmissionPolicy,
  readPolicyGovernance,
  transitionAdmissionPolicy,
  type PolicyGovernanceView,
} from "../../data/pilotPolicyClient";
import { STEWARD, operatorActorFor } from "../../data/devActor";

/**
 * Starting thresholds for the form — a STARTING POINT FOR A CONVERSATION, not a recommendation.
 *
 * Every field is required by the contract and has no default anywhere in the system; these are here
 * only so a demo does not begin with eleven empty boxes. They are the customer's commercial decision
 * to change, and nothing downstream treats them as advice. The `expected`-style discipline applies:
 * the system never picks a bar on anyone's behalf, and the server refuses a policy with a field unset.
 */
const STARTING_THRESHOLDS: Omit<PilotAdmissionPolicy, "policyId" | "policyVersion"> = {
  calculationMethodVersion: ADMISSION_CALC_VERSION,
  minAcceptedRows: 10,
  minDistinctEntities: 5,
  maxRejectionRate: 0.2,
  maxSingleReasonShare: 0.9,
  maxDuplicateRate: 0.05,
  minCoverageDays: 10,
  requiredLifecycleStates: ["stalled", "reference"],
  maxOrderingDefectRate: 0.05,
  maxMissingRecommendedColumns: 2,
  requireProvenanceDeclaration: true,
};

function stateTone(state: PolicyState | null): "proof" | "detect" | "neutral" {
  if (state === "ACTIVE") return "proof";
  if (state === "FROZEN" || state === "RETIRED") return "detect";
  return "neutral";
}

export function PilotPolicyGovernance() {
  const [boundaryId, setBoundaryId] = useState("");
  const [policyId, setPolicyId] = useState("");
  const [policyVersion, setPolicyVersion] = useState("1.0.0");
  const [thresholds, setThresholds] = useState(STARTING_THRESHOLDS);
  const [rationale, setRationale] = useState("");
  const [governance, setGovernance] = useState<PolicyGovernanceView | null>(null);
  const [policyHash, setPolicyHash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const proposer = operatorActorFor(null);
  const identified = Boolean(boundaryId.trim() && policyId.trim() && policyVersion.trim());
  const state = governance?.state ?? null;

  function numberField(key: keyof typeof STARTING_THRESHOLDS, label: string, step: string) {
    const value = thresholds[key];
    return (
      <label className="block" key={key}>
        <span className="mb-1 block text-[11px] uppercase tracking-wide text-slate-500">{label}</span>
        <input
          type="number"
          step={step}
          className="num-input w-full"
          value={typeof value === "number" ? value : 0}
          onChange={(e) =>
            setThresholds({ ...thresholds, [key]: Number(e.target.value) } as typeof thresholds)
          }
        />
      </label>
    );
  }

  async function refresh(): Promise<void> {
    if (!identified) return;
    setError(null);
    try {
      // Read as the steward: the governance read requires `AuditRead`, which the customer-side
      // operator role does not hold. Reading it as the proposer would 403, and papering over that
      // would hide a real authorization boundary.
      const view = await readPolicyGovernance(
        { boundaryId: boundaryId.trim(), policyId: policyId.trim(), policyVersion: policyVersion.trim() },
        STEWARD,
      );
      setGovernance(view);
      setPolicyHash(view.policyHash);
    } catch (e) {
      setGovernance(null);
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
      const result = await proposeAdmissionPolicy(
        {
          boundaryId: boundaryId.trim(),
          policy: { ...thresholds, policyId: policyId.trim(), policyVersion: policyVersion.trim() },
          rationale: rationale.trim(),
        },
        proposer,
      );
      setPolicyHash(result.policyHash);
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

      <Panel className="mb-4 p-5">
        <div className="mb-3 text-sm font-semibold text-slate-200">1 · Which policy</div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <label className="block">
            <span className="mb-1 block text-[11px] uppercase tracking-wide text-slate-500">Boundary (tenant)</span>
            <input className="num-input w-full" value={boundaryId} onChange={(e) => setBoundaryId(e.target.value)} />
          </label>
          <label className="block">
            <span className="mb-1 block text-[11px] uppercase tracking-wide text-slate-500">Policy id</span>
            <input className="num-input w-full" value={policyId} onChange={(e) => setPolicyId(e.target.value)} />
          </label>
          <label className="block">
            <span className="mb-1 block text-[11px] uppercase tracking-wide text-slate-500">Policy version</span>
            <input className="num-input w-full" value={policyVersion} onChange={(e) => setPolicyVersion(e.target.value)} />
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
          Every threshold is required and the system has no default for any of them. The values below
          are a starting point for a conversation, <span className="text-slate-300">not a
          recommendation</span> — a fitness bar is a commercial judgement belonging to whoever runs the
          pilot. A policy with a field unset is refused, and absence is never read as &ldquo;no
          limit&rdquo;.
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
        <div className="mb-3 flex flex-wrap items-center gap-2">
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
          <button type="button" className="rounded-lg border border-proof-600/40 bg-proof-600/10 px-3 py-1.5 text-sm text-proof-500 hover:bg-proof-600/20 disabled:opacity-40" disabled={!identified || busy || !rationale.trim()} onClick={() => void propose()}>
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

        {policyHash && (
          <div className="mt-3 text-[11px] text-slate-500">
            Policy hash <span className="font-mono text-slate-300">{policyHash}</span> — stamped into
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

      {governance && governance.events.length > 0 && (
        <Panel className="p-5">
          <div className="mb-2 text-[11px] uppercase tracking-wide text-slate-500">
            Who decided what — append-only, nothing here is editable
          </div>
          <ol className="space-y-2">
            {governance.events.map((event, i) => (
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
          {governance.proposedBy && governance.activatedBy && (
            <p className="mt-3 text-[11px] text-slate-500">
              Proposed by <span className="text-slate-300">{governance.proposedBy}</span>, activated by{" "}
              <span className="text-slate-300">{governance.activatedBy}</span> —{" "}
              {governance.proposedBy === governance.activatedBy
                ? "the same identity, which the server should not have allowed."
                : "two different identities, which is the point."}
            </p>
          )}
        </Panel>
      )}
    </div>
  );
}
