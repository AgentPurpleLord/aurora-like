/**
 * Engine families and power systems.
 *
 * Specified in src/sim/research/propusion-power-techs.ts: six engine
 * families, stepped through in tiers, and four power-system families whose
 * reactors feed the electric drives. This file turns that specification into
 * the numbers the component designer uses; research/propulsion.ts turns it
 * into technologies.
 *
 * How the specification is read:
 *  - "Baseline Density" is thrust per hull space relative to a chemical
 *    rocket, which makes 12 power per hull space.
 *  - "Fuel Efficiency" is how many times further a litre goes than a
 *    chemical rocket's; across a family's tiers it rises geometrically from
 *    the low figure to the high one.
 *  - Electric drives (and nuclear electric, which is a nuclear-powered
 *    electric drive) draw power from reactors fitted to the ship.
 */

export interface EngineTier {
  id: string;
  name: string;
  /** Research points. */
  cost: number;
}

export interface EngineFamily {
  id: string;
  name: string;
  blurb: string;
  density: number;
  efficiency: [low: number, high: number];
  /** Reactor power drawn per hull space of engine at modifier 1.0. */
  powerDraw: number;
  costPerHS: number;
  crewPerHS: number;
  tiers: EngineTier[];
}

export const BASE_POWER_PER_HS = 12;
export const BASE_FUEL_PER_POWER = 5;

export const ENGINE_FAMILIES: EngineFamily[] = [
  {
    id: "chemical", name: "Chemical Rockets",
    blurb: "High thrust, poor fuel economy, low power-system requirements.",
    density: 1.0, efficiency: [1, 1], powerDraw: 0, costPerHS: 3, crewPerHS: 0.6,
    tiers: [
      { id: "solid-motor", name: "Solid Motor", cost: 2000 },
      { id: "pressure-fed", name: "Pressure-fed Liquid", cost: 4000 },
      { id: "pump-fed", name: "Pump-fed Liquid", cost: 8000 },
      { id: "staged-combustion", name: "Staged Combustion", cost: 16000 },
      { id: "full-flow", name: "Full-flow Staged Combustion", cost: 32000 },
    ],
  },
  {
    id: "electric", name: "Electric Drives",
    blurb: "Excellent fuel economy, low thrust, requires external power from a reactor.",
    density: 0.5, efficiency: [3, 10], powerDraw: 1.0, costPerHS: 6, crewPerHS: 0.7,
    tiers: [
      { id: "resistojet", name: "Resistojet", cost: 2000 },
      { id: "arcjet", name: "Arcjet", cost: 4000 },
      { id: "hall-thruster", name: "Hall Thruster", cost: 8000 },
      { id: "gridded-ion", name: "Gridded Ion", cost: 16000 },
      { id: "advanced-plasma", name: "Advanced Plasma Drive", cost: 32000 },
    ],
  },
  {
    id: "nuclear-thermal", name: "Nuclear Thermal",
    blurb: "High thrust, better fuel economy, heavy reactor, requires shielding.",
    density: 2.0, efficiency: [1.8, 3], powerDraw: 0, costPerHS: 8, crewPerHS: 0.8,
    tiers: [
      { id: "solid-core-fission", name: "Solid Core Fission", cost: 2000 },
      { id: "high-temp-core", name: "High Temperature Core", cost: 4000 },
      { id: "advanced-gas-core", name: "Advanced Gas Core", cost: 8000 },
      { id: "liquid-core", name: "Liquid Core", cost: 16000 },
    ],
  },
  {
    id: "nuclear-electric", name: "Nuclear Electric",
    blurb: "Moderate system power density, excellent fuel economy, requires shielding and reactor power.",
    density: 1.5, efficiency: [5, 15], powerDraw: 0.6, costPerHS: 10, crewPerHS: 0.9,
    tiers: [
      { id: "ne-fission", name: "Fission Reactor Drive", cost: 2000 },
      { id: "ne-adv-fission", name: "Advanced Fission Reactor Drive", cost: 4000 },
      { id: "ne-megawatt", name: "Megawatt Fission Reactor Drive", cost: 8000 },
      { id: "ne-adv-electric", name: "Advanced Electric Drive", cost: 16000 },
    ],
  },
  {
    id: "fusion", name: "Fusion",
    blurb: "High thrust, demanding heat and reactor engineering. Unlocks after Nuclear Electric.",
    density: 4.0, efficiency: [10, 30], powerDraw: 0, costPerHS: 18, crewPerHS: 1.0,
    tiers: [
      { id: "fusion-magnetic", name: "Magnetic Confinement Fusion", cost: 16000 },
      { id: "fusion-inertial", name: "Inertial Confinement Fusion", cost: 32000 },
      { id: "fusion-hybrid", name: "Fusion-Fission Hybrid", cost: 64000 },
      { id: "fusion-mtf", name: "Magnetic Target Fusion", cost: 128000 },
      { id: "fusion-direct", name: "Direct Fusion Drive", cost: 256000 },
    ],
  },
  {
    id: "antimatter", name: "Antimatter",
    blurb: "Endgame technology: extreme energy density, difficult fuel production and storage. Unlocks after Fusion.",
    density: 8.0, efficiency: [20, 50], powerDraw: 0, costPerHS: 40, crewPerHS: 1.2,
    tiers: [
      { id: "am-catalyst", name: "Antimatter Catalyst", cost: 256000 },
      { id: "am-ignition", name: "Antimatter Ignition", cost: 512000 },
      { id: "am-hybrid", name: "Hybrid Antimatter Drive", cost: 1024000 },
      { id: "am-pure", name: "Pure Antimatter Drive", cost: 2048000 },
    ],
  },
];

export interface EngineType {
  id: string;
  name: string;
  tech: string;
  family: string;
  tier: number;
  /** Engine power per hull space at modifier 1.0. */
  powerPerHS: number;
  /** Litres per power-hour at modifier 1.0, before fuel-efficiency research. */
  fuelPerPower: number;
  costPerHS: number;
  crewPerHS: number;
  /** Reactor power drawn per hull space at modifier 1.0. */
  powerDraw: number;
}

/** A family's fuel efficiency at a tier: geometric from the low figure to the high one. */
export function tierEfficiency(family: EngineFamily, tier: number): number {
  const [lo, hi] = family.efficiency;
  const n = family.tiers.length;
  return n <= 1 ? lo : lo * Math.pow(hi / lo, tier / (n - 1));
}

export const ENGINE_TYPES: EngineType[] = ENGINE_FAMILIES.flatMap((family) =>
  family.tiers.map((tier, i) => ({
    id: tier.id,
    name: `${family.name}: ${tier.name}`,
    tech: tier.id,
    family: family.id,
    tier: i + 1,
    powerPerHS: BASE_POWER_PER_HS * family.density,
    fuelPerPower: BASE_FUEL_PER_POWER / tierEfficiency(family, i),
    costPerHS: Math.round(family.costPerHS * (1 + 0.15 * i) * 10) / 10,
    crewPerHS: family.crewPerHS,
    powerDraw: family.powerDraw,
  })),
);

// ------------------------------------------------------------ power systems

export interface PowerTier {
  id: string;
  name: string;
  cost: number;
  /** Power output per hull space of reactor. */
  output: number;
}

export interface PowerFamily {
  id: string;
  name: string;
  costPerHS: number;
  crewPerHS: number;
  tiers: PowerTier[];
}

export const POWER_FAMILIES: PowerFamily[] = [
  {
    id: "chemical", name: "Chemical", costPerHS: 2, crewPerHS: 0.3,
    tiers: [
      { id: "fuel-cell-1", name: "Solid Fuel Cell", cost: 600, output: 2 },
      { id: "fuel-cell-2", name: "Liquid Fuel Cell", cost: 1200, output: 2.5 },
      { id: "fuel-cell-3", name: "Advanced Fuel Cell", cost: 2400, output: 3.2 },
      { id: "fuel-cell-4", name: "High Efficiency Fuel Cell", cost: 4800, output: 4 },
    ],
  },
  {
    id: "nuclear", name: "Nuclear", costPerHS: 6, crewPerHS: 0.4,
    tiers: [
      { id: "reactor-nuclear-1", name: "Fission Reactor", cost: 9600, output: 5 },
      { id: "reactor-nuclear-2", name: "Advanced Fission Reactor", cost: 19200, output: 6.4 },
      { id: "reactor-nuclear-3", name: "Megawatt Fission Reactor", cost: 38400, output: 8 },
      { id: "reactor-nuclear-4", name: "Advanced Electric Drive Reactor", cost: 76800, output: 12.8 },
    ],
  },
  {
    id: "fusion", name: "Fusion", costPerHS: 14, crewPerHS: 0.5,
    tiers: [
      { id: "reactor-fusion-1", name: "Magnetic Confinement Fusion Reactor", cost: 153600, output: 16 },
      { id: "reactor-fusion-2", name: "Inertial Confinement Fusion Reactor", cost: 307200, output: 20 },
      { id: "reactor-fusion-3", name: "Fusion-Fission Hybrid Reactor", cost: 614400, output: 25 },
      { id: "reactor-fusion-4", name: "Magnetic Target Fusion Reactor", cost: 1228800, output: 32 },
    ],
  },
  {
    id: "antimatter", name: "Antimatter", costPerHS: 30, crewPerHS: 0.6,
    tiers: [
      { id: "reactor-am-1", name: "Antimatter Catalyst Reactor", cost: 2457600, output: 40 },
    ],
  },
];

export interface ReactorType {
  id: string;
  name: string;
  tech: string;
  family: string;
  output: number;
  costPerHS: number;
  crewPerHS: number;
}

export const REACTOR_TYPES: ReactorType[] = POWER_FAMILIES.flatMap((family) =>
  family.tiers.map((tier) => ({
    id: tier.id,
    name: `${family.name}: ${tier.name}`,
    tech: tier.id,
    family: family.id,
    output: tier.output,
    costPerHS: family.costPerHS,
    crewPerHS: family.crewPerHS,
  })),
);
