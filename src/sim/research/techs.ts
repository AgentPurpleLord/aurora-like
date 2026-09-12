/**
 * The technology tree.
 *
 * A tech is available once every prerequisite is researched. Effects are
 * declarative so that the empire's working figures can always be recomputed
 * from the set of researched techs alone - there is no incremental state to
 * drift out of sync.
 *
 * Techs marked `future` are real research targets with no mechanical effect
 * yet; they gate ship design, surveying and combat, which are not built.
 */

import type { ResearchField } from "./fields";

export interface EmpireStats {
  /** Tons per mine per year at accessibility 1.0. */
  miningRate: number;
  /** Build points per construction factory per year. */
  constructionRate: number;
  /** Research points per laboratory per year. */
  researchRate: number;
  /** Litres of fuel per refinery per year. */
  fuelPerRefinery: number;
  /** Ordnance build points per ordnance factory per year. */
  ordnanceRate: number;
  /** Tons per mass driver per year. */
  massDriverThroughput: number;
  /** Colony cost removed per terraforming installation per year. */
  terraformRate: number;
  /** Added to the base population growth rate as a multiplier. */
  popGrowthBonus: number;
  /** Subtracted from every body's colony cost. */
  colonyCostReduction: number;
  /** How many colonists one unit of infrastructure supports, relative to base. */
  infrastructureEfficiency: number;
  /** Added to wealth income as a multiplier. */
  wealthBonus: number;
  unlocked: Set<string>;
}

export type TechEffect =
  /** Raise a stat to `value` - the highest researched tech wins. */
  | { kind: "set"; stat: NumericStat; value: number }
  /** Accumulate across every researched tech that grants it. */
  | { kind: "add"; stat: NumericStat; value: number }
  | { kind: "unlock"; installation: string };

type NumericStat = {
  [K in keyof EmpireStats]: EmpireStats[K] extends number ? K : never;
}[keyof EmpireStats];

export interface Tech {
  id: string;
  name: string;
  field: ResearchField;
  /** Research points required. */
  cost: number;
  prereqs: string[];
  effects?: TechEffect[];
  description: string;
  /** True when the tech only matters to systems that are not built yet. */
  future?: boolean;
}

const set = (stat: NumericStat, value: number): TechEffect => ({ kind: "set", stat, value });
const add = (stat: NumericStat, value: number): TechEffect => ({ kind: "add", stat, value });
const unlock = (installation: string): TechEffect => ({ kind: "unlock", installation });

export const TECHS: Tech[] = [
  // ------------------------------------------- construction and production
  {
    id: "trans-newtonian", name: "Trans-Newtonian Technology", field: "construction",
    cost: 2500, prereqs: [],
    description: "The foundation of the age: trans-Newtonian elements can be refined and worked, and every installation and drive that follows depends on it.",
  },
  {
    id: "mining-12", name: "Mining Production 12 Tons", field: "construction",
    cost: 1500, prereqs: ["trans-newtonian"], effects: [set("miningRate", 12)],
    description: "Each mine extracts 12 tons per year from a deposit of accessibility 1.0.",
  },
  {
    id: "mining-15", name: "Mining Production 15 Tons", field: "construction",
    cost: 3000, prereqs: ["mining-12"], effects: [set("miningRate", 15)],
    description: "Each mine extracts 15 tons per year from a deposit of accessibility 1.0.",
  },
  {
    id: "mining-18", name: "Mining Production 18 Tons", field: "construction",
    cost: 6000, prereqs: ["mining-15"], effects: [set("miningRate", 18)],
    description: "Each mine extracts 18 tons per year from a deposit of accessibility 1.0.",
  },
  {
    id: "mining-21", name: "Mining Production 21 Tons", field: "construction",
    cost: 12000, prereqs: ["mining-18"], effects: [set("miningRate", 21)],
    description: "Each mine extracts 21 tons per year from a deposit of accessibility 1.0.",
  },
  {
    id: "construction-12", name: "Construction Rate 12 BP", field: "construction",
    cost: 1500, prereqs: ["trans-newtonian"], effects: [set("constructionRate", 12)],
    description: "Each construction factory produces 12 build points per year.",
  },
  {
    id: "construction-15", name: "Construction Rate 15 BP", field: "construction",
    cost: 3000, prereqs: ["construction-12"], effects: [set("constructionRate", 15)],
    description: "Each construction factory produces 15 build points per year.",
  },
  {
    id: "construction-18", name: "Construction Rate 18 BP", field: "construction",
    cost: 6000, prereqs: ["construction-15"], effects: [set("constructionRate", 18)],
    description: "Each construction factory produces 18 build points per year.",
  },
  {
    id: "construction-21", name: "Construction Rate 21 BP", field: "construction",
    cost: 12000, prereqs: ["construction-18"], effects: [set("constructionRate", 21)],
    description: "Each construction factory produces 21 build points per year.",
  },
  {
    id: "research-250", name: "Research Rate 250 RP", field: "construction",
    cost: 2000, prereqs: ["trans-newtonian"], effects: [set("researchRate", 250)],
    description: "Each research laboratory generates 250 research points per year.",
  },
  {
    id: "research-300", name: "Research Rate 300 RP", field: "construction",
    cost: 4000, prereqs: ["research-250"], effects: [set("researchRate", 300)],
    description: "Each research laboratory generates 300 research points per year.",
  },
  {
    id: "research-350", name: "Research Rate 350 RP", field: "construction",
    cost: 8000, prereqs: ["research-300"], effects: [set("researchRate", 350)],
    description: "Each research laboratory generates 350 research points per year.",
  },
  {
    id: "research-400", name: "Research Rate 400 RP", field: "construction",
    cost: 16000, prereqs: ["research-350"], effects: [set("researchRate", 400)],
    description: "Each research laboratory generates 400 research points per year.",
  },
  {
    id: "fuel-60k", name: "Fuel Production 60,000 Litres", field: "construction",
    cost: 2500, prereqs: ["trans-newtonian"], effects: [set("fuelPerRefinery", 60000)],
    description: "Each refinery converts Sorium into 60,000 litres of fuel per year.",
  },
  {
    id: "fuel-80k", name: "Fuel Production 80,000 Litres", field: "construction",
    cost: 5000, prereqs: ["fuel-60k"], effects: [set("fuelPerRefinery", 80000)],
    description: "Each refinery converts Sorium into 80,000 litres of fuel per year.",
  },
  {
    id: "maintenance-facilities", name: "Maintenance Facility Construction", field: "construction",
    cost: 1500, prereqs: ["trans-newtonian"], effects: [unlock("maintenance")],
    description: "Orbital maintenance bays that hold off the failure rate of ships stationed at a colony.",
  },
  {
    id: "ordnance-factories", name: "Ordnance Factory Construction", field: "construction",
    cost: 2000, prereqs: ["trans-newtonian"], effects: [unlock("ordnance-factory")],
    description: "Dedicated plant for missiles and other ordnance.",
  },
  {
    id: "mass-drivers", name: "Mass Driver Technology", field: "construction",
    cost: 3000, prereqs: ["trans-newtonian"],
    effects: [unlock("mass-driver"), set("massDriverThroughput", 1000)],
    description: "Magnetic launchers throw mineral packets between colonies at 1,000 tons per driver per year - the only way to move minerals before freighters exist.",
  },
  {
    id: "mass-drivers-2", name: "Improved Mass Drivers", field: "construction",
    cost: 7000, prereqs: ["mass-drivers"], effects: [set("massDriverThroughput", 2500)],
    description: "Heavier launch packages: 2,500 tons per driver per year.",
  },
  {
    id: "spaceports", name: "Spaceport Construction", field: "construction",
    cost: 4000, prereqs: ["trans-newtonian"], effects: [unlock("spaceport")],
    description: "Ground facilities that speed cargo handling at a colony.",
  },
  {
    id: "terraforming", name: "Terraforming Technology", field: "construction",
    cost: 5000, prereqs: ["trans-newtonian"],
    effects: [unlock("terraforming"), set("terraformRate", 0.02)],
    description: "Atmospheric processors that reduce a world's colony cost by 0.02 per installation per year.",
  },
  {
    id: "terraforming-2", name: "Improved Terraforming", field: "construction",
    cost: 11000, prereqs: ["terraforming"], effects: [set("terraformRate", 0.04)],
    description: "Higher-throughput processors: 0.04 colony cost per installation per year.",
  },
  {
    id: "financial-management", name: "Financial Management", field: "construction",
    cost: 4000, prereqs: ["trans-newtonian"],
    effects: [unlock("financial-centre"), add("wealthBonus", 0.1)],
    description: "Financial centres, and a 10% increase in tax revenue.",
  },
  {
    id: "sector-command", name: "Sector Command Infrastructure", field: "construction",
    cost: 8000, prereqs: ["financial-management"], effects: [unlock("sector-command")],
    description: "Regional administration, letting a governor's bonuses reach colonies across a sector.",
  },

  // ------------------------------------------------------ power and propulsion
  {
    id: "nuclear-thermal", name: "Nuclear Thermal Engine Technology", field: "power",
    cost: 1000, prereqs: ["trans-newtonian"], future: true,
    description: "The first trans-Newtonian drive. Enables nuclear thermal engines in ship design.",
  },
  {
    id: "nuclear-pulse", name: "Nuclear Pulse Engine Technology", field: "power",
    cost: 2500, prereqs: ["nuclear-thermal"], future: true,
    description: "Roughly twice the power per unit of engine volume.",
  },
  {
    id: "ion-drive", name: "Ion Drive Technology", field: "power",
    cost: 5000, prereqs: ["nuclear-pulse"], future: true,
    description: "The workhorse drive of the early expansion era.",
  },
  {
    id: "magneto-plasma", name: "Magneto-Plasma Drive Technology", field: "power",
    cost: 10000, prereqs: ["ion-drive"], future: true,
    description: "High-output drive suitable for warships of the line.",
  },
  {
    id: "engine-power-125", name: "Engine Power Modifier x1.25", field: "power",
    cost: 2500, prereqs: ["nuclear-thermal"], future: true,
    description: "Engines may be tuned 25% above their rated output, at a cost in fuel efficiency.",
  },
  {
    id: "fuel-consumption-08", name: "Fuel Consumption 0.8 Litres/Power Hour", field: "power",
    cost: 2000, prereqs: ["nuclear-thermal"], future: true,
    description: "A 20% reduction in engine fuel consumption.",
  },
  {
    id: "jump-point-theory", name: "Jump Point Theory", field: "power",
    cost: 7500, prereqs: ["ion-drive"], future: true,
    description: "The mathematics of jump points. Required before a ship can survey one, let alone transit it.",
  },

  // -------------------------------------------------- sensors and fire control
  {
    id: "geo-survey-sensors", name: "Geological Survey Sensors", field: "sensors",
    cost: 1500, prereqs: ["trans-newtonian"], future: true,
    description: "Shipboard sensors that survey a body's mineral deposits from orbit.",
  },
  {
    id: "grav-survey-sensors", name: "Gravitational Survey Sensors", field: "sensors",
    cost: 2000, prereqs: ["trans-newtonian"], future: true,
    description: "Detects the gravitational anomalies that mark a jump point.",
  },
  {
    id: "deep-space-tracking", name: "Deep Space Tracking Station", field: "sensors",
    cost: 3000, prereqs: ["trans-newtonian"], effects: [unlock("dstn")],
    description: "Ground stations giving passive sensor coverage across the system.",
  },
  {
    id: "active-sensor-12", name: "Active Grav Sensor Strength 12", field: "sensors",
    cost: 2000, prereqs: ["trans-newtonian"], future: true,
    description: "Improves the range of active search sensors.",
  },
  {
    id: "thermal-sensor-6", name: "Thermal Sensor Sensitivity 6", field: "sensors",
    cost: 2000, prereqs: ["trans-newtonian"], future: true,
    description: "Passive detection of drive plumes at longer range.",
  },
  {
    id: "fire-control-16k", name: "Fire Control Range 16,000 km", field: "sensors",
    cost: 2500, prereqs: ["trans-newtonian"], future: true,
    description: "Longer-ranged beam fire control systems.",
  },

  // ---------------------------------------------------------- defensive systems
  {
    id: "composite-armour", name: "Composite Armour", field: "defence",
    cost: 3000, prereqs: ["trans-newtonian"], future: true,
    description: "Second-generation armour, 50% tougher per layer than duranium plate.",
  },
  {
    id: "alpha-shields", name: "Alpha Shields", field: "defence",
    cost: 4000, prereqs: ["trans-newtonian"], future: true,
    description: "The first practical deflector shields.",
  },
  {
    id: "damage-control-2", name: "Damage Control Rating 2", field: "defence",
    cost: 2000, prereqs: ["trans-newtonian"], future: true,
    description: "Improved shipboard repair.",
  },

  // -------------------------------------------------------------- energy weapons
  {
    id: "laser-10cm", name: "10cm Infrared Laser", field: "energy",
    cost: 3000, prereqs: ["trans-newtonian"], future: true,
    description: "The first trans-Newtonian beam weapon.",
  },
  {
    id: "railgun-10cm", name: "10cm Railgun", field: "energy",
    cost: 3000, prereqs: ["trans-newtonian"], future: true,
    description: "Kinetic cannon firing four shots per salvo.",
  },
  {
    id: "capacitor-2", name: "Capacitor Recharge Rate 2", field: "energy",
    cost: 2500, prereqs: ["trans-newtonian"], future: true,
    description: "Beam weapons recharge twice as quickly.",
  },
  {
    id: "turrets", name: "Weapon Turret Technology", field: "energy",
    cost: 4000, prereqs: ["laser-10cm"], future: true,
    description: "Gimballed mounts, allowing beam weapons to track fast targets.",
  },

  // --------------------------------------------------- missiles and kinetic weapons
  {
    id: "missile-launcher-1", name: "Size 1 Missile Launcher", field: "missiles",
    cost: 2000, prereqs: ["trans-newtonian"], future: true,
    description: "The smallest practical launcher.",
  },
  {
    id: "warhead-3", name: "Warhead Strength 3", field: "missiles",
    cost: 2500, prereqs: ["trans-newtonian"], future: true,
    description: "Denser trans-Newtonian warheads.",
  },
  {
    id: "missile-agility-32", name: "Missile Agility 32", field: "missiles",
    cost: 2500, prereqs: ["trans-newtonian"], future: true,
    description: "Missiles that can chase a manoeuvring target.",
  },

  // -------------------------------------------------------- biology and genetics
  {
    id: "medical-1", name: "Medical Advances: Growth +10%", field: "biology",
    cost: 3000, prereqs: ["trans-newtonian"], effects: [add("popGrowthBonus", 0.1)],
    description: "Population growth rises by 10%.",
  },
  {
    id: "medical-2", name: "Medical Advances: Growth +20%", field: "biology",
    cost: 7000, prereqs: ["medical-1"], effects: [add("popGrowthBonus", 0.1)],
    description: "Population growth rises by a further 10%.",
  },
  {
    id: "genome-1", name: "Genome Adjustment: Colony Cost -0.20", field: "biology",
    cost: 5000, prereqs: ["trans-newtonian"], effects: [add("colonyCostReduction", 0.2)],
    description: "Tailored colonists tolerate a wider environment, cutting colony cost everywhere by 0.20.",
  },
  {
    id: "genome-2", name: "Genome Adjustment: Colony Cost -0.40", field: "biology",
    cost: 12000, prereqs: ["genome-1"], effects: [add("colonyCostReduction", 0.2)],
    description: "A further 0.20 off colony cost on every world.",
  },
  {
    id: "modular-infrastructure", name: "Modular Infrastructure", field: "biology",
    cost: 4000, prereqs: ["trans-newtonian"], effects: [set("infrastructureEfficiency", 1.25)],
    description: "Each unit of infrastructure supports 25% more colonists.",
  },

  // ---------------------------------------------------- logistics and ground combat
  {
    id: "military-academies", name: "Military Academy Construction", field: "logistics",
    cost: 3000, prereqs: ["trans-newtonian"], effects: [unlock("military-academy")],
    description: "Academies train new officers, raising the rate at which commanders enter the pool.",
  },
  {
    id: "ground-training", name: "Ground Force Training Facility", field: "logistics",
    cost: 3000, prereqs: ["trans-newtonian"], effects: [unlock("gftf")],
    description: "Raises and trains ground formations.",
  },
  {
    id: "cargo-handling", name: "Improved Cargo Handling Systems", field: "logistics",
    cost: 2500, prereqs: ["trans-newtonian"], future: true,
    description: "Halves the time a freighter spends loading and unloading.",
  },
];

export const TECH_BY_ID = new Map(TECHS.map((t) => [t.id, t]));

export function baseStats(): EmpireStats {
  return {
    miningRate: 10,
    constructionRate: 10,
    researchRate: 200,
    fuelPerRefinery: 40000,
    ordnanceRate: 10,
    massDriverThroughput: 0,
    terraformRate: 0,
    popGrowthBonus: 0,
    colonyCostReduction: 0,
    infrastructureEfficiency: 1,
    wealthBonus: 0,
    unlocked: new Set<string>([
      "infrastructure",
      "mine",
      "automated-mine",
      "construction-factory",
      "fuel-refinery",
      "research-lab",
    ]),
  };
}

/** Recompute every working figure from the set of researched techs. */
export function statsFor(researched: Iterable<string>): EmpireStats {
  const stats = baseStats();
  for (const id of researched) {
    const tech = TECH_BY_ID.get(id);
    if (!tech?.effects) continue;
    for (const effect of tech.effects) {
      if (effect.kind === "unlock") stats.unlocked.add(effect.installation);
      else if (effect.kind === "set") {
        stats[effect.stat] = Math.max(stats[effect.stat], effect.value);
      } else {
        stats[effect.stat] += effect.value;
      }
    }
  }
  return stats;
}

/** Techs whose prerequisites are all researched and which are not yet known. */
export function availableTechs(researched: ReadonlySet<string>): Tech[] {
  return TECHS.filter(
    (t) => !researched.has(t.id) && t.prereqs.every((p) => researched.has(p)),
  );
}
