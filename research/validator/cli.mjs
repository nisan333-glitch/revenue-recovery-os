#!/usr/bin/env node
// NH Validator Stage A — CLI entry.
//   node research/validator/cli.mjs <dataset.json> [--json]
// exit 0 = clean/warnings-only · 1 = >=1 blocking ERROR · 2 = load/parse failure.
import { loadDataset } from "./load.mjs";
import { validateDataset } from "./validate.mjs";
import { humanReport, machineReport } from "./report.mjs";

function main(argv) {
  const args = argv.slice(2);
  const jsonOut = args.includes("--json");
  const path = args.find((a) => !a.startsWith("--"));
  if (!path) {
    process.stderr.write("usage: node research/validator/cli.mjs <dataset.json> [--json]\n");
    return 2;
  }
  let dataset;
  try {
    dataset = loadDataset(path);
  } catch (e) {
    process.stderr.write(`load/parse error: ${e.message}\n`);
    return 2;
  }
  const result = validateDataset(dataset);
  process.stdout.write((jsonOut ? machineReport(result) : humanReport(result)) + "\n");
  return result.exit;
}

process.exit(main(process.argv));
