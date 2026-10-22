// One statement of what a case's or candidate's identity COVERS, rendered in one place.
//
// WHY A COMPONENT. Two screens need it and both will grow more. A sentence copied into each is two things
// that can drift from each other and from the payload — the same reason `DemoDataBanner` exists and the
// same reason the server derives the disclosure once in `src/domain/caseIdentityGrain.ts`.
//
// IT RENDERS THE SERVER'S WORDS. `headline` and `reason` come from the governed payload verbatim; this
// component chooses no wording of its own about the limitation, because
// `LEAK_INSTANCE_IDENTITY_UNAVAILABLE_DETAIL` is exported precisely "so callers do not invent wording of
// their own". What it adds is placement and emphasis.
//
// SHAPE BORROWED FROM THE TRAIL-ORDER CAVEAT already on the case screen: say what is NOT established, say
// what is unaffected, and decline to resolve it. That caveat is the house idiom for exactly this kind of
// honest incompleteness, so this is not a new convention.
//
// "NOT CHECKED" IS RENDERED AS SUCH. When `absorbedObservations.checked` is false the notice says nobody
// looked and names the tool that does. Printing "no absorptions found" would assert work that never
// happened — the `$0.00`-for-an-absent-proof mistake, one lane over.
import type { CaseIdentityGrainDTO } from "../data/governedTrustClient";

/**
 * AN ABSENT DISCLOSURE FAILS CLOSED, and this is the component's load-bearing property rather than
 * defensive typing. `grain` is optional because a response can genuinely arrive without it — an older
 * server during a rolling deploy, a cached payload, a route that has not been wired yet. Reading that
 * silence as "nothing to warn about" would mean the warning can be deleted by a deploy skew, which is
 * precisely the failure this whole slice exists to prevent. So a missing disclosure renders a notice
 * saying the server did not state what the identity covers; it cannot render nothing.
 *
 * It was found rather than foreseen: the pre-existing queue screen tests supply a candidate with no
 * `identityGrain`, and the first form of this component crashed on them. Making the fixture pass would
 * have been the smaller fix and the wrong one.
 */
export function IdentityGrainNotice({ grain }: { grain?: CaseIdentityGrainDTO }) {
  if (!grain) {
    return (
      <div
        role="note"
        data-testid="identity-grain-notice"
        data-grain="NOT_STATED"
        className="mb-4 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-[12px] text-amber-200"
      >
        <strong data-testid="grain-not-stated">
          IDENTITY GRAIN NOT STATED. This response did not say what this record&rsquo;s identity covers, so
          it must not be read as a claim about one contractual obligation.
        </strong>
        <p className="mt-2 text-amber-200/80">
          Absence is not reassurance. Until the read surface states the grain, assume account-level
          identity &mdash; which is what every current build provides.
        </p>
      </div>
    );
  }

  // Nothing to warn about only in a state this build cannot reach. Rendering nothing then is correct:
  // a notice saying "identity is fine" is noise, and the day it can be reached it should be silent.
  if (!grain.mayCoverMultipleObligations) return null;

  const absorbed = grain.absorbedObservations;
  return (
    <div
      role="note"
      data-testid="identity-grain-notice"
      data-grain={grain.grain}
      className="mb-4 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-[12px] text-amber-200"
    >
      <strong>{grain.headline}</strong>
      <p className="mt-2 text-amber-200/80">{grain.reason}</p>
      <p className="mt-2 text-amber-200/80">
        {absorbed.checked ? (
          <>
            Absorbed detector observations recorded against this account:{" "}
            <span data-testid="absorbed-count" className="font-medium">{absorbed.count}</span>.
          </>
        ) : (
          <span data-testid="absorbed-not-checked">
            Whether a second observation was absorbed has <strong>not been checked</strong> here — this
            read does not look, and reporting none would claim otherwise. The{" "}
            <span className="font-mono">exposure:absorbed</span> diagnostic is what looks.
          </span>
        )}
      </p>
    </div>
  );
}
