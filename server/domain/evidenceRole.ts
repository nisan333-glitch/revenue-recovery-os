// Evidence-role derivation — RE-EXPORT ONLY. The implementation is `src/domain/evidenceRole.ts`.
//
// WHY THIS FILE STILL EXISTS. It was the home of the derivation while the governed HTTP route was
// the only path that could mint a Proof. The pure approval path now has to ask the same question,
// and a domain module may not import from `server/`, so the implementation moved down and this file
// became a re-export. Keeping it means `server/persistence/evidenceStore.ts` and every other server
// caller resolve to the SAME bindings through the import specifier they already had — no call site
// changed, no behaviour changed, and `ROLE_MAP_VERSION` did not move, because a version that signals
// a change which did not happen is its own defect.
//
// IT MUST STAY A RE-EXPORT AND NOTHING ELSE. The moment a declaration is added here it becomes a
// second policy that can disagree with the first, which is the defect this slice removed.
// `src/domain/evidenceRoleSharing.test.ts` asserts identity — `server`'s `deriveEvidenceRole` must be
// the same function object as the domain's — and reads this file's source to assert it declares
// nothing of its own. Identity is the proof; a fixture that happens to agree is only evidence.
export {
  ROLE_MAP_VERSION,
  OUTCOME_EVIDENCE_TYPES,
  CORRECTION_EVIDENCE_TYPES,
  ALL_CORRECTION_EVIDENCE_TYPES,
  deriveEvidenceRole,
} from "../../src/domain/evidenceRole";
export type { EvidenceRole } from "../../src/domain/evidenceRole";
