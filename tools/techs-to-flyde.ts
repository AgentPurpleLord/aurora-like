/** One-off: write flows/<field>.flyde from src/data/techs.json. `npm run techs:flows` (overwrites the flows!). */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { techsToFlow } from "./techFlows";
import type { Tech } from "../src/sim/research/techs";

const techs: Tech[] = JSON.parse(readFileSync("src/data/techs.json", "utf8"));
mkdirSync("flows", { recursive: true });
for (const field of [...new Set(techs.map((t) => t.field))]) {
  writeFileSync(`flows/${field}.flyde`, techsToFlow(field, techs));
  console.log(`flows/${field}.flyde`);
}
