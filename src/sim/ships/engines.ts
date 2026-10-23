/**
 * Engines and power systems.
 *
 * Engines follow Aurora: a single line of technologies, each more power per
 * hull space (research/propulsion.ts turns it into technologies). Power
 * systems (reactors) come from src/sim/research/propusion-power-techs.ts;
 * nothing aboard draws on them yet, so they wait for weapons and shields.
 */

export interface EngineTech {
  id: string;
  name: string;
  /** Power per hull space - what the research buys, as in Aurora. */
  power: number;
  /** Research points. */
  cost: number;
  /** Sub-field on the research screen. */
  branch: string;
}

export const BASE_FUEL_PER_POWER = 40;

/**
 * Engines, as Aurora has them: one line of technologies, each simply more
 * power per hull space. Ship speed is then
 *
 *   speed (km/s) = total engine power / total ship hull spaces x 1000
 *
 * (1 hull space = 50 tons), so a ship is as fast as the share of it that is
 * engine, and a better engine makes the same share faster.
 */
export const ENGINE_LINE: EngineTech[] = [
  { id: "conventional-engine", name: "Conventional Engine", power: 0.2, cost: 1000, branch: "Conventional & Nuclear" },
  { id: "nuclear-thermal", name: "Nuclear Thermal Engine", power: 5, cost: 2500, branch: "Conventional & Nuclear" },
  { id: "improved-nuclear-thermal", name: "Improved Nuclear Thermal Engine", power: 6.4, cost: 4000, branch: "Conventional & Nuclear" },
  { id: "nuclear-pulse", name: "Nuclear Pulse Engine", power: 8, cost: 7500, branch: "Conventional & Nuclear" },
  { id: "improved-nuclear-pulse", name: "Improved Nuclear Pulse Engine", power: 10, cost: 12000, branch: "Conventional & Nuclear" },
  { id: "ion-engine", name: "Ion Engine", power: 12.5, cost: 20000, branch: "Ion & Fusion" },
  { id: "magneto-plasma", name: "Magneto-Plasma Drive", power: 16, cost: 35000, branch: "Ion & Fusion" },
  { id: "internal-fusion", name: "Internal Confinement Fusion Drive", power: 20, cost: 60000, branch: "Ion & Fusion" },
  { id: "magnetic-fusion", name: "Magnetic Confinement Fusion Drive", power: 25, cost: 100000, branch: "Ion & Fusion" },
  { id: "inertial-fusion", name: "Inertial Confinement Fusion Drive", power: 32, cost: 160000, branch: "Ion & Fusion" },
  { id: "solid-antimatter", name: "Solid Core Anti-matter Drive", power: 40, cost: 260000, branch: "Antimatter & Photonic" },
  { id: "gas-antimatter", name: "Gas Core Anti-matter Drive", power: 50, cost: 420000, branch: "Antimatter & Photonic" },
  { id: "plasma-antimatter", name: "Plasma Core Anti-matter Drive", power: 60, cost: 680000, branch: "Antimatter & Photonic" },
  { id: "beam-antimatter", name: "Beam Core Anti-matter Drive", power: 80, cost: 1100000, branch: "Antimatter & Photonic" },
  { id: "photonic-drive", name: "Photonic Drive", power: 100, cost: 1800000, branch: "Antimatter & Photonic" },
];

export interface EngineType {
  id: string;
  name: string;
  tech: string;
  tier: number;
  /** Engine power per hull space at modifier 1.0. */
  powerPerHS: number;
  /** Litres per power-hour at modifier 1.0, before fuel-efficiency research. */
  fuelPerPower: number;
  costPerHS: number;
  crewPerHS: number;
  /** Reactor power drawn per hull space. No engine needs a reactor now; see the Reactor component. */
  powerDraw: number;
}

/**
 * Newer engines are thriftier as well as stronger: litres per power-hour
 * falls from 60 for a conventional engine to 3 for a photonic drive.
 */
const FUEL_BY_TIER = [60, 40, 36, 32, 28, 20, 16, 14, 12, 10, 8, 6, 5, 4, 3];

export const ENGINE_TYPES: EngineType[] = ENGINE_LINE.map((tech, i) => ({
  id: tech.id,
  name: tech.name,
  tech: tech.id,
  tier: i + 1,
  powerPerHS: tech.power,
  fuelPerPower: FUEL_BY_TIER[i],
  costPerHS: Math.round(3 * Math.pow(1.25, i) * 10) / 10,
  crewPerHS: Math.round((0.6 + 0.065 * i) * 100) / 100,
  powerDraw: 0,
}));

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
