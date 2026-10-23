# Editing the tech tree visually (Flyde)

The tree is authored as [Flyde](https://www.flyde.dev) flows, one per research field:

    flows/construction.flyde   flows/power.flyde    flows/sensors.flyde   flows/defence.flyde
    flows/energy.flyde         flows/missiles.flyde flows/logistics.flyde flows/biology.flyde

Each technology is a **Technology** node (`flows/nodes/Tech.flyde.ts`). A wire from one node's
`unlocks` pin to another's `requires` pin means "needs". Select a node to edit its id, name, field,
sub-field, cost, effects and description. Layout (position on the canvas) is yours to arrange.

## Workflow

1. Install the Flyde VS Code extension (recommended in `.vscode/extensions.json`) and open a `.flyde` file.
2. Add / wire / edit nodes (right-click the canvas -> *Technology*).
3. `npm run techs` - reads every `flows/*.flyde` and rewrites `src/data/techs.json`. It fails on duplicate ids,
   unknown prerequisites or malformed effect lines. The game imports that JSON.
4. `npm run check` - confirms flows and JSON agree and that every tech id the parts refer to exists.

`src/data/techs.json` is generated: edit the flows, not the JSON.

## Fields of a Technology node

| Field | Meaning |
| --- | --- |
| Id | Unique. Ladders, engines and reactors in code refer to techs by id. |
| Field | One of the eight research fields. Flows are only a convenience: the field is read from the node. |
| Sub-field | Heading in the Research screen. A new one should be added to `FIELD_BRANCHES` in `src/sim/research/branches.ts`. |
| Effects | One per line: `miningRate = 12`, `tradeBonus += 0.05`, `unlock mine`. Stat names are the numeric stats of `EmpireStats` in `src/sim/research/techs.ts`. |
| Prereqs in other fields | Comma separated ids; a wire cannot cross flow files. |
| Future tech | Researchable, but does nothing yet. |

## What still needs code

* A **new effect stat** (a number the sim reads) is added to `EmpireStats`/`baseStats` and used where it matters.
* A new **engine** or **reactor** tier, or a new component ladder step, is defined in `src/sim/ships/` and tied to a tech id.
  The tech itself (cost, prerequisites, name) is made in a flow.
* A new **installation** named in `unlock` must exist in the installation catalogue.

## Caveats

The Flyde editor could not be run where this was built; the flows were validated against Flyde's own schema and
loader (`@flyde/core`, `@flyde/loader`) but not opened in the editor. `npm run techs:flows` regenerates the flows
from the JSON (it overwrites them, including layout). Flows are never executed - only read.
