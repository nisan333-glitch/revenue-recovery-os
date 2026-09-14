import { mkdir, writeFile } from "node:fs/promises";
import { syntheticCsv } from "../server/agents/fixtures/activation.synthetic";

const output = "server/agents/fixtures/activation.synthetic.csv";
await mkdir("server/agents/fixtures", { recursive: true });
await writeFile(output, syntheticCsv(), { encoding: "utf8", flag: "w", mode: 0o600 });
console.log(`wrote SYNTHETIC fixture: ${output}`);
