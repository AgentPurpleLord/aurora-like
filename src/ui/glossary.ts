/**
 * Plain-language explanations of the game's terms, shown on hover.
 *
 * A game with this much detail has a vocabulary. Rather than hide the detail
 * or bury it in a manual, every figure explains itself where it is shown.
 */

export const GLOSSARY: Record<string, string> = {
  "Condition":
    "How worn the fleet's worst ship is: 100% is new. Condition falls as ships work, slows them (down to 60% speed) and below 30% they can break down. Park them at a colony with a shipyard or maintenance facility to restore it.",
  "Wear":
    "How fast a class wears out, as a multiple of a plain commercial ship. Military engines, sensors and drives wear more than twice as fast; tanks, holds and berths hardly wear.",
  "Full overhaul": "What servicing a completely worn ship back to new would cost: a share of its build cost.",
  "Servicing capacity":
    "Tons of ship this colony can service at once: 1,500 t per shipyard and 4,000 t per maintenance facility. More ships than that share the capacity, and are serviced more slowly.",
  "Specification": "Commercial parts are cheap, thrifty and gentle on maintenance. Military parts are stronger but dearer, need more crew and wear faster.",
  "Colony Cost":
    "How hostile a world is to settle: 0 is a garden world, 2 is the floor for any world with unbreathable air. Infrastructure needed per million colonists is about 100 x this.",
  "Unmodified Colony Cost": "The world's colony cost before genetic adaptation research is applied.",
  "Supported Population":
    "The most people the world can sustain: its infrastructure divided by colony cost (a garden world is limited only by its size).",
  "Population": "People living on the world, in millions unless shown as billions.",
  "Annual Growth": "Net change in population per year, from births against the supported population.",
  "Workforce": "Workers available against workers the manned installations need.",
  "Staffed": "Share of the colony's manned installations that have workers. Everything runs at this rate.",
  "Output Capacity": "Build points per year the construction factories can produce here.",
  "BP/yr": "Build points per year: the currency installations and ships are built in.",
  "RP/yr": "Research points per year produced by laboratories.",
  "Wealth/yr": "Tax revenue per year from the colony's population and financial centres.",
  "Mining t/yr": "Tons of minerals extracted per year from the world's deposits.",
  "Growth/yr": "Net population change per year.",
  "Next build": "How long until the item at the head of the build queue is finished.",
  "Cover": "How long the stockpile lasts at the current net rate. Blank means the stock is growing.",
  "In ground": "Minerals still in the ground at colonies that have mines to reach them.",
  "Stockpile": "Minerals held across every colony.",
  "Used/yr": "Minerals the build queues and refineries will consume in a year at current output.",
  "Mined/yr": "Minerals mined across the empire per year.",
  "Net": "Mined minus used per year in the ledger, or income minus expenditure in the treasury. Negative means a drain.",
  "Accessibility": "How easily a deposit can be mined, 0.1 to 1.0. Mine output is multiplied by it.",
  "Surface Gravity": "Gravity at the surface in Earth gravities. Below 0.1 g or above 1.9 g raises colony cost.",
  "Escape Velocity": "Speed needed to leave the body's gravity.",
  "Signal Delay": "How long light takes to reach it from Earth.",
  "Maximum Pressure": "The thickest atmosphere this world's gravity can hold on to.",
  "Infrastructure / 1m pop": "Infrastructure units needed to sustain one million colonists at this colony cost.",
  "Needs slipway": "The hull weight a shipyard must be able to lay down to build this class. Each shipyard adds 5,000 t.",
  "Endurance": "How long the tanks last at full thrust.",
  "Range": "Distance the ship can cover on a full tank at full thrust.",
  "Power modifier": "Overdriving an engine buys thrust at a steep fuel premium; underdriving saves fuel for range.",
  "Fuel per power-hour": "Litres burned for each unit of engine power per hour.",
  "Survey rate": "Survey points per day. A body needs 200.",
  "Rate": "Output per year at the current setup.",
  "Civilian Shipping":
    "A stand-in for freighters: installations built for another colony arrive by themselves and colonists migrate from the capital.",
  "Laboratories": "Research laboratories working, against the number built.",
  "Scientists free": "Scientists not currently leading a project.",
  "Stability":
    "How content the people are, 0 to 100 (70 is neutral). Heavy taxes lower it; welfare, reserves and light taxes raise it; debt crushes it. Below 40 output and growth fall, below 20 there are riots.",
  "Tax rate": "Share of the colonies' taxable output the government takes. Higher is richer now but unhappier, and strangles trade.",
  "Treasury": "Wealth in hand. A deficit halves industrial output.",
};

/** The explanation for a label, if there is one. */
export function hintFor(label: string): string | undefined {
  return GLOSSARY[label.replace(/\s*\(\d+\)\s*$/, "")];
}
