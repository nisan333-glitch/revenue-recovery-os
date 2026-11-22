/**
 * MOVED TO `src/contract/csvPairTransport.ts`, 2026-11-22. This file is a PURE RE-EXPORT.
 *
 * WHY IT MOVED. The two-extract pilot intake route needs the same strict transport, and production
 * code may not import from `scripts/` — nothing in `server/` or `src/` ever has. Copying the parser
 * into the server would have been a SECOND IMPLEMENTATION OF ONE RULE, and the one that disagreed
 * would be the one a customer's file met. So the module moved and this file forwards.
 *
 * WHY IT IS A RE-EXPORT AND NOT A DELETION. The CLI, the control harness and this directory's own
 * tests import it by this path, and the test that matters asserts the moved function is the SAME
 * FUNCTION OBJECT — identity, not agreement — because *a finite agreement is necessary evidence of
 * equivalence and never a proof of it*. This file declares nothing; a test fails if it ever does.
 */
export {
  CsvTransportError,
  parseStrictCsv,
  type CsvTransport,
} from "../../src/contract/csvPairTransport";
