/**
 * The rest of the technology tree.
 *
 * Two kinds of tech live here. Working ones change something in the game -
 * a stat, an engine type, a ladder that improves every ship's parts - and
 * say so. The weapons, armour, shields and ground-force trees are real
 * research with no mechanical effect yet, because there is no combat to use
 * them in; they are marked `future` and cost RP like any other.
 */

import type { NumericStat, Tech, TechEffect } from "./techs";
import type { ResearchField } from "./fields";

const set = (stat: NumericStat, value: number): TechEffect => ({ kind: "set", stat, value });
const add = (stat: NumericStat, value: number): TechEffect => ({ kind: "add", stat, value });

interface Step {
  id: string;
  name: string;
  cost: number;
  description: string;
  effects?: TechEffect[];
}

/** A line of techs, each needing the one before (the first needs `from`). */
function line(field: ResearchField, from: string[], steps: Step[], future = false): Tech[] {
  return steps.map((step, i) => ({
    id: step.id,
    name: step.name,
    field,
    cost: step.cost,
    prereqs: i === 0 ? from : [steps[i - 1].id],
    effects: step.effects,
    description: step.description,
    ...(future ? { future: true } : {}),
  }));
}

/** A ladder of "set a stat to N" techs, costs doubling-ish. */
function setLadder(
  field: ResearchField, from: string[], idPrefix: string, label: string, stat: NumericStat,
  unit: string, rungs: [value: number, cost: number][],
  describe: (value: number) => string,
): Tech[] {
  return line(field, from, rungs.map(([value, cost]) => ({
    id: `${idPrefix}-${value}`,
    name: `${label} ${value}${unit}`,
    cost,
    description: describe(value),
    effects: [set(stat, value)],
  })));
}

/** Techs that improve parts through a ladder in ships/components.ts. */
function partLine(field: ResearchField, from: string[], id: string, label: string, text: string[], costs: number[]): Tech[] {
  return line(field, from, costs.map((cost, i) => ({
    id: `${id}-${i + 1}`,
    name: `${label} ${["I", "II", "III", "IV"][i]}`,
    cost,
    description: text[i],
  })));
}

export const EXTENDED_TECHS: Tech[] = [
  // ============================================== construction and production
  ...setLadder("construction", ["mining-21"], "mining", "Mining Production", "miningRate", " Tons", [[24, 24000], [27, 48000], [30, 96000], [33, 160000], [36, 260000]],
    (v) => `Each mine extracts ${v} tons per year from a deposit of accessibility 1.0.`),
  ...setLadder("construction", ["construction-21"], "construction", "Construction Rate", "constructionRate", " BP", [[24, 24000], [27, 48000], [30, 96000], [33, 160000], [36, 260000]],
    (v) => `Each construction factory produces ${v} build points per year.`),
  ...setLadder("construction", ["research-400"], "research", "Research Rate", "researchRate", " RP", [[500, 32000], [600, 64000], [750, 120000], [900, 200000], [1100, 320000]],
    (v) => `Each research laboratory generates ${v} research points per year.`),
  ...setLadder("construction", ["fuel-80k"], "fuel", "Fuel Production", "fuelPerRefinery", " Litres", [[100000, 10000], [125000, 20000], [160000, 40000], [200000, 80000]],
    (v) => `Each refinery converts Sorium into ${v.toLocaleString()} litres of fuel per year.`),
  ...line("construction", ["mass-drivers-2"], [
    { id: "mass-drivers-3", name: "Mass Drivers III", cost: 15000, description: "Coil-gun staging: 5,000 tons per driver per year.", effects: [set("massDriverThroughput", 5000)] },
    { id: "mass-drivers-4", name: "Mass Drivers IV", cost: 32000, description: "Superconducting rails: 10,000 tons per driver per year.", effects: [set("massDriverThroughput", 10000)] },
    { id: "mass-drivers-5", name: "Mass Drivers V", cost: 70000, description: "Orbital catchers: 20,000 tons per driver per year.", effects: [set("massDriverThroughput", 20000)] },
  ]),
  ...line("construction", ["maintenance-bays-2"], [
    { id: "maintenance-bays-3", name: "Maintenance Bays III", cost: 7000, description: "Each maintenance facility can service 12,000 tons of ship at once.", effects: [set("serviceTonsPerFacility", 12000)] },
    { id: "maintenance-bays-4", name: "Maintenance Bays IV", cost: 15000, description: "Robotic overhaul: 16,000 tons per facility.", effects: [set("serviceTonsPerFacility", 16000)] },
    { id: "maintenance-bays-5", name: "Maintenance Bays V", cost: 32000, description: "Dry-dock automation: 24,000 tons per facility.", effects: [set("serviceTonsPerFacility", 24000)] },
  ]),
  ...line("construction", ["terraforming-2"], [
    { id: "terraforming-3", name: "Terraforming III", cost: 25000, description: "0.0005 atmospheres per installation per year.", effects: [set("terraformRate", 0.0005)] },
    { id: "terraforming-4", name: "Terraforming IV", cost: 60000, description: "0.001 atmospheres per installation per year.", effects: [set("terraformRate", 0.001)] },
    { id: "terraforming-5", name: "Terraforming V", cost: 120000, description: "0.002 atmospheres per installation per year.", effects: [set("terraformRate", 0.002)] },
  ]),

  // finance and commerce
  ...line("construction", ["financial-management"], [
    { id: "banking-systems", name: "Banking Systems", cost: 8000, description: "Credit that finds its way to every colony: tax revenue up 10%.", effects: [add("wealthBonus", 0.1)] },
    { id: "stock-exchanges", name: "Stock Exchanges", cost: 18000, description: "Public capital for private ventures: tax revenue up a further 10%.", effects: [add("wealthBonus", 0.1)] },
    { id: "quantum-finance", name: "Quantum Finance", cost: 60000, description: "Instant settlement across light-years: tax revenue up a further 15%.", effects: [add("wealthBonus", 0.15)] },
  ]),
  ...line("construction", ["financial-management"], [
    { id: "trade-networks", name: "Trade Networks", cost: 6000, description: "Standard contracts and shared ledgers: commerce income and the levy on traded goods up 10%.", effects: [add("tradeBonus", 0.1)] },
    { id: "mercantile-exchanges", name: "Mercantile Exchanges", cost: 14000, description: "Commerce up a further 15%.", effects: [add("tradeBonus", 0.15)] },
    { id: "interstellar-commerce", name: "Interstellar Commerce", cost: 40000, description: "Commerce up a further 20%.", effects: [add("tradeBonus", 0.2)] },
  ]),

  // administration
  ...line("construction", ["trans-newtonian"], [
    { id: "public-broadcasting", name: "Public Broadcasting", cost: 5000, description: "A shared news and entertainment service: every colony's stability target +2.", effects: [add("stabilityBonus", 2)] },
    { id: "civil-service", name: "Civil Service Reform", cost: 12000, description: "A professional, impartial administration: stability +2.", effects: [add("stabilityBonus", 2)] },
    { id: "arbitration-courts", name: "Arbitration Courts", cost: 25000, description: "Disputes settled before they become riots: stability +2.", effects: [add("stabilityBonus", 2)] },
    { id: "enlightened-governance", name: "Enlightened Governance", cost: 60000, description: "Government that learns from its colonies: stability +3.", effects: [add("stabilityBonus", 3)] },
  ]),
  ...line("construction", ["trans-newtonian"], [
    { id: "parliamentary-procedure", name: "Parliamentary Procedure", cost: 6000, description: "Orderly debate: +0.5 political capital a year.", effects: [add("capitalBonus", 0.5)] },
    { id: "council-of-ministries", name: "Council of Ministries", cost: 20000, description: "A fourth law may be in force at once.", effects: [add("policySlots", 1)] },
    { id: "constitutional-reform", name: "Constitutional Reform", cost: 28000, description: "A clearer mandate: +0.5 political capital a year.", effects: [add("capitalBonus", 0.5)] },
    { id: "grand-cabinet", name: "Grand Cabinet", cost: 80000, description: "A fifth law may be in force at once.", effects: [add("policySlots", 1)] },
    { id: "federal-charter", name: "Federal Charter", cost: 120000, description: "A settled constitution: +1 political capital a year.", effects: [add("capitalBonus", 1)] },
  ]),

  // goods production
  ...setLadder("construction", ["trans-newtonian"], "consumer-lines", "Consumer Production Lines", "consumerOutput", "", [[125, 5000], [150, 12000], [200, 30000], [300, 70000]],
    (v) => `Each consumer plant makes ${v} units of consumer goods a year.`),
  ...setLadder("construction", ["financial-management"], "luxury-fabrication", "Luxury Fabrication", "luxuryOutput", "", [[50, 6000], [60, 15000], [80, 40000], [120, 90000]],
    (v) => `Each luxury workshop makes ${v} units of luxuries a year.`),

  // ================================================== power and propulsion
  { id: "fusion-magnetic", name: "Magnetic Confinement Fusion Drive", field: "power", cost: 20000, prereqs: ["magneto-plasma"],
    description: "Fusion thrust contained in magnetic bottles: 85 power per hull space and thriftier than any plasma drive." },
  { id: "fusion-inertial", name: "Inertial Confinement Fusion Drive", field: "power", cost: 40000, prereqs: ["fusion-magnetic"],
    description: "Pellet fusion: 110 power per hull space." },
  { id: "antimatter-solid", name: "Solid-Core Anti-Matter Drive", field: "power", cost: 80000, prereqs: ["fusion-inertial"],
    description: "Annihilation in a solid core: 140 power per hull space, and half the fuel burn of an ion drive." },
  { id: "antimatter-gas", name: "Gas-Core Anti-Matter Drive", field: "power", cost: 150000, prereqs: ["antimatter-solid"],
    description: "A hotter, thinner core: 180 power per hull space." },
  { id: "photonic-drive", name: "Photonic Drive", field: "power", cost: 300000, prereqs: ["antimatter-gas"],
    description: "Pure radiation thrust: 240 power per hull space and the least fuel per unit of power ever built." },

  ...line("power", ["engine-power-125"], [
    { id: "engine-power-150", name: "Engine Power Modifier x1.5", cost: 6000, description: "Raises the engine power modifier ceiling to 1.5." },
    { id: "engine-power-175", name: "Engine Power Modifier x1.75", cost: 14000, description: "Raises the engine power modifier ceiling to 1.75." },
    { id: "engine-power-200", name: "Engine Power Modifier x2", cost: 35000, description: "Raises the engine power modifier ceiling to 2.0." },
  ]),
  ...line("power", ["fuel-consumption-08"], [
    { id: "fuel-consumption-07", name: "Fuel Consumption 0.7", cost: 4000, description: "Every engine, existing ships included, burns 30% less fuel than the standard." },
    { id: "fuel-consumption-06", name: "Fuel Consumption 0.6", cost: 10000, description: "40% less fuel than the standard." },
    { id: "fuel-consumption-05", name: "Fuel Consumption 0.5", cost: 25000, description: "Half the standard fuel burn." },
    { id: "fuel-consumption-04", name: "Fuel Consumption 0.4", cost: 60000, description: "60% less fuel than the standard." },
  ]),
  ...partLine("power", ["nuclear-thermal"], "tank-efficiency", "Fuel Tank Linings", [
    "Better sealants: every fuel tank holds 25% more, on ships already built too.",
    "Cryogenic tankage: tanks hold 50% more than the original.",
    "Compressed fuel stores: tanks hold twice the original.",
  ], [3500, 12000, 40000]),
  ...partLine("power", ["jump-point-theory"], "jump-efficiency", "Jump Drive Efficiency", [
    "Tuned resonance: jump drives carry 25% more tonnage.",
    "Jump drives carry 50% more tonnage than the original.",
    "Jump drives carry twice the original tonnage.",
  ], [15000, 40000, 100000]),
  ...line("power", ["jump-gate-construction"], [
    { id: "gate-construction-2", name: "Gate Construction II", cost: 25000, description: "Gate construction modules build 50% faster." },
    { id: "gate-construction-3", name: "Gate Construction III", cost: 60000, description: "Gate construction modules build twice as fast." },
    { id: "gate-construction-4", name: "Gate Construction IV", cost: 150000, description: "Gate construction modules build three times as fast." },
  ]),

  // ================================================== sensors and fire control
  ...partLine("sensors", ["geo-survey-sensors"], "geo-survey-strength", "Geological Survey Strength", [
    "Better spectrometry: geological survey sensors work 1.5x as fast.",
    "Geological survey sensors work twice as fast as the original.",
    "Geological survey sensors work three times as fast as the original.",
  ], [3000, 9000, 25000]),
  ...partLine("sensors", ["grav-survey-sensors"], "grav-survey-strength", "Gravitational Survey Strength", [
    "Finer gravimetry: gravitational survey sensors work 1.5x as fast.",
    "Gravitational survey sensors work twice as fast as the original.",
    "Gravitational survey sensors work three times as fast as the original.",
  ], [3500, 10000, 28000]),
  // detection and fire control - nothing in the game uses them yet
  ...line("sensors", ["active-sensor-12"], [
    { id: "active-sensor-18", name: "Active Grav Sensor Strength 18", cost: 6000, description: "Active search sensors reach further." },
    { id: "active-sensor-24", name: "Active Grav Sensor Strength 24", cost: 14000, description: "Longer still." },
    { id: "active-sensor-36", name: "Active Grav Sensor Strength 36", cost: 32000, description: "The best conventional active sensor." },
  ], true),
  ...line("sensors", ["thermal-sensor-6"], [
    { id: "thermal-sensor-9", name: "Thermal Sensor Sensitivity 9", cost: 6000, description: "Drive plumes picked out at greater range." },
    { id: "thermal-sensor-12", name: "Thermal Sensor Sensitivity 12", cost: 14000, description: "Picks out a cooling hull." },
    { id: "thermal-sensor-18", name: "Thermal Sensor Sensitivity 18", cost: 32000, description: "The faintest heat signatures." },
  ], true),
  ...line("sensors", ["trans-newtonian"], [
    { id: "em-sensor-6", name: "EM Sensor Sensitivity 6", cost: 2000, description: "Passive detection of active sensor emissions." },
    { id: "em-sensor-9", name: "EM Sensor Sensitivity 9", cost: 6000, description: "Longer-range emission detection." },
    { id: "em-sensor-12", name: "EM Sensor Sensitivity 12", cost: 14000, description: "Hears a whisper of radar." },
  ], true),
  ...line("sensors", ["fire-control-16k"], [
    { id: "fire-control-32k", name: "Fire Control Range 32,000 km", cost: 6000, description: "Beam fire control at twice the range." },
    { id: "fire-control-64k", name: "Fire Control Range 64,000 km", cost: 14000, description: "Four times the original reach." },
    { id: "fire-control-96k", name: "Fire Control Range 96,000 km", cost: 32000, description: "Long-range gunnery." },
  ], true),
  ...line("sensors", ["trans-newtonian"], [
    { id: "ecm-1", name: "Electronic Countermeasures I", cost: 3000, description: "Jamming that spoils enemy fire control." },
    { id: "ecm-2", name: "Electronic Countermeasures II", cost: 9000, description: "Smarter jamming." },
    { id: "ecm-3", name: "Electronic Countermeasures III", cost: 24000, description: "Adaptive jamming." },
  ], true),
  ...line("sensors", ["trans-newtonian"], [
    { id: "eccm-1", name: "Counter-Countermeasures I", cost: 3000, description: "Fire control that burns through jamming." },
    { id: "eccm-2", name: "Counter-Countermeasures II", cost: 9000, description: "Frequency-hopping fire control." },
    { id: "eccm-3", name: "Counter-Countermeasures III", cost: 24000, description: "Nothing jams it for long." },
  ], true),

  // ==================================================== defensive systems
  ...line("defence", ["trans-newtonian"], [
    { id: "armour-duranium", name: "Duranium Armour", cost: 1500, description: "The first plate worthy of the name." },
    { id: "armour-hd-duranium", name: "High Density Duranium Armour", cost: 3000, description: "Denser, tougher plate." },
  ], true),
  ...line("defence", ["composite-armour"], [
    { id: "armour-ceramic", name: "Ceramic Composite Armour", cost: 7000, description: "Brittle, but it stops what steel cannot." },
    { id: "armour-laminate", name: "Laminate Composite Armour", cost: 14000, description: "Layered for toughness." },
    { id: "armour-carbon", name: "Compressed Carbon Armour", cost: 28000, description: "Diamond-hard laminate." },
    { id: "armour-biphased", name: "Biphased Carbide Armour", cost: 55000, description: "Two phases, each covering the other's weakness." },
    { id: "armour-crystalline", name: "Crystalline Composite Armour", cost: 100000, description: "Grown, not forged." },
    { id: "armour-superdense", name: "Superdense Armour", cost: 180000, description: "Matter packed past the point of reason." },
    { id: "armour-coherent", name: "Coherent Superdense Armour", cost: 300000, description: "Superdense plate with an ordered lattice." },
    { id: "armour-collapsium", name: "Collapsium Armour", cost: 500000, description: "The densest armour the physics allows." },
  ], true),
  ...line("defence", ["alpha-shields"], [
    { id: "beta-shields", name: "Beta Shields", cost: 8000, description: "Stronger deflectors." },
    { id: "gamma-shields", name: "Gamma Shields", cost: 18000, description: "Faster to recharge." },
    { id: "delta-shields", name: "Delta Shields", cost: 40000, description: "Heavy-warship shields." },
    { id: "epsilon-shields", name: "Epsilon Shields", cost: 90000, description: "Capital-ship shielding." },
    { id: "zeta-shields", name: "Zeta Shields", cost: 180000, description: "The finest deflectors ever fitted." },
  ], true),
  ...line("defence", ["alpha-shields"], [
    { id: "shield-regen-2", name: "Shield Regeneration 2", cost: 6000, description: "Shields recover more quickly." },
    { id: "shield-regen-3", name: "Shield Regeneration 3", cost: 15000, description: "Faster again." },
    { id: "shield-regen-4", name: "Shield Regeneration 4", cost: 36000, description: "Nearly continuous recovery." },
  ], true),
  ...line("defence", ["damage-control-2"], [
    { id: "damage-control-3", name: "Damage Control Rating 3", cost: 4000, description: "Faster repair crews." },
    { id: "damage-control-4", name: "Damage Control Rating 4", cost: 10000, description: "Fire-fighting robots." },
    { id: "damage-control-5", name: "Damage Control Rating 5", cost: 26000, description: "Self-sealing bulkheads." },
  ], true),
  { id: "magazine-ejection", name: "Magazine Ejection System", field: "defence", cost: 3500, prereqs: ["trans-newtonian"], future: true,
    description: "Throws a burning magazine clear before it takes the ship with it." },
  { id: "fighter-bays", name: "Fighter Bay Technology", field: "defence", cost: 9000, prereqs: ["alpha-shields"], future: true,
    description: "Hangars and launch tubes for small craft." },

  // ====================================================== energy weapons
  ...line("energy", ["laser-10cm"], [
    { id: "laser-15cm", name: "15cm Visible Light Laser", cost: 6000, description: "A shorter wavelength: more punch per shot." },
    { id: "laser-20cm", name: "20cm Ultraviolet Laser", cost: 14000, description: "Heavier beam." },
    { id: "laser-25cm", name: "25cm X-Ray Laser", cost: 32000, description: "Hard radiation." },
    { id: "laser-30cm", name: "30cm Gamma-Ray Laser", cost: 70000, description: "The heaviest laser." },
  ], true),
  ...line("energy", ["railgun-10cm"], [
    { id: "railgun-15cm", name: "15cm Railgun", cost: 6000, description: "A longer barrel." },
    { id: "railgun-20cm", name: "20cm Railgun", cost: 14000, description: "Capital-class kinetic cannon." },
    { id: "gauss-cannon", name: "Gauss Cannon", cost: 22000, description: "Rapid-fire point defence." },
  ], true),
  ...line("energy", ["capacitor-2"], [
    { id: "capacitor-3", name: "Capacitor Recharge Rate 3", cost: 6000, description: "Beams recharge three times as quickly." },
    { id: "capacitor-4", name: "Capacitor Recharge Rate 4", cost: 14000, description: "Four times as quickly." },
    { id: "capacitor-5", name: "Capacitor Recharge Rate 5", cost: 32000, description: "Five times as quickly." },
  ], true),
  ...line("energy", ["laser-10cm"], [
    { id: "laser-focal-reduction", name: "Reduced Focal Size", cost: 5000, description: "Tighter beams carry further." },
    { id: "laser-focal-reduction-2", name: "Reduced Focal Size II", cost: 14000, description: "Tighter again." },
    { id: "laser-focal-reduction-3", name: "Reduced Focal Size III", cost: 36000, description: "Near-perfect collimation." },
  ], true),
  ...line("energy", ["turrets"], [
    { id: "turret-gearing-2", name: "Turret Gearing 2", cost: 6000, description: "Turrets track twice as fast." },
    { id: "turret-gearing-3", name: "Turret Gearing 3", cost: 16000, description: "Three times as fast." },
    { id: "turret-gearing-4", name: "Turret Gearing 4", cost: 40000, description: "Fast enough for fighters." },
  ], true),
  ...line("energy", ["capacitor-2"], [
    { id: "plasma-carronade", name: "Plasma Carronade", cost: 18000, description: "Short-range plasma bolts." },
    { id: "plasma-torch", name: "Plasma Torch", cost: 40000, description: "A sustained plasma stream." },
    { id: "meson-cannon", name: "Meson Cannon", cost: 80000, description: "Mesons pass through armour." },
    { id: "particle-beam", name: "Particle Beam Cannon", cost: 150000, description: "A stream of accelerated particles." },
    { id: "microwave-cannon", name: "High Power Microwave", cost: 60000, description: "Cooks electronics." },
  ], true),

  // ==================================================== missiles and kinetic
  ...line("missiles", ["missile-launcher-1"], [
    { id: "missile-launcher-2", name: "Size 2 Missile Launcher", cost: 3000, description: "Heavier warheads." },
    { id: "missile-launcher-3", name: "Size 3 Missile Launcher", cost: 6000, description: "Anti-ship weight." },
    { id: "missile-launcher-4", name: "Size 4 Missile Launcher", cost: 12000, description: "Heavy anti-ship missiles." },
    { id: "missile-launcher-6", name: "Size 6 Missile Launcher", cost: 26000, description: "Capital missiles." },
    { id: "missile-launcher-8", name: "Size 8 Missile Launcher", cost: 50000, description: "Planet-breakers." },
  ], true),
  ...line("missiles", ["warhead-3"], [
    { id: "warhead-4", name: "Warhead Strength 4", cost: 4000, description: "Denser warheads." },
    { id: "warhead-5", name: "Warhead Strength 5", cost: 9000, description: "More yield per ton." },
    { id: "warhead-6", name: "Warhead Strength 6", cost: 20000, description: "Heavier still." },
    { id: "warhead-8", name: "Warhead Strength 8", cost: 48000, description: "Anti-matter seeded." },
    { id: "warhead-10", name: "Warhead Strength 10", cost: 110000, description: "The heaviest warhead." },
  ], true),
  ...line("missiles", ["missile-agility-32"], [
    { id: "missile-agility-48", name: "Missile Agility 48", cost: 6000, description: "Sharper turns." },
    { id: "missile-agility-64", name: "Missile Agility 64", cost: 14000, description: "Beats evasive manoeuvres." },
    { id: "missile-agility-96", name: "Missile Agility 96", cost: 34000, description: "Impossible to dodge for long." },
  ], true),
  ...line("missiles", ["missile-launcher-1"], [
    { id: "missile-fuel-1", name: "Missile Engine Efficiency I", cost: 3500, description: "Longer-ranged missiles." },
    { id: "missile-fuel-2", name: "Missile Engine Efficiency II", cost: 9000, description: "Longer still." },
    { id: "missile-fuel-3", name: "Missile Engine Efficiency III", cost: 24000, description: "Missiles that outrun a cruiser." },
  ], true),
  ...line("missiles", ["missile-launcher-1"], [
    { id: "magazine-armour", name: "Armoured Magazines", cost: 4000, description: "Safer ammunition stowage." },
    { id: "box-launcher", name: "Box Launchers", cost: 9000, description: "Cheap, one-shot launchers." },
    { id: "missile-reload-2", name: "Missile Reload Rate 2", cost: 12000, description: "Reloads in half the time." },
    { id: "missile-reload-3", name: "Missile Reload Rate 3", cost: 30000, description: "Reloads in a third." },
  ], true),
  { id: "decoy-missiles", name: "Missile Decoys", field: "missiles", cost: 8000, prereqs: ["missile-agility-32"], future: true,
    description: "Cheap lures to draw defensive fire." },
  { id: "point-defence", name: "Point Defence Fire Control", field: "missiles", cost: 7000, prereqs: ["gauss-cannon"], future: true,
    description: "Fast-tracking guns for the last-ditch intercept." },

  // ================================================== biology and genetics
  ...line("biology", ["medical-2"], [
    { id: "medical-3", name: "Medical Advances: Growth +30%", cost: 14000, description: "Population growth rises by a further 10%.", effects: [add("popGrowthBonus", 0.1)] },
    { id: "medical-4", name: "Medical Advances: Growth +40%", cost: 28000, description: "Population growth rises by a further 10%.", effects: [add("popGrowthBonus", 0.1)] },
    { id: "medical-5", name: "Medical Advances: Growth +50%", cost: 60000, description: "Population growth rises by a further 10%.", effects: [add("popGrowthBonus", 0.1)] },
  ]),
  ...line("biology", ["genome-2"], [
    { id: "genome-3", name: "Genome Adjustment: Colony Cost -0.60", cost: 28000, description: "A further 0.20 off colony cost on every world.", effects: [add("colonyCostReduction", 0.2)] },
    { id: "genome-4", name: "Genome Adjustment: Colony Cost -0.80", cost: 55000, description: "A further 0.20 off colony cost.", effects: [add("colonyCostReduction", 0.2)] },
    { id: "genome-5", name: "Genome Adjustment: Colony Cost -1.00", cost: 100000, description: "A further 0.20 off colony cost: nearly anywhere is liveable.", effects: [add("colonyCostReduction", 0.2)] },
  ]),
  ...line("biology", ["modular-infrastructure"], [
    { id: "modular-infrastructure-2", name: "Modular Infrastructure II", cost: 12000, description: "Each unit of infrastructure supports 50% more colonists than the original.", effects: [set("infrastructureEfficiency", 1.5)] },
    { id: "modular-infrastructure-3", name: "Modular Infrastructure III", cost: 30000, description: "75% more colonists per unit.", effects: [set("infrastructureEfficiency", 1.75)] },
    { id: "modular-infrastructure-4", name: "Modular Infrastructure IV", cost: 70000, description: "Twice the colonists per unit.", effects: [set("infrastructureEfficiency", 2)] },
  ]),
  ...setLadder("biology", ["trans-newtonian"], "hydroponics", "Hydroponic Yield", "farmOutput", "", [[125, 4000], [150, 9000], [200, 20000], [250, 50000]],
    (v) => `Each hydroponic farm grows ${v} units of food a year.`),
  ...partLine("biology", ["medical-1"], "cryogenic-berths", "Cryogenic Berths", [
    "Denser stasis cradles: colony modules carry 25% more colonists.",
    "Colony modules carry 50% more than the original.",
    "Colony modules carry twice the original colonists.",
  ], [4000, 12000, 35000]),
  { id: "xenobiology", name: "Xenobiology", field: "biology", cost: 9000, prereqs: ["genome-1"], future: true,
    description: "The study of alien life, should any be found." },
  { id: "orbital-habitats", name: "Orbital Habitats", field: "biology", cost: 20000, prereqs: ["modular-infrastructure-2"], future: true,
    description: "Homes in orbit, for worlds that cannot be lived on." },

  // ============================================ logistics and ground combat
  ...line("logistics", ["cargo-handling"], [
    { id: "cargo-handling-2", name: "Improved Cargo Handling II", cost: 8000, description: "Cargo holds carry 50% more than the original, existing freighters included." },
    { id: "cargo-handling-3", name: "Improved Cargo Handling III", cost: 25000, description: "Cargo holds carry twice the original." },
  ]),
  ...partLine("logistics", ["trans-newtonian"], "compact-quarters", "Compact Crew Quarters", [
    "Folding berths: crew quarters berth 25% more.",
    "Crew quarters berth 50% more than the original.",
    "Crew quarters berth twice the original.",
  ], [4000, 12000, 32000]),
  ...line("logistics", ["spaceports"], [
    { id: "freight-containers", name: "Standard Containers", cost: 4000, description: "Freight lines and civilian shipping move 25% more goods between colonies.", effects: [set("freightFlow", 1.25)] },
    { id: "automated-docks", name: "Automated Docks", cost: 12000, description: "Freight moves 50% more than the original.", effects: [set("freightFlow", 1.5)] },
    { id: "orbital-lifts", name: "Orbital Lifts", cost: 30000, description: "Freight moves twice as much as the original.", effects: [set("freightFlow", 2)] },
    { id: "autonomous-freighters", name: "Autonomous Freighters", cost: 80000, description: "Freight moves three times as much as the original.", effects: [set("freightFlow", 3)] },
  ]),
  ...line("logistics", ["military-academies"], [
    { id: "officer-training-3", name: "Advanced Officer Training", cost: 6000, description: "Each Military Academy trains 3 officers a year.", effects: [set("academyOutput", 3)] },
    { id: "officer-training-4", name: "Staff College", cost: 16000, description: "Each Military Academy trains 4 officers a year.", effects: [set("academyOutput", 4)] },
    { id: "officer-training-6", name: "War College", cost: 45000, description: "Each Military Academy trains 6 officers a year.", effects: [set("academyOutput", 6)] },
  ]),
  ...line("logistics", ["ground-training"], [
    { id: "ground-weapons-1", name: "Light Personal Weapons", cost: 3000, description: "Infantry arms." },
    { id: "ground-weapons-2", name: "Crew-Served Weapons", cost: 7000, description: "Heavy infantry support." },
    { id: "ground-armour-1", name: "Basic Body Armour", cost: 3000, description: "Protection for infantry." },
    { id: "ground-armour-2", name: "Composite Body Armour", cost: 8000, description: "Lighter, tougher protection." },
    { id: "ground-vehicles-1", name: "Light Vehicles", cost: 6000, description: "Armoured carriers." },
    { id: "ground-vehicles-2", name: "Heavy Vehicles", cost: 14000, description: "Tanks." },
    { id: "ground-artillery", name: "Static Artillery", cost: 12000, description: "Emplaced guns for defence." },
    { id: "ground-aa", name: "Anti-Air Weapons", cost: 12000, description: "Deny the sky to bombardment." },
    { id: "ground-xenoarch", name: "Xenoarchaeology Teams", cost: 9000, description: "Specialist teams for recovering alien ruins." },
    { id: "ground-engineers", name: "Combat Engineers", cost: 10000, description: "Fortification and demolition." },
  ], true),
];
