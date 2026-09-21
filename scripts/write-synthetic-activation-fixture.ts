import { chmod, mkdir, writeFile } from "node:fs/promises";
import { syntheticCsv, syntheticExpectedResults, syntheticRecords } from "../server/agents/fixtures/activation.synthetic";

const directory = "server/agents/fixtures";
const outputs = [
  ["activation.synthetic.csv", syntheticCsv()],
  ["activation.well-formed.synthetic.csv", syntheticCsv(syntheticRecords().slice(0, 95))],
  ["activation.synthetic.expected-results.json", `${JSON.stringify(await syntheticExpectedResults(), null, 2)}\n`],
] as const;
await mkdir(directory, { recursive: true });
for (const [name, content] of outputs) {
  const output = `${directory}/${name}`;
  await writeFile(output, content, { encoding: "utf8", flag: "w", mode: 0o600 });
  await chmod(output, 0o600);
  console.log(`wrote SYNTHETIC fixture artifact: ${output}`);
}
