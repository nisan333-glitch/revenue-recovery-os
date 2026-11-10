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

/** The shape of a governed analysis-terms definition as the suites state one. */
export interface TestAnalysisTerms {
  readonly termsId: string;
  readonly termsVersion: string;
  readonly asOf: string;
  readonly stallThresholdDays: number;
  readonly currency: string;
}

/**
 * The definition the suites read under. Matches the `asOf`/N the tests asserted before EP-26.
 *
 * TYPED AS `TestAnalysisTerms`, NOT INFERRED, AND THAT IS THE FIX FOR A REAL DEFECT.
 * `Object.freeze` on an object literal returns `Readonly<T>` with the string fields narrowed to
 * LITERAL types — `asOf` became the type `"2026-04-15"`, not `string`. So the override parameter below,
 * derived as `Partial<typeof TEST_ANALYSIS_TERMS>`, accepted ONLY the default values: a test asking for
 * `asOf: "2026-05-31"` was passing an argument the type forbids. Twelve call sites across six suites
 * were doing exactly that, and they worked only because esbuild strips types without checking them.
 *
 * That is the shape of defect the server-test typecheck was turned on to find: a test helper whose type
 * contract is a LIE ABOUT WHAT IT ACCEPTS. A helper that cannot express varying the thing it exists to
 * vary would also silently accept a caller that stopped varying it — which is how a double conceals
 * contract drift. The annotation widens the declared type to what the helper really takes; it narrows
 * nothing and loosens no check, because `makeAnalysisTerms` still validates every field it is given.
 */
export const TEST_ANALYSIS_TERMS: TestAnalysisTerms = Object.freeze({
  termsId: "terms-test",
  termsVersion: "1.0.0",
  asOf: "2026-04-15",
  stallThresholdDays: 30,
  currency: "USD",
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
  // `calculationMethodVersion` is not in TEST_ANALYSIS_TERMS because it is a BUILD CONSTANT that
  // `makeAnalysisTerms` fills in — no request can state it. A test may override it, and exactly one
  // does: the only way to construct a definition blessed for a method this build does not implement,
  // which is what the schedule-time compatibility gate exists to refuse.
  over: Partial<TestAnalysisTerms> & { calculationMethodVersion?: string } = {},
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
