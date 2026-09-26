// EP-26 · Test support: give a boundary the governed analysis terms every submission now requires.
//
// WHY A HELPER AND NOT A DEFAULT. The server has no default cut-off and no default stall threshold —
// that absence is the feature. So every suite that submits a dataset has to do what a real pilot does:
// propose a definition as the customer side, and have governance activate it. This does exactly that,
// through the two-identity path, so the tests exercise the real lifecycle rather than a seam.
//
// IT IS OPT-IN PER CALL, never automatic inside the service. A test that means to prove the refusal
// simply does not call it — see `analysisTermsGovernance.test.ts`, which asserts that an ungoverned
// submission is refused and that a draft, a frozen and a retired definition are each refused too.
import { hashAnalysisTerms, makeAnalysisTerms } from "../../src/contract/analysisTerms";
import {
  appendAnalysisTermsEvent,
  findAnalysisTerms,
  registerAnalysisTerms,
} from "../persistence/pilotAnalysisTermsStore";

/** The definition the suites read under. Matches the `asOf`/N the tests asserted before EP-26. */
export const TEST_ANALYSIS_TERMS = Object.freeze({
  termsId: "terms-test",
  termsVersion: "1.0.0",
  asOf: "2026-04-15",
  stallThresholdDays: 30,
});

/** Two different actors, because the server compares actor ids and not merely roles. */
const PROPOSER = { actorId: "pilot-operator@company", role: "operator" };
const ACTIVATOR = { actorId: "gov@company", role: "steward" };

export interface GovernedTermsRef {
  readonly analysisTermsId: string;
  readonly analysisTermsVersion: string;
}

/**
 * Ensure one boundary has an ACTIVE analysis-terms version, and return the reference to cite.
 *
 * Idempotent: called once per request by the suites' own `post` wrappers, and a boundary that already
 * has the version is left exactly as it is — re-proposing would hit the primary key, which is the
 * behaviour the service relies on and not something to work around here.
 */
export async function ensureGovernedTerms(
  boundaryId: string,
  over: Partial<typeof TEST_ANALYSIS_TERMS> = {},
): Promise<GovernedTermsRef> {
  const terms = makeAnalysisTerms({ ...TEST_ANALYSIS_TERMS, ...over });
  const existing = await findAnalysisTerms(boundaryId, terms.termsId, terms.termsVersion);
  if (!existing) {
    await registerAnalysisTerms({
      boundaryId,
      terms,
      termsHash: await hashAnalysisTerms(terms),
      registeredByActorId: PROPOSER.actorId,
      registeredByRole: PROPOSER.role,
    });
    await appendAnalysisTermsEvent({
      boundaryId,
      termsId: terms.termsId,
      termsVersion: terms.termsVersion,
      transition: "PROPOSED",
      actorId: PROPOSER.actorId,
      actorRole: PROPOSER.role,
      rationale: "test fixture: the quarter's cut-off",
    });
    await appendAnalysisTermsEvent({
      boundaryId,
      termsId: terms.termsId,
      termsVersion: terms.termsVersion,
      transition: "ACTIVATED",
      // A DIFFERENT identity from the proposer. If this were the same id the service would refuse it,
      // which is the separation of duties the fixture must not quietly dodge.
      actorId: ACTIVATOR.actorId,
      actorRole: ACTIVATOR.role,
      rationale: "test fixture: governance activates the cut-off",
    });
  }
  return Object.freeze({
    analysisTermsId: terms.termsId,
    analysisTermsVersion: terms.termsVersion,
  });
}

/** The fields to spread into a request body once the boundary's terms are active. */
export const GOVERNED_TERMS_FIELDS = Object.freeze({
  analysisTermsId: TEST_ANALYSIS_TERMS.termsId,
  analysisTermsVersion: TEST_ANALYSIS_TERMS.termsVersion,
});
