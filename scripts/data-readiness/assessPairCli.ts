/**
 * Local, read-only pilot-pair readiness CLI. The thin edge: argv, the filesystem and stdout. All of the
 * logic is in `assessPairCore.ts`, where it can be falsified.
 *
 *   npm run -s readiness:pair -- --expectation /secure/contract.csv --billing /secure/invoices.csv \
 *     --currency USD
 *
 * USE `-s`. Without it npm prints its own banner on STDOUT, ahead of the report, so `| jq` fails on a
 * run that succeeded. The report is on stdout and the framing on stderr precisely so the output can be
 * piped; npm's banner is the one thing that defeats that, and it is not ours to suppress from in here.
 *
 * It prints the governed readiness report and nothing from the source files — no row, no identifier, no
 * amount, no path. It persists nothing, opens no connection, computes no money, and cannot establish
 * provenance: with no attestation, authority is SOURCE_NATIVE and every level is PROVISIONAL.
 *
 * NEVER commit a real customer export to this repository, and never paste one into a log or an issue.
 */
import { readFileSync, statSync } from "node:fs";
import { CsvTransportError } from "./csvPairTransport";
import { PAIR_RUN_PREAMBLE, assessPairFromCsv, parseArguments } from "./assessPairCore";

const MAX_BYTES_PER_FILE = 30 * 1024 * 1024;

function readLocal(path: string): string {
  const info = statSync(path);
  if (!info.isFile() || info.size > MAX_BYTES_PER_FILE) {
    throw new CsvTransportError("FILE_NOT_REGULAR_OR_TOO_LARGE");
  }
  return readFileSync(path, "utf8");
}

try {
  const args = parseArguments(process.argv.slice(2));
  // Read both files BEFORE validating either, so a missing second file fails before any report is built.
  const expectationCsv = readLocal(args.expectation);
  const billingCsv = readLocal(args.billing);
  const { report, exitCode } = assessPairFromCsv(expectationCsv, billingCsv, { currency: args.currency });
  for (const line of PAIR_RUN_PREAMBLE) process.stderr.write(`${line}\n`);
  // The report goes to stdout so it can be piped; the framing goes to stderr so a pipe gets clean JSON.
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  process.exitCode = exitCode;
} catch (error) {
  // FAIL CLOSED, AND SAY WHOSE FAULT IT IS. A transport or argument refusal is about the INPUT and
  // carries its own code. Anything else is an NH defect, and reporting it as unreadable input would blame
  // the customer's file for our bug — the `NH-AX-1009` lesson, where a malformed caller claim was raised
  // as a dataset rejection. Neither branch echoes a path, a row or a filesystem message.
  if (error instanceof CsvTransportError) {
    process.stderr.write(`${error.code}\n`);
  } else if ((error as { code?: string } | null)?.code === "ENOENT"
    || (error as { code?: string } | null)?.code === "EACCES"
    || (error as { code?: string } | null)?.code === "EISDIR") {
    process.stderr.write("LOCAL_INPUT_UNREADABLE\n");
  } else {
    process.stderr.write("NH_INTERNAL_ERROR\n");
  }
  process.exitCode = 2;
}
