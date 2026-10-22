/**
 * Fleets view: what is flying, what it is carrying, and what it has been
 * told to do - plus the class designer that produced it.
 *
 * Left is every fleet, centre is the selected fleet's orders or the class
 * being designed, right is the class list and the yard that builds it.
 */

import type { Game } from "../../state/game";
import { installationCount } from "../../state/colony";
import { INSTALLATIONS, INSTALLATION_BY_ID, SHIPYARD_TONS } from "../../sim/economy/installations";
import { shipyardCapacity } from "../../sim/economy/production";
import { previewOrder } from "../../sim/economy/ledger";
import { MINERALS, type MineralName } from "../../sim/minerals";
import {
  CATEGORY_NAMES,
  availableComponents,
  type ComponentCategory,
} from "../../sim/ships/components";
import {
  bestEngine,
  describeDesign,
  designStats,
  starterDesigns,
  type DesignComponent,
} from "../../sim/ships/design";
import {
  cargoTons,
  destinationOf,
  fleetEta,
  fleetStats,
  installationTons,
  type Fleet,
  type FleetOrder,
} from "../../sim/ships/fleet";
import { fullName } from "../../sim/people/officers";
import { compact, el, num } from "../format";
import { button, emptyNote, numberInput, progressBar, section, select, stat } from "../widgets";
import { formatYears } from "./economyView";

type OrderKind = FleetOrder["kind"];

const ORDER_LABELS: Record<OrderKind, string> = {
  move: "Move to",
  "load-installation": "Load installations",
  "unload-installations": "Unload installations",
  "load-colonists": "Load colonists",
  "unload-colonists": "Unload colonists",
  "load-minerals": "Load minerals",
  "unload-minerals": "Unload minerals",
  refuel: "Refuel",
  survey: "Survey this body",
};

export class FleetsView {
  private listPane: HTMLElement;
  private mainPane: HTMLElement;
  private sidePane: HTMLElement;

  private mode: "fleet" | "design" = "fleet";
  private editing: { id: string | null; name: string; components: DesignComponent[] } | null = null;
  private orderKind: OrderKind = "move";
  private orderBody = "";
  private orderInstallation = "infrastructure";
  private orderMineral: MineralName = "Duranium";
  private orderAmount = 1;
  private buildColony = "";
  private buildQuantity = 1;

  constructor(private root: HTMLElement, private game: Game) {
    this.root.classList.add("view-fleets");
    this.listPane = el("aside", "panel panel-left");
    this.mainPane = el("section", "fleet-detail");
    this.sidePane = el("aside", "panel panel-right");
    this.root.append(this.listPane, this.mainPane, this.sidePane);
  }

  render(): void {
    this.renderFleetList();
    if (this.mode === "design") this.renderDesigner();
    else this.renderFleet();
    this.renderClasses();
  }

  // ------------------------------------------------------------ fleet list

  private renderFleetList(): void {
    const { game } = this;
    this.listPane.textContent = "";
    const head = el("div", "panel-head");
    head.append(el("span", undefined, "Fleets"));
    head.append(el("span", "muted", `${game.empire.fleets.size}`));
    this.listPane.append(head);

    const rows = el("div", "tree");
    const fleets = [...game.empire.fleets.values()];
    if (!fleets.length) {
      emptyNote(this.listPane, "No ships yet. Design a class, then lay one down at a shipyard.");
    }

    for (const fleet of fleets) {
      const stats = fleetStats(game.empire, fleet);
      const row = el("div", "tree-row");
      row.classList.toggle("selected", game.selectedFleet === fleet.id);

      const dot = el("span", "dot");
      dot.style.background = stats.speed > 0 ? "#8fd0ff" : "#6a7684";
      row.append(dot, el("span", "tree-name", fleet.name));
      row.append(el("span", "tree-meta", `${stats.ships} ship${stats.ships === 1 ? "" : "s"}`));
      if (fleet.note) {
        const flag = el("span", "colony-flag", "!");
        flag.title = fleet.note;
        row.append(flag);
      }
      row.addEventListener("click", () => {
        game.selectFleet(fleet.id);
        this.mode = "fleet";
        this.render();
      });
      rows.append(row);
    }
    this.listPane.append(rows);
  }

  // ---------------------------------------------------------- fleet detail

  private renderFleet(): void {
    const { game } = this;
    this.mainPane.textContent = "";
    const fleet = game.empire.fleets.get(game.selectedFleet ?? "");
    if (!fleet) {
      emptyNote(this.mainPane, "Select a fleet.");
      return;
    }

    const stats = fleetStats(game.empire, fleet);
    const head = el("div", "detail-head");
    head.append(el("div", "detail-title", fleet.name));
    head.append(el("div", "detail-sub", this.locationOf(fleet)));
    this.mainPane.append(head);

    const body = el("div", "detail-body");
    this.mainPane.append(body);

    if (fleet.note) body.append(el("div", "project-warning", fleet.note));

    const summary = section(body, "Fleet");
    summary.classList.add("two-col");
    stat(summary, "Ships", num(stats.ships));
    stat(summary, "Tonnage", `${num(stats.tons)} t`);
    stat(summary, "Speed", `${num(stats.speed)} km/s`, stats.speed <= 0 ? "bad" : undefined);
    stat(
      summary,
      "Fuel",
      `${compact(stats.fuel)} / ${compact(stats.fuelCapacity)} l`,
      stats.fuel <= 0 ? "bad" : stats.fuel < stats.fuelCapacity * 0.2 ? "warn" : undefined,
    );
    stat(summary, "Range", `${stats.rangeAu.toFixed(2)} AU`);
    stat(summary, "Cargo", `${compact(stats.cargoUsed)} / ${compact(stats.cargoCapacity)} t`);

    this.renderCommander(body, fleet);
    this.renderOrders(body, fleet);
    this.renderCargo(body, fleet, stats.colonistCapacity);
    this.renderShips(body, fleet);
  }

  private locationOf(fleet: Fleet): string {
    const { game } = this;
    if (fleet.anchorId) {
      return `At ${game.system.byId.get(fleet.anchorId)?.name ?? fleet.anchorId}`;
    }
    const destination = destinationOf(fleet);
    if (destination) {
      const eta = fleetEta(game.empire, game.system, fleet);
      const name = game.system.byId.get(destination)?.name ?? destination;
      return eta === null
        ? `Under way to ${name}`
        : `Under way to ${name} - ${formatYears(eta / (365.25 * 86400))}`;
    }
    return "In deep space";
  }

  private renderCommander(parent: HTMLElement, fleet: Fleet): void {
    const { empire } = this.game;
    const sec = section(parent, "Commander");
    const current = empire.officers.get(fleet.commanderId ?? undefined);

    const options = [
      { value: "", label: "- vacant -" },
      ...empire.officers
        .byBranch("navy")
        .filter((o) => !o.assignment || o.assignment.targetId === fleet.id)
        .map((o) => ({
          value: o.id,
          label: `${fullName(o)}  (engineering +${o.skills.engineering ?? 0}%)`,
        })),
    ];
    sec.append(
      select(options, current?.id ?? "", (value) => {
        if (current && value !== current.id) empire.assignOfficer(current.id, null);
        fleet.commanderId = value || null;
        if (value) {
          empire.assignOfficer(value, {
            kind: "fleet",
            targetId: fleet.id,
            since: this.game.clock.seconds,
          });
        }
        this.game.emit();
      }),
    );
    if (current) {
      sec.append(
        el("p", "muted small",
          `Engineering stretches the fuel: this fleet burns ${Math.round(
            (bonusOf(current.skills.engineering) / 2) * 100,
          )}% less under way.`),
      );
    }
  }

  private renderOrders(parent: HTMLElement, fleet: Fleet): void {
    const { game } = this;
    const sec = section(parent, "Orders");

    if (!fleet.orders.length) emptyNote(sec, "No orders. The fleet is holding station.");
    fleet.orders.forEach((order, index) => {
      const row = el("div", "queue-row order-row");
      row.append(el("span", "queue-name", this.describeOrder(order)));
      if (index === 0) row.append(el("span", "chip", "current"));
      row.append(
        button("x", () => {
          fleet.orders.splice(index, 1);
          game.emit();
        }, "step-btn"),
      );
      sec.append(row);
    });

    // --- order builder
    const form = el("div", "add-order");
    form.append(
      select(
        (Object.keys(ORDER_LABELS) as OrderKind[]).map((kind) => ({
          value: kind,
          label: ORDER_LABELS[kind],
        })),
        this.orderKind,
        (value) => {
          this.orderKind = value as OrderKind;
          this.render();
        },
      ),
    );

    if (this.orderKind === "move") {
      const bodies = game.system.bodies.filter((b) => b.cls !== "star" || true);
      if (!bodies.some((b) => b.id === this.orderBody)) {
        this.orderBody = game.empire.capital;
      }
      form.append(
        select(
          bodies.map((b) => ({ value: b.id, label: b.name })),
          this.orderBody,
          (value) => (this.orderBody = value),
        ),
      );
    } else if (this.orderKind === "load-installation") {
      form.append(
        select(
          INSTALLATIONS.map((i) => ({ value: i.id, label: i.name })),
          this.orderInstallation,
          (value) => (this.orderInstallation = value),
        ),
      );
      form.append(numberInput(this.orderAmount, (value) => (this.orderAmount = value), 1, 9999));
    } else if (this.orderKind === "load-minerals") {
      form.append(
        select(
          MINERALS.map((m) => ({ value: m, label: m })),
          this.orderMineral,
          (value) => (this.orderMineral = value as MineralName),
        ),
      );
      form.append(
        numberInput(this.orderAmount, (value) => (this.orderAmount = value), 1, 10_000_000),
      );
    } else if (this.orderKind === "load-colonists") {
      form.append(
        numberInput(this.orderAmount, (value) => (this.orderAmount = value), 1, 10_000_000),
      );
      form.append(el("span", "muted small", "colonists"));
    }

    form.append(
      button(
        "Add order",
        () => {
          const order = this.buildOrder();
          if (order) fleet.orders.push(order);
          game.emit();
        },
        "primary-btn",
      ),
    );
    sec.append(form);

    if (fleet.orders.length) {
      sec.append(
        button("Clear orders", () => {
          fleet.orders = [];
          game.emit();
        }),
      );
    }
  }

  private buildOrder(): FleetOrder | null {
    switch (this.orderKind) {
      case "move": return { kind: "move", bodyId: this.orderBody };
      case "load-installation":
        return {
          kind: "load-installation",
          installationId: this.orderInstallation,
          quantity: this.orderAmount,
        };
      case "load-minerals":
        return { kind: "load-minerals", mineral: this.orderMineral, amount: this.orderAmount };
      case "load-colonists": return { kind: "load-colonists", amount: this.orderAmount };
      case "unload-installations": return { kind: "unload-installations" };
      case "unload-colonists": return { kind: "unload-colonists" };
      case "unload-minerals": return { kind: "unload-minerals" };
      case "refuel": return { kind: "refuel" };
      case "survey": return { kind: "survey" };
      default: return null;
    }
  }

  private describeOrder(order: FleetOrder): string {
    switch (order.kind) {
      case "move":
        return `Move to ${this.game.system.byId.get(order.bodyId)?.name ?? order.bodyId}`;
      case "load-installation":
        return `Load ${num(order.quantity)} ${
          INSTALLATION_BY_ID.get(order.installationId)?.name ?? order.installationId
        }`;
      case "load-minerals":
        return `Load ${num(order.amount)} t ${order.mineral}`;
      case "load-colonists":
        return `Load ${num(order.amount)} colonists`;
      default:
        return ORDER_LABELS[order.kind];
    }
  }

  private renderCargo(parent: HTMLElement, fleet: Fleet, colonistCapacity: number): void {
    const sec = section(parent, "Cargo");
    const entries = Object.entries(fleet.cargo.installations).filter(([, n]) => n > 0);
    const minerals = MINERALS.filter((m) => (fleet.cargo.minerals[m] ?? 0) > 0);

    if (!entries.length && !minerals.length && fleet.cargo.colonists <= 0) {
      emptyNote(sec, "Holds are empty.");
    }
    for (const [id, count] of entries) {
      const row = el("div", "install-row");
      row.append(
        el("span", "install-name", INSTALLATION_BY_ID.get(id)?.name ?? id),
      );
      row.append(el("span", "install-count", `${num(count)}  (${compact(installationTons(id) * count)} t)`));
      sec.append(row);
    }
    for (const mineral of minerals) {
      const row = el("div", "install-row");
      row.append(el("span", "install-name", mineral));
      row.append(el("span", "install-count", `${compact(fleet.cargo.minerals[mineral] ?? 0)} t`));
      sec.append(row);
    }
    if (fleet.cargo.colonists > 0 || colonistCapacity > 0) {
      stat(
        sec,
        "Colonists",
        `${compact(fleet.cargo.colonists)} / ${compact(colonistCapacity)}`,
      );
    }
    if (cargoTons(fleet.cargo) > 0) {
      sec.append(el("p", "muted small", "Cargo is installed the moment it is unloaded at a colony."));
    }
  }

  private renderShips(parent: HTMLElement, fleet: Fleet): void {
    const { empire } = this.game;
    const sec = section(parent, "Ships");
    const others = [...empire.fleets.values()].filter(
      (f) => f.id !== fleet.id && f.anchorId && f.anchorId === fleet.anchorId,
    );

    for (const shipId of fleet.shipIds) {
      const ship = empire.ships.get(shipId);
      if (!ship) continue;
      const design = empire.design(ship.designId);
      const stats = empire.statsOf(ship.designId) ?? null;
      const row = el("div", "install-row");
      row.append(el("span", "install-name", ship.name));
      row.append(
        el("span", "muted small", design ? `${design.name} - ${num(stats?.tons ?? 0)} t` : "unknown class"),
      );
      row.append(
        el("span", "install-count", `${compact(ship.fuel)} l`),
      );
      row.append(
        button("Detach", () => {
          const split = empire.createFleet(`${ship.name} Group`, fleet.position, fleet.anchorId);
          fleet.shipIds = fleet.shipIds.filter((id) => id !== shipId);
          split.shipIds.push(shipId);
          ship.fleetId = split.id;
          this.game.selectFleet(split.id);
          this.game.emit();
        }, "step-btn"),
      );
      sec.append(row);
    }

    if (!fleet.shipIds.length) {
      emptyNote(sec, "No ships in this fleet.");
      sec.append(
        button("Disband", () => {
          empire.disbandFleet(fleet.id);
          this.game.selectFleet(null);
          this.game.emit();
        }),
      );
    }

    if (others.length) {
      const row = el("div", "stat");
      row.append(el("span", "stat-label", "Merge into"));
      row.append(
        select(
          [{ value: "", label: "- choose a fleet -" }, ...others.map((f) => ({ value: f.id, label: f.name }))],
          "",
          (value) => {
            if (!value) return;
            empire.mergeFleets(fleet.id, value);
            this.game.selectFleet(value);
            this.game.emit();
          },
        ),
      );
      sec.append(row);
    }
  }

  // -------------------------------------------------------------- designer

  private renderDesigner(): void {
    const { empire } = this.game;
    this.mainPane.textContent = "";
    const editing = this.editing;
    if (!editing) {
      emptyNote(this.mainPane, "Pick a class to edit, or start a new one.");
      return;
    }

    const head = el("div", "detail-head");
    head.append(el("div", "detail-title", editing.name || "New Class"));
    head.append(el("div", "detail-sub", "Class design"));
    this.mainPane.append(head);

    const body = el("div", "detail-body");
    this.mainPane.append(body);

    const nameRow = el("div", "add-order");
    const nameInput = el("input", "select");
    nameInput.type = "text";
    nameInput.value = editing.name;
    nameInput.placeholder = "Class name";
    nameInput.addEventListener("change", () => (editing.name = nameInput.value));
    nameRow.append(nameInput);
    body.append(nameRow);

    const draft = { id: "draft", name: editing.name, components: editing.components, created: 0 };
    const stats = designStats(draft, empire.researched, empire.stats);

    const figures = section(body, "Derived");
    figures.classList.add("two-col");
    stat(figures, "Tonnage", `${num(stats.tons)} t`);
    stat(figures, "Speed", `${num(stats.speed)} km/s`);
    stat(figures, "Fuel", `${compact(stats.fuelCapacity)} l`);
    stat(figures, "Burn", `${num(stats.fuelPerHour)} l/hour`);
    stat(figures, "Range", `${stats.rangeAu.toFixed(2)} AU`);
    stat(figures, "Crew", `${num(stats.crewRequired)} of ${num(stats.berths)} berths`,
      stats.berths < stats.crewRequired ? "bad" : undefined);
    if (stats.cargoCapacity) stat(figures, "Cargo", `${compact(stats.cargoCapacity)} t`);
    if (stats.colonistCapacity) stat(figures, "Colonists", compact(stats.colonistCapacity));
    stat(figures, "Build Cost", `${num(stats.buildCost)} BP`);
    stat(figures, "Role", describeDesign(stats));

    for (const problem of stats.problems) {
      body.append(el("div", "project-warning", problem));
    }

    const mineralLine = Object.entries(stats.minerals)
      .map(([mineral, tons]) => `${mineral} ${num(tons ?? 0)}`)
      .join(", ");
    body.append(el("p", "muted small", mineralLine ? `Minerals: ${mineralLine}` : ""));

    // --- component picker
    const byCategory = new Map<ComponentCategory, HTMLElement>();
    for (const component of availableComponents(empire.researched)) {
      let host = byCategory.get(component.category);
      if (!host) {
        host = section(body, CATEGORY_NAMES[component.category]);
        byCategory.set(component.category, host);
      }
      const entry = editing.components.find((c) => c.componentId === component.id);
      const count = entry?.count ?? 0;

      const row = el("div", "component-row");
      const name = el("span", "install-name", component.name);
      name.title = component.blurb;
      row.append(name);
      row.append(
        el("span", "muted small", `${num(component.tons)} t  ${num(component.cost)} BP`),
      );
      row.append(el("span", "install-count", num(count)));
      row.append(
        button("-", () => this.adjust(component.id, -1), "step-btn"),
        button("+", () => this.adjust(component.id, 1), "step-btn"),
      );
      host.append(row);
    }

    const actions = el("div", "form-actions");
    actions.append(
      button(
        editing.id ? "Save class" : "Create class",
        () => {
          const name = editing.name.trim() || "Unnamed Class";
          const components = editing.components.filter((c) => c.count > 0);
          if (!components.length) return;
          if (editing.id) {
            empire.updateDesign(editing.id, name, components);
          } else {
            const created = empire.addDesign(name, components, this.game.clock.seconds);
            empire.addLog(
              this.game.clock.seconds,
              "fleet",
              `${created.name} class design completed: ${describeDesign(
                designStats(created, empire.researched, empire.stats),
              )}.`,
            );
          }
          this.editing = null;
          this.mode = "fleet";
          this.game.emit();
        },
        "primary-btn",
      ),
    );
    actions.append(
      button("Cancel", () => {
        this.editing = null;
        this.mode = "fleet";
        this.render();
      }),
    );
    body.append(actions);
  }

  private adjust(componentId: string, delta: number): void {
    const editing = this.editing;
    if (!editing) return;
    const entry = editing.components.find((c) => c.componentId === componentId);
    if (entry) entry.count = Math.max(0, entry.count + delta);
    else if (delta > 0) editing.components.push({ componentId, count: delta });
    this.render();
  }

  // --------------------------------------------------------------- classes

  private renderClasses(): void {
    const { empire } = this.game;
    this.sidePane.textContent = "";
    const head = el("div", "panel-head");
    head.append(el("span", undefined, "Ship Classes"));
    this.sidePane.append(head);

    const body = el("div", "detail-body");
    this.sidePane.append(body);

    const engine = bestEngine(empire.researched);
    if (!engine) {
      emptyNote(
        body,
        "No engine has been researched. Nuclear Thermal Engine Technology is the first one.",
      );
      return;
    }

    const actions = el("div", "template-actions");
    actions.append(
      button("New class", () => {
        this.editing = { id: null, name: "", components: [] };
        this.mode = "design";
        this.render();
      }, "primary-btn"),
    );
    const starters = starterDesigns(empire.researched).filter(
      (s) => !empire.designs.some((d) => d.name === s.name),
    );
    if (starters.length) {
      actions.append(
        button(`Add ${starters.length} standard classes`, () => {
          for (const starter of starters) {
            empire.addDesign(starter.name, starter.components, this.game.clock.seconds);
          }
          this.game.emit();
        }),
      );
    }
    body.append(actions);

    if (!empire.designs.length) {
      emptyNote(body, "No classes yet.");
      return;
    }

    const yards = [...empire.colonies.values()].filter((c) => shipyardCapacity(c) > 0);
    if (!yards.some((c) => c.bodyId === this.buildColony)) {
      this.buildColony = yards[0]?.bodyId ?? "";
    }

    for (const design of empire.designs) {
      const stats = empire.statsOf(design.id)!;
      const card = el("div", "project-card");
      card.append(el("div", "project-name", design.name));
      card.append(el("div", "project-field", describeDesign(stats)));
      card.append(
        el("div", "project-meta",
          `${num(stats.tons)} t  -  ${num(stats.speed)} km/s  -  ${stats.rangeAu.toFixed(1)} AU  -  ${num(stats.buildCost)} BP`),
      );

      const flying = [...empire.ships.values()].filter((s) => s.designId === design.id).length;
      if (flying) card.append(el("div", "muted small", `${flying} in service`));

      for (const problem of stats.problems) {
        card.append(el("div", "project-warning", problem));
      }

      const row = el("div", "project-controls");
      row.append(
        button("Edit", () => {
          this.editing = {
            id: design.id,
            name: design.name,
            components: design.components.map((c) => ({ ...c })),
          };
          this.mode = "design";
          this.render();
        }, "step-btn"),
      );

      if (!stats.problems.length && yards.length) {
        row.append(
          select(
            yards.map((c) => ({
              value: c.bodyId,
              label: this.game.system.byId.get(c.bodyId)?.name ?? c.bodyId,
            })),
            this.buildColony,
            (value) => {
              this.buildColony = value;
              this.render();
            },
          ),
        );
        row.append(numberInput(this.buildQuantity, (value) => (this.buildQuantity = value), 1, 99));
        row.append(
          button("Build", () => {
            empire.queueShip(this.buildColony, design.id, this.buildQuantity);
            this.game.emit();
          }, "primary-btn"),
        );
      }
      card.append(row);

      // A hull that will not fit the slipways never starts.
      const colony = empire.colony(this.buildColony);
      if (colony && stats.tons > shipyardCapacity(colony)) {
        card.append(
          el("div", "project-warning",
            `${this.game.system.byId.get(this.buildColony)?.name} can lay down ${num(
              shipyardCapacity(colony),
            )} t; this class is ${num(stats.tons)} t. Build more shipyards (${num(
              SHIPYARD_TONS,
            )} t each).`),
        );
      } else if (colony) {
        const preview = previewOrder(
          empire,
          this.game.system,
          colony,
          "ship",
          this.buildQuantity,
          undefined,
          design.id,
        );
        if (preview) {
          card.append(
            el("div", "muted small",
              `${num(preview.buildPoints)} BP at ${
                this.game.system.byId.get(colony.bodyId)?.name
              } - ${formatYears(preview.years)}`),
          );
          if (!preview.affordable) {
            card.append(el("div", "project-warning", "Not enough minerals in store."));
          }
        }
      }
      body.append(card);
    }

    const yardNote = section(body, "Shipyards");
    for (const colony of [...empire.colonies.values()]) {
      const yards = installationCount(colony, "shipyard");
      if (!yards) continue;
      stat(
        yardNote,
        this.game.system.byId.get(colony.bodyId)?.name ?? colony.bodyId,
        `${yards} yards - ${num(shipyardCapacity(colony))} t`,
      );
    }
  }
}

function bonusOf(value: number | undefined): number {
  return (value ?? 0) / 100;
}

/** Progress of a hull under construction, for the fleet list. */
export function hullProgress(cost: number, progress: number): HTMLElement {
  return progressBar(cost > 0 ? progress / cost : 0);
}
