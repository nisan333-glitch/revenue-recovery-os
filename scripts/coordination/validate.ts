// `npm run coordination:validate -- <file>… | --stdin` — check NH status records.
//
// Inputs: a `.json` file holding one record (or an array), or any other file / stdin treated as a GitHub
// comment body from which ```nh-status blocks are extracted. Typical use:
//
//   gh api repos/<owner>/<repo>/issues/<n>/comments --paginate --jq '.[].body' | npm run coordination:validate -- --stdin
//
// Exit 0: at least one record checked and all valid. Exit 1: an invalid record or parse error.
// Exit 2: NOTHING was checked — a validator that reports success having looked at nothing is worse than none.
//
// Read-only: it writes nothing and makes no network call. Errors name the field and the rule, never the
// offending value (the value may be the secret the rule exists to catch).
import { readFileSync } from "node:fs";
import {
  extractStatusRecords,
  validateSequence,
  validateStatusRecord,
  type StatusRecord,
} from "./statusRecord.ts";

function collect(text: string, asJson: boolean): { records: unknown[]; parseErrors: string[] } {
  if (asJson) {
    try {
      const parsed: unknown = JSON.parse(text);
      return { records: Array.isArray(parsed) ? parsed : [parsed], parseErrors: [] };
    } catch (err) {
      return { records: [], parseErrors: [`not valid JSON (${err instanceof Error ? err.message : "parse error"})`] };
    }
  }
  return extractStatusRecords(text);
}

function main(argv: string[]): number {
  const useStdin = argv.includes("--stdin");
  const files = argv.filter((a) => !a.startsWith("--"));
  const sources: Array<{ label: string; text: string; asJson: boolean }> = [];
  if (useStdin) sources.push({ label: "stdin", text: readFileSync(0, "utf8"), asJson: false });
  for (const f of files) sources.push({ label: f, text: readFileSync(f, "utf8"), asJson: f.endsWith(".json") });

  if (sources.length === 0) {
    console.error("coordination: no input given, so NOTHING was checked. Pass file(s) or --stdin.");
    return 2;
  }

  let checked = 0;
  let failed = 0;
  const valid: StatusRecord[] = [];
  for (const s of sources) {
    const { records, parseErrors } = collect(s.text, s.asJson);
    for (const pe of parseErrors) {
      failed += 1;
      console.error(`FAIL ${s.label}: ${pe}`);
    }
    records.forEach((rec, i) => {
      checked += 1;
      const r = validateStatusRecord(rec);
      const tag = `${s.label}#${i + 1}`;
      if (r.ok) {
        valid.push(rec as StatusRecord);
        console.log(`PASS ${tag}`);
      } else {
        failed += 1;
        console.error(`FAIL ${tag}`);
        for (const e of r.errors) console.error(`     ${e}`);
      }
    });
  }

  if (checked === 0 && failed === 0) {
    console.error("coordination: input contained no nh-status record, so NOTHING was checked.");
    return 2;
  }

  const seq = validateSequence(valid);
  if (!seq.ok) {
    failed += seq.errors.length;
    for (const e of seq.errors) console.error(`FAIL sequence: ${e}`);
  }

  console.log(`\n${checked} record(s) checked, ${failed} failure(s). A passing record is a well-formed CLAIM; open its evidence links to verify it.`);
  return failed === 0 ? 0 : 1;
}

process.exit(main(process.argv.slice(2)));
