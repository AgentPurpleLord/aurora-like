# Tech tree templates

How to hand me a technology tree. Copy `TEMPLATE-field.ts`, fill it in as a comment outline (one
block per tech), and drop it anywhere in the repo (for example next to your other
`*-techs.ts` files). I turn it into real entries in `src/sim/research/`.

Nothing in these files is compiled or run; they are notes in a fixed shape so I do not have to
guess. If you leave something out I will pick a sensible default and say so.

## The shape of one tech

```
// [engine-fusion-1] Magnetic Confinement Fusion Drive
//   field: power
//   cost: 20000
//   requires: magneto-plasma, reactor-fusion-1
//   effect: engine { power/HS 85, fuel/power 2.7, cost/HS 20, crew/HS 1.0 }
//   text: Fusion thrust contained in magnetic bottles.
```

* **[id]** - lower-case, dashes, unique across the whole game. Existing ids are in
  `src/sim/research/techs.ts` and `techsExtended.ts`; reuse one to replace a tech, invent new ones
  freely.
* **Name** - what the player sees.
* **field** - one of `construction`, `power`, `sensors`, `defence`, `energy`, `missiles`, `biology`,
  `logistics`.
* **cost** - research points. For scale: the first techs cost 1,000-3,000 RP, an early laboratory
  makes 200-250 RP a year, mid-game techs run 10,000-60,000 and the end of a line 150,000-500,000.
* **requires** - ids that must be researched first (a comma list, or `none`).
* **effect** - one or more, separated by `;` (see below). Leave out for a tech that only gates others.
* **text** - one or two sentences for the technology screen.
* **future** - add `future: yes` for a tech that has no effect in the game yet (weapons, armour,
  shields...). It is listed and researchable but marked "future".

Group techs under comment headings and use blank lines freely. Order does not matter, only
`requires` does.

## Effects I can wire up today

| Write this | What it does |
| --- | --- |
| `set <stat> <value>` | Raise a stat to the value (the highest researched wins). |
| `add <stat> <value>` | Add to a stat; every researched tech that adds, stacks. |
| `unlock installation <id>` | Makes an installation buildable. |
| `engine { ... }` | A new engine type for the component designer (see below). |
| `ladder <name> <value>` | Part improvement that applies to every ship, new and old (see below). |
| `sensor { ... }` | A new survey sensor type (rare; ask first). |
| `note: ...` | A behaviour you want that does not exist yet. I will tell you what it would take. |

### Stats (`set` / `add`)

| Stat | Base | Meaning |
| --- | --- | --- |
| `miningRate` | 10 | Tons per mine per year |
| `constructionRate` | 10 | Build points per factory per year |
| `researchRate` | 200 | RP per laboratory per year |
| `fuelPerRefinery` | 40000 | Litres per refinery per year |
| `ordnanceRate` | 10 | Ordnance points per factory per year |
| `massDriverThroughput` | 0 | Tons per mass driver per year |
| `serviceTonsPerFacility` | 4000 | Tons of ship a maintenance facility services |
| `terraformRate` | 0 | Atmospheres per terraformer per year |
| `popGrowthBonus` | 0 | Added to population growth (0.1 = +10%) |
| `colonyCostReduction` | 0 | Taken off every world's colony cost |
| `infrastructureEfficiency` | 1 | Colonists per infrastructure, relative |
| `wealthBonus` | 0 | Tax revenue multiplier bonus (0.1 = +10%) |
| `tradeBonus` | 0 | Commerce income and trade levy bonus |
| `stabilityBonus` | 0 | Points added to every colony's stability |
| `capitalBonus` | 0 | Political capital per year |
| `policySlots` | 3 | Laws in force at once |
| `academyOutput` | 2 | Officers per academy per year |
| `farmOutput` | 100 | Food per hydroponic farm per year |
| `consumerOutput` | 100 | Consumer goods per plant per year |
| `luxuryOutput` | 40 | Luxuries per workshop per year |
| `freightFlow` | 1 | Multiplier on freight line and civilian shipping capacity |

### Installations (`unlock installation`)

Always available: `infrastructure`, `mine`, `automated-mine`, `construction-factory`,
`fuel-refinery`, `research-lab`, `shipyard`. Others: `ordnance-factory`, `maintenance`,
`mass-driver`, `spaceport`, `terraforming`, `dstn`, `financial-centre`, `military-academy`,
`sector-command`, `gftf`, `hydroponic-farm`, `consumer-plant`, `luxury-workshop`. A brand new
installation needs a name, cost, minerals and what it does - give me a block like:

```
// installation [fusion-reactor-plant] Fusion Reactor Plant
//   cost: 1200 BP; minerals: Duranium 600, Mercassium 600; workers: 0.05 (millions)
//   does: ...
```

### Engines and reactors

Engines are one line of technologies, each simply more power per hull space (`src/sim/ships/engines.ts`,
`ENGINE_LINE`): give me the name, power per hull space, research cost and sub-field. Speed is
`engine power / total hull spaces x 1000` km/s. Power systems (reactors) are families of tiers with an
output per hull space (`POWER_FAMILIES`).

### Part ladders (`ladder`)

Each takes a multiplier (or a value) and applies from the moment the tech is researched:

`powerModifierCeiling` (engine overdrive limit), `fuelUse` (multiplier on fuel burned, below 1 is
better), `engineSize` (largest single engine in hull spaces), `miniaturisation` (fraction of its
hull space an engine takes), `tankCapacity`, `quartersBerths`, `cargoCapacity`, `colonistCapacity`,
`geoSurveyRate`, `gravSurveyRate`, `jumpCapacity`, `gateRate`.

Example: `effect: ladder tankCapacity 1.25`.

## Reactors and other things the game does not have yet

If your outline has a concept the game has no home for (reactors that power weapons, shield
generators, ship power budgets), write it anyway with `note:` describing what it should do. I
will wire what I can, add the rest as `future`, and tell you which was which.

## Files

* `TEMPLATE-field.ts` - blank outline to copy.
* `EXAMPLE-propulsion.ts` - a short filled-in example (nothing like a complete tree).

> **Tech tree:** edit it visually with Flyde - see [docs/flyde-tech-tree.md](docs/flyde-tech-tree.md). The old comment-template workflow in `docs/tech-templates/` still works for handing me trees.
