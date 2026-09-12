/** The installations a colony can hold. Costs are placeholders for now. */

export interface InstallationType {
  id: string;
  name: string;
  blurb: string;
  /** Build cost in Build Points. */
  cost: number;
  /** Workers required, in millions. 0 for automated installations. */
  workers: number;
}

export const INSTALLATIONS: InstallationType[] = [
  { id: "infrastructure", name: "Infrastructure", blurb: "Sustains population on a world with a colony cost above zero.", cost: 2, workers: 0 },
  { id: "mine", name: "Mine", blurb: "Extracts trans-Newtonian minerals. Requires population.", cost: 120, workers: 0.05 },
  { id: "automated-mine", name: "Automated Mine", blurb: "Mines without population - the workhorse of belt operations.", cost: 240, workers: 0 },
  { id: "construction-factory", name: "Construction Factory", blurb: "Produces installations and planetary construction.", cost: 120, workers: 0.05 },
  { id: "fuel-refinery", name: "Fuel Refinery", blurb: "Converts Sorium into fuel.", cost: 120, workers: 0.05 },
  { id: "ordnance-factory", name: "Ordnance Factory", blurb: "Produces missiles and ordnance.", cost: 120, workers: 0.05 },
  { id: "research-lab", name: "Research Laboratory", blurb: "Hosts one scientist and their research project.", cost: 900, workers: 0.1 },
  { id: "maintenance", name: "Maintenance Facility", blurb: "Services ships in orbit, holding off maintenance failures.", cost: 150, workers: 0.05 },
  { id: "mass-driver", name: "Mass Driver", blurb: "Fires mineral packets to a receiving colony.", cost: 300, workers: 0.05 },
  { id: "spaceport", name: "Spaceport", blurb: "Speeds cargo loading and unloading.", cost: 1200, workers: 0.1 },
  { id: "terraforming", name: "Terraforming Installation", blurb: "Alters atmospheric gases, lowering colony cost over decades.", cost: 600, workers: 0.05 },
  { id: "dstn", name: "Deep Space Tracking Station", blurb: "Extends passive sensor coverage across the system.", cost: 600, workers: 0.05 },
];

export const INSTALLATION_BY_ID = new Map(INSTALLATIONS.map((i) => [i.id, i]));
