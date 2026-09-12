/** The eight research fields. A scientist specialises in exactly one. */

export const RESEARCH_FIELDS = [
  "construction",
  "power",
  "sensors",
  "defence",
  "energy",
  "missiles",
  "biology",
  "logistics",
] as const;

export type ResearchField = (typeof RESEARCH_FIELDS)[number];

export const FIELD_NAMES: Record<ResearchField, string> = {
  construction: "Construction & Production",
  power: "Power & Propulsion",
  sensors: "Sensors & Fire Control",
  defence: "Defensive Systems",
  energy: "Energy Weapons",
  missiles: "Missiles & Kinetic Weapons",
  biology: "Biology & Genetics",
  logistics: "Logistics & Ground Combat",
};

export const FIELD_SHORT: Record<ResearchField, string> = {
  construction: "Construction",
  power: "Propulsion",
  sensors: "Sensors",
  defence: "Defence",
  energy: "Energy",
  missiles: "Missiles",
  biology: "Biology",
  logistics: "Logistics",
};
