/**
 * The fleet automation panel: repeat orders, and standing programmes.
 *
 * Orders are things a fleet does once. A programme is a rule it follows for
 * as long as you leave it - survey everything, run a freight line - writing
 * its own orders as it goes. This panel is where you set one up, see what it
 * is doing, and stop it.
 */

import type { Game } from "../../state/game";
import { INSTALLATIONS } from "../../sim/economy/installations";
import { MINERALS, type MineralName } from "../../sim/minerals";
import { fleetStats, type CargoSpec, type Fleet } from "../../sim/ships/fleet";
import { describeProgram, freightForecast, surveyScope } from "../../sim/ships/programs";
import { compact, el, num } from "../format";
import { button, numberInput, section, select } from "../widgets";

type CargoKind = "none" | "minerals" | "installations" | "colonists";

/** What the player has typed into one direction of the freight form. */
interface CargoDraft {
  kind: CargoKind;
  mineral: MineralName | "all";
  keep: number;
  installationId: string;
  colonists: number;
}

const RANGES: [number, string][] = [
  [0, "The whole system"],
  [2, "Inner system (within 2 AU)"],
  [6, "Out to the asteroid belt and Jupiter (6 AU)"],
  [35, "Out to Neptune (35 AU)"],
];

const emptyDraft = (kind: CargoKind): CargoDraft => ({
  kind, mineral: "all", keep: 1000, installationId: "all", colonists: 5000,
});

export class FleetAutomation {
  private surveyRange = 0;
  private from = "";
  private to = "";
  private there = emptyDraft("minerals");
  private back = emptyDraft("none");

  constructor(
    private game: Game,
    private rerender: () => void,
  ) {}

  /** The repeat switch belongs with the order list. */
  renderRepeat(parent: HTMLElement, fleet: Fleet): void {
    const row = el("label", "check-row repeat-row");
    const box = el("input");
    box.type = "checkbox";
    box.checked = fleet.loop;
    box.addEventListener("change", () => {
      fleet.loop = box.checked;
      this.game.emit();
    });
    const text = el("span");
    text.append(
      el("span", "check-label", "Repeat these orders"),
      el("span", "muted small", "Finished orders go to the back of the queue, so the circuit runs again."),
    );
    row.append(box, text);
    parent.append(row);
  }

  render(parent: HTMLElement, fleet: Fleet): void {
    const sec = section(parent, "Standing programme");
    const nameOf = (id: string) => this.game.system.byId.get(id)?.name ?? id;

    if (fleet.program) {
      this.renderActive(sec, fleet, nameOf);
      return;
    }
    sec.append(
      el(
        "p",
        "muted small",
        "A programme keeps the fleet working without orders: it plans its own moves, refuels, and waits when there is nothing to do.",
      ),
    );
    this.renderSurveyForm(sec, fleet);
    this.renderFreightForm(sec, fleet);
  }

  // ----------------------------------------------------------------- active

  private renderActive(sec: HTMLElement, fleet: Fleet, nameOf: (id: string) => string): void {
    const program = fleet.program!;
    const card = el("div", "program-card");
    card.append(el("div", "program-title", describeProgram(program, nameOf)));
    if (fleet.note) card.append(el("div", "project-warning", fleet.note));
    card.append(el("div", "muted small", fleet.programStatus ?? "Working"));

    if (program.kind === "survey") {
      const scope = surveyScope(this.game.system, program.maxAu);
      const done = scope.filter((b) => this.game.empire.surveyed.has(b.id)).length;
      card.append(el("div", "muted small", `${done} of ${scope.length} bodies surveyed`));
    } else {
      const forecast = freightForecast(this.game.empire, this.game.system, fleet, program.fromId, program.toId);
      if (forecast) {
        card.append(
          el(
            "div",
            "muted small",
            `${forecast.distanceAu.toFixed(2)} AU apart - about ${Math.round(forecast.roundTripDays)} days round trip - up to ${compact(forecast.perYear)} t a year`,
          ),
        );
      }
    }
    card.append(
      button("Stop programme", () => {
        fleet.program = null;
        fleet.programStatus = null;
        fleet.note = null;
        this.game.emit();
      }, "danger-btn"),
    );
    sec.append(card);
  }

  // ----------------------------------------------------------------- survey

  private renderSurveyForm(sec: HTMLElement, fleet: Fleet): void {
    const block = el("div", "program-form");
    block.append(el("h4", undefined, "Survey"));
    const stats = fleetStats(this.game.empire, fleet);

    const pending = (maxAu: number) =>
      surveyScope(this.game.system, maxAu).filter((b) => !this.game.empire.surveyed.has(b.id)).length;

    const row = el("div", "add-order");
    row.append(
      select(
        RANGES.map(([value, label]) => ({ value: String(value), label })),
        String(this.surveyRange),
        (value) => {
          this.surveyRange = Number(value);
          this.rerender();
        },
      ),
    );
    const start = button(
      `Survey ${pending(this.surveyRange)} bodies`,
      () => {
        fleet.program = { kind: "survey", maxAu: this.surveyRange };
        fleet.waitUntil = 0;
        this.game.emit();
      },
      "primary-btn",
    );
    start.disabled = !stats.canSurvey;
    row.append(start);
    block.append(row);
    if (!stats.canSurvey) {
      block.append(el("div", "project-warning", "This fleet has no survey sensors, so it cannot do this yet."));
    } else if (pending(this.surveyRange) === 0) {
      block.append(el("div", "muted small", "Everything in that range is already surveyed."));
    } else {
      block.append(
        el("div", "muted small", "Takes the nearest unsurveyed body each time, refuels at the nearest colony, and goes home when done."),
      );
    }
    sec.append(block);
  }

  // ---------------------------------------------------------------- freight

  private renderFreightForm(sec: HTMLElement, fleet: Fleet): void {
    const { game } = this;
    const colonies = [...game.empire.colonies.keys()];
    const block = el("div", "program-form");
    block.append(el("h4", undefined, "Freight line"));

    if (colonies.length < 2) {
      block.append(el("p", "muted small", "A freight line needs two colonies to run between."));
      sec.append(block);
      return;
    }
    if (!colonies.includes(this.from)) this.from = fleet.anchorId && colonies.includes(fleet.anchorId) ? fleet.anchorId : game.empire.capital;
    if (!colonies.includes(this.to) || this.to === this.from) this.to = colonies.find((c) => c !== this.from) ?? this.from;

    const options = colonies.map((id) => ({ value: id, label: game.system.byId.get(id)?.name ?? id }));
    const route = el("div", "add-order");
    route.append(
      el("span", "muted small", "From"),
      select(options, this.from, (v) => { this.from = v; this.rerender(); }),
      el("span", "muted small", "to"),
      select(options, this.to, (v) => { this.to = v; this.rerender(); }),
    );
    block.append(route);

    this.renderCargoDraft(block, this.there, `Carry from ${game.system.byId.get(this.from)?.name} to ${game.system.byId.get(this.to)?.name}`, false);
    this.renderCargoDraft(block, this.back, "Bring back", true);

    const there = this.specOf(this.there);
    const back = this.specOf(this.back);
    const stats = fleetStats(game.empire, fleet);
    const forecast = freightForecast(game.empire, game.system, fleet, this.from, this.to);

    if (forecast) {
      block.append(
        el(
          "div",
          "muted small",
          `${forecast.distanceAu.toFixed(2)} AU apart - about ${Math.round(forecast.roundTripDays)} days round trip. ` +
          `Hold: ${num(stats.cargoCapacity)} t, people: ${num(stats.colonistCapacity)}.`,
        ),
      );
    }
    const problems: string[] = [];
    if (this.from === this.to) problems.push("Choose two different colonies.");
    if (!there && !back) problems.push("Choose something to carry.");
    if ([there, back].some((s) => s && s.kind !== "colonists") && stats.cargoCapacity <= 0) {
      problems.push("This fleet has no cargo holds.");
    }
    if ([there, back].some((s) => s?.kind === "colonists") && stats.colonistCapacity <= 0) {
      problems.push("This fleet has no colonist berths.");
    }
    for (const problem of problems) block.append(el("div", "project-warning", problem));

    const start = button(
      "Start freight line",
      () => {
        if (problems.length) return;
        fleet.program = { kind: "freight", fromId: this.from, toId: this.to, there, back };
        fleet.waitUntil = 0;
        this.game.emit();
      },
      "primary-btn",
    );
    start.disabled = problems.length > 0;
    block.append(start);
    block.append(
      el("p", "muted small", "The fleet waits at the first colony until there is cargo to take, and refuels at either end."),
    );
    sec.append(block);
  }

  private renderCargoDraft(parent: HTMLElement, draft: CargoDraft, label: string, optional: boolean): void {
    const row = el("div", "add-order cargo-draft");
    row.append(el("span", "cargo-draft-label", label));
    const kinds: [CargoKind, string][] = [
      ["minerals", "Minerals"],
      ["installations", "Stored installations"],
      ["colonists", "Colonists"],
    ];
    if (optional) kinds.unshift(["none", "Nothing"]);
    row.append(
      select(
        kinds.map(([value, text]) => ({ value, label: text })),
        draft.kind,
        (value) => {
          draft.kind = value as CargoKind;
          this.rerender();
        },
      ),
    );

    if (draft.kind === "minerals") {
      row.append(
        select(
          [{ value: "all", label: "Every mineral" }, ...MINERALS.map((m) => ({ value: m, label: m }))],
          draft.mineral,
          (value) => (draft.mineral = value as MineralName | "all"),
        ),
        el("span", "muted small", "leave at least"),
        numberInput(draft.keep, (v) => (draft.keep = v), 0, 100_000_000),
        el("span", "muted small", "t"),
      );
    } else if (draft.kind === "installations") {
      row.append(
        select(
          [{ value: "all", label: "Anything in store" }, ...INSTALLATIONS.map((i) => ({ value: i.id, label: i.name }))],
          draft.installationId,
          (value) => (draft.installationId = value),
        ),
      );
    } else if (draft.kind === "colonists") {
      row.append(
        numberInput(draft.colonists, (v) => (draft.colonists = v), 100, 100_000_000),
        el("span", "muted small", "per trip, at most"),
      );
    }
    parent.append(row);
  }

  private specOf(draft: CargoDraft): CargoSpec | null {
    switch (draft.kind) {
      case "none": return null;
      case "minerals": return { kind: "minerals", mineral: draft.mineral, keep: draft.keep };
      case "installations": return { kind: "installations", installationId: draft.installationId };
      case "colonists": return { kind: "colonists", amount: draft.colonists };
    }
  }
}
