// The one place a PROVEN Revenue Returned figure is rendered, and the one place NOT COMPUTED is said.
//
// WHY A COMPONENT. `provenRevenueReturned` returns `number | null`, and `null` means NO PROOF CAN
// EXIST. Every surface that renders it must say that rather than coerce it, because a rendered
// `$0.00` asserts something false and specific: that a proof was looked for, found, and summed to
// nothing. Left to each screen, the coercion would reappear somewhere — `?? 0` is one character and
// reads as defensive programming. One component is one place for the rule to live, and
// `provenRevenueLabelling.test.ts` derives the list of screens that must use it from the code.
//
// IT ALSO CARRIES THE REASON, because a refusal with no reason tells a reader what not to trust and
// not what to do instead. The detail comes from `proofUnavailable`, which is the same verdict the
// approval gate produces — so the screen cannot say something the gate would not.
import type { RecoveryEvent } from "../domain/types";
import { money } from "../lib/format";
import { proofUnavailable, provenRevenueReturned } from "../domain/invariants";

/** The literal rendered where no proof can exist. Exported so tests assert the string, not a regex. */
export const NOT_COMPUTED = "NOT COMPUTED";

export function ProvenRevenueFigure({ event, className }: { event: RecoveryEvent; className?: string }) {
  const proven = provenRevenueReturned(event);
  if (proven !== null) {
    return (
      <span className={className ?? "tabular-nums text-proof-500"} data-testid="proven-revenue">
        {money(proven)}
      </span>
    );
  }
  return (
    <span className="tabular-nums text-slate-400" data-testid="proven-revenue-not-computed">
      {NOT_COMPUTED}
    </span>
  );
}

/**
 * Why no proof exists — rendered only when that is the case, never as a reassuring empty box.
 *
 * An event with no recovery reason yields no refusal here on purpose: `proofUnavailable` says nothing
 * about a mechanism that was never named, and rule 2 already refuses an unclassified recovery on its
 * own, different ground with its own, different remedy.
 */
export function ProofRefusedNotice({ event }: { event: RecoveryEvent }) {
  const refusal = proofUnavailable(event);
  if (refusal === null) return null;
  return (
    <div
      role="note"
      data-testid="proof-refused-notice"
      className="mt-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-[12px] text-amber-200"
    >
      <strong>PROOF REFUSED — Revenue Returned is {NOT_COMPUTED}.</strong>{" "}
      {refusal.detail}
      <div className="mt-1 text-amber-200/80">
        The money shown as collected on this case is a recorded fact. What cannot be established is that
        this recovery mechanism caused it, because no source attests the mechanism — so no figure here
        is proven Revenue Returned, and none is reported as zero either.
      </div>
    </div>
  );
}
