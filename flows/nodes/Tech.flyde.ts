import { CodeNode, configurableValue, ConfigurableValue } from "@flyde/core";

export interface TechConfig {
  techId: ConfigurableValue;
  name: ConfigurableValue;
  field: ConfigurableValue;
  branch: ConfigurableValue;
  cost: ConfigurableValue;
  future: ConfigurableValue;
  effects: ConfigurableValue;
  extraPrereqs: ConfigurableValue;
  description: ConfigurableValue;
}

/**
 * One technology. Wire the `unlocks` pin of a prerequisite into `requires`.
 * Never executed - `npm run techs` reads the flow files and writes src/data/techs.json.
 */
export const Tech: CodeNode<TechConfig> = {
  id: "Tech",
  namespace: "Aurora",
  mode: "advanced",
  icon: "flask",
  menuDisplayName: "Technology",
  menuDescription: "A researchable technology. Wire prerequisites into 'requires'.",
  displayName: (config) => `${config.name.value}`,
  description: (config) => `${config.techId.value} - ${config.cost.value} RP`,
  defaultConfig: {
    techId: configurableValue("string", "new-tech"),
    name: configurableValue("string", "New Technology"),
    field: configurableValue("string", "construction"),
    branch: configurableValue("string", "General"),
    cost: configurableValue("number", 1000),
    future: configurableValue("boolean", false),
    effects: configurableValue("string", ""),
    extraPrereqs: configurableValue("string", ""),
    description: configurableValue("string", ""),
  },
  inputs: { requires: { description: "Prerequisite technologies" } },
  outputs: { unlocks: { description: "Technologies that need this one" } },
  run: () => {},
  editorConfig: {
    type: "structured",
    fields: [
      { type: "string", label: "Id", configKey: "techId", description: "Unique id. Parts and ladders refer to techs by this." },
      { type: "string", label: "Name", configKey: "name" },
      { type: "select", label: "Field", configKey: "field", typeData: { options: [
        "construction", "power", "sensors", "defence", "energy", "missiles", "logistics", "biology",
      ].map((v) => ({ label: v, value: v })) } },
      { type: "string", label: "Sub-field", configKey: "branch", description: "Heading it is listed under in the Research screen" },
      { type: "number", label: "Cost (RP)", configKey: "cost" },
      { type: "boolean", label: "Future tech", configKey: "future", description: "Researchable but not yet wired into the sim" },
      { type: "longtext", label: "Effects", configKey: "effects", description: "One per line: 'stat = 12', 'stat += 0.1', or 'unlock installation-id'" },
      { type: "string", label: "Prereqs in other fields", configKey: "extraPrereqs", description: "Comma separated tech ids that cannot be wired in this flow" },
      { type: "longtext", label: "Description", configKey: "description" },
    ],
  },
};
