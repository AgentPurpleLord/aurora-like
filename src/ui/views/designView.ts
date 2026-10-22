/**
 * Design view: the component designer and the ship designer.
 *
 * Components are designed first - an engine of a chosen type, size and power
 * modifier, a sensor of a chosen size - and saved under a name. Ship classes
 * are then assembled from those saved components. Every figure on screen is
 * recomputed from the draft as you edit it, so you see what a choice does
 * before you commit to it.
 */

import type { Game } from "../../state/game";
import { shipyardCapacity } from "../../sim/economy/production";
import {
  KINDS,
  KIND_BY_ID,
  choiceOptions,
  componentStats,
  defaultParams,
  normaliseParams,
  suggestName,
  type ComponentDesign,
  type ComponentKind,
  type ParamDef,
  type ParamSet,
} from "../../sim/ships/components";
import {
  describeDesign,
  designStats,
  type DesignComponent,
  type DesignStats,
} from "../../sim/ships/design";
import { compact, el, num } from "../format";
import { button, emptyNote, section, select, stat } from "../widgets";

type Tab = "components" | "classes";

interface ComponentDraft {
  id: string | null;
  kind: ComponentKind;
  name: string;
  /** Once the player types a name, stop overwriting it with suggestions. */
  nameTouched: boolean;
  params: ParamSet;
}

interface ClassDraft {
  id: string | null;
  name: string;
  components: DesignComponent[];
}

export class DesignView {
  private listPane: HTMLElement;
  private editorPane: HTMLElement;

  private tab: Tab = "components";
  /** A short message shown above the component editor, such as why a kind is locked. */
  private notice: string | null = null;
  private componentDraft: ComponentDraft | null = null;
  private classDraft: ClassDraft | null = null;
  /** Rebuilt in place on every edit so inputs keep their focus. */
  private derivedHost = el("div", "derived-host");

  constructor(
    private root: HTMLElement,
    private game: Game,
    private actions: { openFleets: () => void },
  ) {
    this.root.classList.add("view-design");
    this.listPane = el("aside", "panel panel-left");
    this.editorPane = el("section", "fleet-detail");
    this.root.append(this.listPane, this.editorPane);
  }

  /** Jump straight to a class, from the Fleets view. */
  focusClass(classId: string | null): void {
    this.tab = "classes";
    if (classId) this.editClass(classId);
    else this.newClass();
  }

  render(): void {
    this.renderList();
    this.renderEditor();
  }

  // ----------------------------------------------------------------- list

  private renderList(): void {
    const { empire } = this.game;
    this.listPane.textContent = "";

    const tabs = el("div", "tabs");
    for (const [id, label, count] of [
      ["components", "Components", empire.componentDesigns.filter((c) => !c.obsolete).length],
      ["classes", "Ship Classes", empire.designs.filter((d) => !d.obsolete).length],
    ] as [Tab, string, number][]) {
      const tab = el("button", "tab", `${label} (${count})`);
      tab.classList.toggle("active", this.tab === id);
      tab.addEventListener("click", () => {
        this.tab = id;
        this.render();
      });
      tabs.append(tab);
    }
    this.listPane.append(tabs);

    const actions = el("div", "template-actions");
    actions.append(
      button(
        this.tab === "components" ? "New component" : "New class",
        () => (this.tab === "components" ? this.newComponent() : this.newClass()),
        "primary-btn",
      ),
    );
    const unlocked = KINDS.some((k) => k.available(empire.researched));
    if (unlocked) {
      actions.append(
        button(
          this.tab === "components" ? "Add standard set" : "Add standard classes",
          () => {
            const now = this.game.clock.seconds;
            if (this.tab === "components") empire.addStandardComponents(now);
            else empire.addStandardClasses(now);
            this.game.emit();
          },
        ),
      );
    }
    this.listPane.append(actions);

    const list = el("div", "tree design-list");
    this.listPane.append(list);
    if (this.tab === "components") this.renderComponentList(list);
    else this.renderClassList(list);
  }

  private renderComponentList(list: HTMLElement): void {
    const { empire } = this.game;
    if (!empire.componentDesigns.length) {
      emptyNote(list, "No components designed yet. Create one, or add the standard set.");
      return;
    }
    for (const kindDef of KINDS) {
      const items = empire.componentDesigns.filter((c) => c.kind === kindDef.kind);
      if (!items.length) continue;
      list.append(el("div", "sub-head design-kind", kindDef.name));
      for (const component of items) {
        const resolved = empire.resolveComponent(component.id);
        const row = el("div", "tree-row design-row");
        row.classList.toggle("selected", this.componentDraft?.id === component.id);
        row.classList.toggle("obsolete", Boolean(component.obsolete));
        row.append(el("span", "tree-name", component.name));
        const users = empire.componentUsers(component.id).length;
        row.append(
          el("span", "tree-meta",
            component.obsolete ? "obsolete" : users ? `${users} class${users === 1 ? "" : "es"}` : `${num(resolved?.stats.cost ?? 0)} BP`),
        );
        row.addEventListener("click", () => this.editComponent(component.id));
        list.append(row);
      }
    }
  }

  private renderClassList(list: HTMLElement): void {
    const { empire } = this.game;
    if (!empire.designs.length) {
      emptyNote(list, "No ship classes yet. Design components first, then assemble a class.");
      return;
    }
    for (const design of empire.designs) {
      const stats = empire.statsOf(design.id);
      const row = el("div", "tree-row design-row");
      row.classList.toggle("selected", this.classDraft?.id === design.id);
      row.classList.toggle("obsolete", Boolean(design.obsolete));
      row.append(el("span", "tree-name", design.name));
      const flying = [...empire.ships.values()].filter((s) => s.designId === design.id).length;
      row.append(
        el("span", "tree-meta",
          design.obsolete ? "obsolete" : flying ? `${flying} flying` : stats ? `${num(stats.tons)} t` : ""),
      );
      row.addEventListener("click", () => this.editClass(design.id));
      list.append(row);
    }
  }

  // --------------------------------------------------------------- editor

  private renderEditor(): void {
    this.editorPane.textContent = "";
    if (this.tab === "components") this.renderComponentEditor();
    else this.renderClassEditor();
  }

  private header(title: string, subtitle: string): HTMLElement {
    const head = el("div", "detail-head");
    head.append(el("div", "detail-title", title));
    head.append(el("div", "detail-sub", subtitle));
    this.editorPane.append(head);
    const body = el("div", "detail-body");
    this.editorPane.append(body);
    return body;
  }

  // -------------------------------------------------- component designer

  private newComponent(): void {
    const { empire } = this.game;
    this.notice = null;
    this.tab = "components";
    const kind = KINDS.find((k) => k.available(empire.researched))?.kind;
    if (!kind) {
      this.componentDraft = null;
    } else {
      const params = defaultParams(kind, empire.researched);
      this.componentDraft = {
        id: null, kind, params, nameTouched: false,
        name: suggestName(kind, params, empire.researched),
      };
    }
    this.render();
  }

  private editComponent(id: string): void {
    const component = this.game.empire.component(id);
    if (!component) return;
    this.notice = null;
    this.tab = "components";
    this.componentDraft = {
      id,
      kind: component.kind,
      name: component.name,
      nameTouched: true,
      params: { ...component.params },
    };
    this.render();
  }

  private renderComponentEditor(): void {
    const { empire } = this.game;
    const draft = this.componentDraft;

    if (!draft) {
      const body = this.header("Component Designer", "Design the parts a ship is built from");
      const locked = KINDS.every((k) => !k.available(empire.researched));
      emptyNote(
        body,
        locked
          ? "Nothing can be designed yet. Research Trans-Newtonian Technology."
          : "Pick a component on the left to edit it, or create a new one.",
      );
      return;
    }

    const existing = draft.id ? empire.component(draft.id) : undefined;
    const users = existing ? empire.componentUsers(existing.id) : [];
    const body = this.header(
      draft.name || "New component",
      existing ? `${KIND_BY_ID.get(draft.kind)?.name} - saved design` : `${KIND_BY_ID.get(draft.kind)?.name} - unsaved`,
    );

    // --- what kind of component
    const kindSec = section(body, "Component");
    if (this.notice) kindSec.append(el("p", "project-warning", this.notice));
    kindSec.append(
      select(
        KINDS.map((k) => ({
          value: k.kind,
          label: k.available(empire.researched) ? k.name : `${k.name} (locked)`,
        })),
        draft.kind,
        (value) => {
          const kind = value as ComponentKind;
          const def = KIND_BY_ID.get(kind)!;
          if (!def.available(empire.researched)) {
            this.notice = `${def.name} is locked. ${def.lockedReason}`;
            this.render();
            return;
          }
          this.notice = null;
          draft.kind = kind;
          draft.id = null;
          draft.params = defaultParams(kind, empire.researched);
          draft.nameTouched = false;
          draft.name = suggestName(kind, draft.params, empire.researched);
          this.render();
        },
      ),
    );
    kindSec.append(el("p", "muted small", KIND_BY_ID.get(draft.kind)?.blurb ?? ""));

    // --- parameters
    const paramSec = section(body, "Design");
    for (const def of KIND_BY_ID.get(draft.kind)!.params) {
      paramSec.append(this.paramControl(draft, def));
    }

    // --- name
    const nameRow = el("div", "field-row");
    nameRow.append(el("label", "field-label", "Name"));
    const nameInput = el("input", "select name-input");
    nameInput.type = "text";
    nameInput.value = draft.name;
    nameInput.addEventListener("input", () => {
      draft.name = nameInput.value;
      draft.nameTouched = true;
    });
    nameRow.append(nameInput);
    paramSec.append(nameRow);
    this.nameInput = nameInput;

    // --- derived figures, kept in a host that is redrawn on every edit
    body.append(this.derivedHost);
    this.refreshComponentDerived(draft);

    // --- actions
    const actions = el("div", "form-actions");
    const stats = componentStats(draft.kind, draft.params, empire.researched);
    const blocked = stats.problems.length > 0;

    if (existing && !users.length) {
      actions.append(
        button("Save changes", () => {
          empire.updateComponentDesign(existing.id, draft.name, draft.params);
          this.game.emit();
        }, "primary-btn"),
      );
    }
    actions.append(
      button(existing ? "Save as new component" : "Create component", () => {
        if (blocked) return;
        const created = empire.addComponentDesign(draft.kind, draft.params, this.game.clock.seconds, draft.name);
        this.componentDraft = { ...draft, id: created.id, name: created.name, nameTouched: true };
        this.game.emit();
      }, existing && !users.length ? "ghost-btn" : "primary-btn"),
    );
    if (existing) {
      actions.append(
        button(existing.obsolete ? "Restore" : "Mark obsolete", () => {
          empire.setComponentObsolete(existing.id, !existing.obsolete);
          this.game.emit();
        }),
      );
      if (!users.length) {
        actions.append(
          button("Delete", () => {
            empire.removeComponentDesign(existing.id);
            this.componentDraft = null;
            this.game.emit();
          }),
        );
      }
    }
    body.append(actions);

    if (users.length) {
      body.append(
        el("p", "muted small",
          `Used by ${users.map((u) => u.name).join(", ")}. A component built into a class is superseded rather than rewritten: save a new one and mark this obsolete.`),
      );
    }
    if (blocked) {
      for (const problem of stats.problems) body.append(el("p", "project-warning", problem));
    }
  }

  private nameInput: HTMLInputElement | null = null;

  /** A labelled slider with a number box, both driving one parameter. */
  private paramControl(draft: ComponentDraft, def: ParamDef): HTMLElement {
    const { empire } = this.game;
    const row = el("div", "field-row");
    row.append(el("label", "field-label", def.label));

    if (def.type === "choice") {
      const options = choiceOptions(draft.kind, def.id, empire.researched);
      const node = el("select", "select");
      for (const option of options) {
        const opt = el("option", undefined, option.locked ? `${option.label} (not researched)` : option.label);
        opt.value = option.value;
        opt.disabled = option.locked;
        node.append(opt);
      }
      node.value = String(draft.params[def.id]);
      node.addEventListener("change", () => {
        draft.params[def.id] = node.value;
        this.afterParamChange(draft);
      });
      row.append(node);
      return row;
    }

    // Bounds can depend on research (the engine modifier ceiling).
    const bounds = normaliseParams(draft.kind, { [def.id]: 1e9 }, empire.researched);
    const max = Math.min(def.max ?? 1e9, Number(bounds[def.id]));
    const min = def.min ?? 0;
    const step = def.step ?? 1;

    const slider = el("input", "slider");
    slider.type = "range";
    slider.min = String(min);
    slider.max = String(max);
    slider.step = String(step);
    slider.value = String(draft.params[def.id]);

    const box = el("input", "number-input");
    box.type = "number";
    box.min = String(min);
    box.max = String(max);
    box.step = String(step);
    box.value = String(draft.params[def.id]);

    const apply = (raw: string) => {
      const value = Math.min(max, Math.max(min, Number(raw) || min));
      draft.params[def.id] = value;
      slider.value = String(value);
      box.value = String(value);
      this.afterParamChange(draft);
    };
    slider.addEventListener("input", () => apply(slider.value));
    box.addEventListener("change", () => apply(box.value));

    row.append(slider, box, el("span", "muted small", def.unit ?? ""));
    if (def.help) row.title = def.help;
    return row;
  }

  /** Re-derive and redraw the figures without rebuilding the form. */
  private afterParamChange(draft: ComponentDraft): void {
    const { empire } = this.game;
    draft.params = normaliseParams(draft.kind, draft.params, empire.researched);
    if (!draft.nameTouched) {
      draft.name = suggestName(draft.kind, draft.params, empire.researched);
      if (this.nameInput) this.nameInput.value = draft.name;
    }
    this.refreshComponentDerived(draft);
  }

  private refreshComponentDerived(draft: ComponentDraft): void {
    const { empire } = this.game;
    this.derivedHost.textContent = "";
    const stats = componentStats(draft.kind, draft.params, empire.researched);

    const sec = section(this.derivedHost, "Derived");
    sec.classList.add("two-col");
    for (const [label, value] of stats.lines) stat(sec, label, value);

    const minerals = Object.entries(stats.minerals);
    if (minerals.length) {
      this.derivedHost.append(
        el("p", "muted small",
          `Minerals: ${minerals.map(([m, t]) => `${m} ${num(t ?? 0)}`).join(", ")}`),
      );
    }
  }

  // ------------------------------------------------------- ship designer

  private newClass(): void {
    this.tab = "classes";
    this.classDraft = { id: null, name: "", components: [] };
    this.render();
  }

  private editClass(id: string): void {
    const design = this.game.empire.design(id);
    if (!design) return;
    this.tab = "classes";
    this.classDraft = {
      id,
      name: design.name,
      components: design.components.map((c) => ({ ...c })),
    };
    this.render();
  }

  private draftStats(draft: ClassDraft): DesignStats {
    const { empire } = this.game;
    return designStats(
      { id: "draft", name: draft.name, components: draft.components, created: 0 },
      empire.resolveComponent,
    );
  }

  private renderClassEditor(): void {
    const { empire } = this.game;
    const draft = this.classDraft;

    if (!draft) {
      const body = this.header("Ship Designer", "Assemble designed components into a class");
      emptyNote(
        body,
        empire.componentDesigns.length
          ? "Pick a class on the left to edit it, or create a new one."
          : "Design some components first - a ship is built from them.",
      );
      return;
    }

    const existing = draft.id ? empire.design(draft.id) : undefined;
    const flying = existing
      ? [...empire.ships.values()].filter((s) => s.designId === existing.id).length
      : 0;
    const body = this.header(
      draft.name || "New class",
      existing ? `Ship class${flying ? ` - ${flying} in service` : ""}` : "Ship class - unsaved",
    );

    // --- name
    const nameSec = section(body, "Class");
    const nameInput = el("input", "select name-input");
    nameInput.type = "text";
    nameInput.placeholder = "Class name";
    nameInput.value = draft.name;
    nameInput.addEventListener("input", () => (draft.name = nameInput.value));
    nameSec.append(nameInput);

    // --- derived figures sit above the picker so they stay in view
    body.append(this.derivedHost);
    this.refreshClassDerived(draft);

    // --- component picker
    const used = new Set(draft.components.filter((c) => c.count > 0).map((c) => c.componentId));
    const available = empire.componentDesigns.filter((c) => !c.obsolete || used.has(c.id));

    if (!available.length) {
      emptyNote(body, "No components yet. Design some in the Components tab.");
    }

    for (const kindDef of KINDS) {
      const items = available.filter((c) => c.kind === kindDef.kind);
      if (!items.length) continue;
      const sec = section(body, kindDef.name);
      for (const component of items) sec.append(this.componentRow(draft, component));
    }

    // --- actions
    const actions = el("div", "form-actions");
    const stats = this.draftStats(draft);

    actions.append(
      button(existing ? "Save class" : "Create class", () => {
        const name = draft.name.trim() || "Unnamed Class";
        const components = draft.components.filter((c) => c.count > 0);
        if (!components.length) return;
        if (existing) {
          empire.updateDesign(existing.id, name, components);
        } else {
          const created = empire.addDesign(name, components, this.game.clock.seconds);
          this.classDraft = { id: created.id, name: created.name, components: components.map((c) => ({ ...c })) };
          empire.addLog(
            this.game.clock.seconds,
            "fleet",
            `${created.name} class design completed: ${describeDesign(empire.statsOf(created.id)!)}.`,
          );
        }
        this.game.emit();
      }, "primary-btn"),
    );
    if (existing) {
      actions.append(
        button("Duplicate", () => {
          const copy = empire.addDesign(`${existing.name} Mk II`, draft.components.filter((c) => c.count > 0), this.game.clock.seconds);
          this.classDraft = { id: copy.id, name: copy.name, components: copy.components.map((c) => ({ ...c })) };
          this.game.emit();
        }),
        button(existing.obsolete ? "Restore" : "Mark obsolete", () => {
          empire.setDesignObsolete(existing.id, !existing.obsolete);
          this.game.emit();
        }),
      );
      if (!flying) {
        actions.append(
          button("Delete", () => {
            empire.removeDesign(existing.id);
            this.classDraft = null;
            this.game.emit();
          }),
        );
      }
    }
    actions.append(button("Open Fleets", () => this.actions.openFleets()));
    body.append(actions);
    void stats;
  }

  private componentRow(draft: ClassDraft, component: ComponentDesign): HTMLElement {
    const { empire } = this.game;
    const resolved = empire.resolveComponent(component.id);
    const stats = resolved?.stats;
    const entry = draft.components.find((c) => c.componentId === component.id);
    const count = entry?.count ?? 0;

    const row = el("div", "component-row");
    row.classList.toggle("obsolete", Boolean(component.obsolete));
    const name = el("span", "install-name", component.name);
    name.title = stats ? stats.lines.map(([l, v]) => `${l}: ${v}`).join("\n") : "";
    row.append(name);
    row.append(
      el("span", "muted small", stats ? `${num(stats.tons)} t  ${num(stats.cost)} BP` : ""),
    );
    row.append(el("span", "install-count", num(count)));
    row.append(
      button("-", () => this.adjust(draft, component.id, -1), "step-btn"),
      button("+", () => this.adjust(draft, component.id, 1), "step-btn"),
    );
    return row;
  }

  private adjust(draft: ClassDraft, componentId: string, delta: number): void {
    const entry = draft.components.find((c) => c.componentId === componentId);
    if (entry) entry.count = Math.max(0, entry.count + delta);
    else if (delta > 0) draft.components.push({ componentId, count: delta });
    // Only the derived panel and counts change; the rest of the form stays put.
    this.render();
  }

  private refreshClassDerived(draft: ClassDraft): void {
    const { empire } = this.game;
    this.derivedHost.textContent = "";
    const stats = this.draftStats(draft);

    const sec = section(this.derivedHost, "Derived");
    sec.classList.add("two-col");
    stat(sec, "Tonnage", `${num(stats.tons)} t  (${num(stats.hullSpaces)} HS)`);
    stat(sec, "Speed", `${num(stats.speed)} km/s`, stats.speed <= 0 ? "bad" : undefined);
    stat(sec, "Engine power", num(stats.power));
    stat(sec, "Fuel", `${compact(stats.fuelCapacity)} l`);
    stat(sec, "Burn", `${num(stats.fuelPerHour)} l/hour`);
    stat(sec, "Endurance", stats.enduranceHours > 0 ? `${(stats.enduranceHours / 24).toFixed(1)} days` : "-");
    stat(sec, "Range", `${stats.rangeAu.toFixed(2)} AU`);
    stat(
      sec,
      "Crew",
      `${num(stats.crewRequired)} of ${num(stats.berths)} berths`,
      stats.berths < stats.crewRequired ? "bad" : undefined,
    );
    if (stats.cargoCapacity) stat(sec, "Cargo", `${compact(stats.cargoCapacity)} t`);
    if (stats.colonistCapacity) stat(sec, "Colonists", compact(stats.colonistCapacity));
    if (stats.survey.geological) stat(sec, "Geo survey", `${num(stats.survey.geological)} pts/day`);
    stat(sec, "Build cost", `${num(stats.buildCost)} BP`);
    stat(sec, "Role", describeDesign(stats));

    // The slipway a class needs, against the best the empire has.
    let bestYard = 0;
    let bestName = "";
    for (const colony of empire.colonies.values()) {
      const capacity = shipyardCapacity(colony);
      if (capacity > bestYard) {
        bestYard = capacity;
        bestName = this.game.system.byId.get(colony.bodyId)?.name ?? colony.bodyId;
      }
    }
    stat(
      sec,
      "Needs slipway",
      `${num(stats.tons)} t`,
      stats.tons > bestYard ? "warn" : undefined,
    );
    if (stats.tons > bestYard) {
      this.derivedHost.append(
        el("p", "project-warning",
          bestYard > 0
            ? `The largest slipway is ${num(bestYard)} t at ${bestName}; each shipyard adds 5,000 t. Build more before laying this class down.`
            : "No colony has a shipyard."),
      );
    }

    // One click to berth the crew, since that is the commonest mistake.
    const shortfall = stats.crewRequired - stats.berths;
    if (shortfall > 0) {
      const quarters = empire.componentDesigns.find((c) => c.kind === "crew-quarters" && !c.obsolete);
      const berths = quarters ? empire.resolveComponent(quarters.id)?.stats.berths ?? 0 : 0;
      if (quarters && berths > 0) {
        const needed = Math.ceil(shortfall / berths);
        this.derivedHost.append(
          button(`Add ${needed} x ${quarters.name} to berth the crew`, () => {
            this.adjust(draft, quarters.id, needed);
          }, "ghost-btn"),
        );
      }
    }

    const minerals = Object.entries(stats.minerals);
    if (minerals.length) {
      this.derivedHost.append(
        el("p", "muted small", `Minerals: ${minerals.map(([m, t]) => `${m} ${num(t ?? 0)}`).join(", ")}`),
      );
    }
    for (const problem of stats.problems) {
      if (!problem.startsWith("Crew quarters short")) {
        this.derivedHost.append(el("p", "project-warning", problem));
      }
    }
  }
}
