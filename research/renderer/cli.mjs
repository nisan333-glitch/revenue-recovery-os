#!/usr/bin/env node
// NH JSON->Markdown renderer — CLI entry (Mission #009).
//   node research/renderer/cli.mjs <dataset.json>
// exit 0 = rendered · 2 = load/parse failure. Read-only w.r.t. the input.
import { loadDataset } from "../validator/load.mjs";
import { renderMissionCharter, renderResearchRecord } from "./render.mjs";

function main(argv) {
  const args = argv.slice(2);
  const path = args.find((a) => !a.startsWith("--"));
  if (!path) {
    process.stderr.write("usage: node research/renderer/cli.mjs <dataset.json>\n");
    return 2;
  }
  let dataset;
  try {
    dataset = loadDataset(path);
  } catch (e) {
    process.stderr.write(`load/parse error: ${e.message}\n`);
    return 2;
  }
  process.stdout.write(renderMissionCharter(dataset) + "\n" + renderResearchRecord(dataset));
  return 0;
}

process.exit(main(process.argv));
