/** Read every flows/*.flyde and write src/data/techs.json. `npm run techs`. */
import { writeFileSync } from "node:fs";
import { loadFlowTechs } from "./techFlows";

const techs = loadFlowTechs();
const ids = new Set<string>();
for (const t of techs) {
  if (ids.has(t.id)) throw new Error(`duplicate tech id ${t.id}`);
  ids.add(t.id);
}
for (const t of techs) for (const p of t.prereqs) if (!ids.has(p)) throw new Error(`${t.id}: unknown prerequisite ${p}`);
writeFileSync("src/data/techs.json", JSON.stringify(techs, null, 2) + "\n");
console.log(`${techs.length} technologies written to src/data/techs.json`);
