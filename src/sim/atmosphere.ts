/**
 * Atmospheres, and what they do to a world.
 *
 * A body's atmosphere is a set of partial pressures in Earth atmospheres.
 * Everything that matters about the environment - whether it can be breathed,
 * how warm it is, what a colony there costs - is derived from that set, which
 * is what makes terraforming a real mechanic rather than a number ticking
 * down: you change the gases, and the consequences follow.
 *
 * The greenhouse constants are game values, not measured physics. They are
 * chosen so that observed temperatures are the baseline and a serious
 * terraforming programme takes decades, as it does in Aurora.
 */

export interface Gas {
  id: string;
  name: string;
  /** Warming contribution per atmosphere of partial pressure. */
  greenhouse: number;
  /** This is the gas colonists breathe. */
  oxygen?: boolean;
  /** Unsafe above this partial pressure, in atmospheres. */
  toxicAbove?: number;
}

export const GASES: Gas[] = [
  { id: "nitrogen", name: "Nitrogen", greenhouse: 0 },
  { id: "oxygen", name: "Oxygen", greenhouse: 0, oxygen: true, toxicAbove: 0.3 },
  { id: "carbon-dioxide", name: "Carbon Dioxide", greenhouse: 1.0, toxicAbove: 0.01 },
  { id: "water-vapour", name: "Water Vapour", greenhouse: 0.1 },
  { id: "nitrous-oxide", name: "Nitrous Oxide", greenhouse: 0.9 },
  { id: "methane", name: "Methane", greenhouse: 2.0, toxicAbove: 0.01 },
  { id: "ammonia", name: "Ammonia", greenhouse: 1.0, toxicAbove: 0.001 },
  { id: "sulphur-dioxide", name: "Sulphur Dioxide", greenhouse: 1.0, toxicAbove: 0.001 },
  { id: "argon", name: "Argon", greenhouse: 0 },
  { id: "hydrogen", name: "Hydrogen", greenhouse: 0 },
  { id: "helium", name: "Helium", greenhouse: 0 },
];

export const GAS_BY_ID = new Map(GASES.map((g) => [g.id, g]));

/** Partial pressures by gas id, in atmospheres. */
export type Atmosphere = Record<string, number>;

/** Warming saturates: the hundredth atmosphere of a gas does little. */
export const GREENHOUSE_MAX_K = 400;
export const GREENHOUSE_SCALE = 2.0;

/** Oxygen has to sit in this band to be breathable. */
export const OXYGEN_MIN = 0.1;
export const OXYGEN_MAX = 0.3;
/** Above this, the air itself is the problem whatever it is made of. */
export const PRESSURE_MAX_BREATHABLE = 4;
/** Comfortable surface temperature, in kelvin. */
export const TEMP_MIN = 253;
export const TEMP_MAX = 313;

export function totalPressure(atmosphere: Atmosphere): number {
  let total = 0;
  for (const pressure of Object.values(atmosphere)) total += pressure;
  return total;
}

export function partialPressure(atmosphere: Atmosphere, gasId: string): number {
  return atmosphere[gasId] ?? 0;
}

/** Greenhouse-weighted pressure, the input to the warming curve. */
export function greenhousePressure(atmosphere: Atmosphere): number {
  let total = 0;
  for (const [id, pressure] of Object.entries(atmosphere)) {
    total += pressure * (GAS_BY_ID.get(id)?.greenhouse ?? 0);
  }
  return total;
}

export function greenhouseWarming(atmosphere: Atmosphere): number {
  const gh = greenhousePressure(atmosphere);
  return GREENHOUSE_MAX_K * (1 - Math.exp(-gh / GREENHOUSE_SCALE));
}

/**
 * Surface temperature now. The observed temperature is the anchor, so a world
 * nobody has touched reads exactly as it does in the almanac; only changes to
 * the atmosphere move it.
 */
export function surfaceTemperature(
  observedTempK: number,
  observed: Atmosphere,
  current: Atmosphere,
): number {
  const delta = greenhouseWarming(current) - greenhouseWarming(observed);
  return Math.max(10, observedTempK + delta);
}

/** Gases present above their safe partial pressure. */
export function toxicGases(atmosphere: Atmosphere): { gas: Gas; pressure: number }[] {
  const found: { gas: Gas; pressure: number }[] = [];
  for (const [id, pressure] of Object.entries(atmosphere)) {
    const gas = GAS_BY_ID.get(id);
    if (gas?.toxicAbove !== undefined && pressure > gas.toxicAbove) {
      found.push({ gas, pressure });
    }
  }
  return found;
}

export function isBreathable(atmosphere: Atmosphere): boolean {
  const oxygen = partialPressure(atmosphere, "oxygen");
  if (oxygen < OXYGEN_MIN || oxygen > OXYGEN_MAX) return false;
  if (totalPressure(atmosphere) > PRESSURE_MAX_BREATHABLE) return false;
  return toxicGases(atmosphere).length === 0;
}

/**
 * The thickest atmosphere a world can hold on to, as a function of gravity.
 * Without it, terraforming the Moon to ten atmospheres would be allowed.
 */
export function maxPressureFor(gravity: number): number {
  return gravity * 4;
}

/** Human-readable composition, biggest constituent first. */
export function describeAtmosphere(atmosphere: Atmosphere): string {
  const total = totalPressure(atmosphere);
  if (total <= 0) return "None - vacuum";
  return Object.entries(atmosphere)
    .filter(([, pressure]) => pressure > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([id, pressure]) => `${((pressure / total) * 100).toFixed(1)}% ${GAS_BY_ID.get(id)?.name ?? id}`)
    .join(", ");
}

export function cloneAtmosphere(atmosphere: Atmosphere): Atmosphere {
  return { ...atmosphere };
}
