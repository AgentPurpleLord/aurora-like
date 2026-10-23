/**
 * The galaxy map: the real stars around Sol, and the jump network between
 * the ones you have charted.
 *
 * Every star's name and position is known - astronomers have catalogued them
 * - but what lies around a star is not known until a ship has been there, and
 * which stars connect to which is not known until jump points are found and
 * crossed. So the map shows the sky in dim ink and your own explorations in
 * bright: visited systems, the links you have crossed, the gates you have
 * built, and stubs for jump points found but not yet followed.
 *
 * Distances from Sol are compressed (the farthest star is ten times the
 * nearest) so the neighbours are not all piled on the centre.
 */

import type { Game } from "../../state/game";
import type { StarSystem } from "../../sim/system";
import { describeAtmosphere } from "../../sim/atmosphere";
import { jumpCounts, visibleBodies } from "../../sim/exploration";
import { classLabel } from "../../sim/system";
import { el, num } from "../format";
import { button } from "../widgets";

const SVG_NS = "http://www.w3.org/2000/svg";
const VIEW = 520;
const CENTRE = VIEW / 2;
const RADIUS = 232;
const MAX_LY = 42;

function svg<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
  return node;
}

export class GalaxyView {
  private map = el("section", "galaxy-map");
  private side = el("aside", "panel panel-right galaxy-side");
  private selected = "sol";

  constructor(
    private root: HTMLElement,
    private game: Game,
    private actions: { openSystem: (systemId: string) => void; openFleet: (fleetId: string) => void; showView: () => void },
  ) {
    this.root.classList.add("view-galaxy");
    this.root.append(this.map, this.side);
  }

  /** Where a system sits on the page: direction true, distance compressed. */
  private place(system: StarSystem): { x: number; y: number } {
    const { x, y } = system.meta.position;
    const d = Math.hypot(x, y);
    if (d < 1e-9) return { x: CENTRE, y: CENTRE };
    const r = RADIUS * Math.pow(Math.min(1, d / MAX_LY), 0.55);
    return { x: CENTRE + (x / d) * r, y: CENTRE - (y / d) * r };
  }

  /**
   * Positions for every system, nudged apart where real stars share a line of
   * sight (Alpha Centauri and Proxima are a fifth of a light year apart), so
   * each can be read and clicked. Sol stays at the centre.
   */
  private layout(): Map<string, { x: number; y: number }> {
    const positions = new Map(this.game.galaxy.systems.map((s) => [s.id, this.place(s)]));
    const ids = [...positions.keys()];
    const MIN = 54;
    for (let pass = 0; pass < 80; pass++) {
      let moved = false;
      for (let i = 0; i < ids.length; i++) {
        for (let j = i + 1; j < ids.length; j++) {
          const a = positions.get(ids[i])!;
          const b = positions.get(ids[j])!;
          let dx = b.x - a.x;
          let dy = b.y - a.y;
          let d = Math.hypot(dx, dy);
          if (d >= MIN) continue;
          if (d < 0.01) {
            dx = 1; dy = 0.3; d = Math.hypot(dx, dy);
          }
          const push = (MIN - d) / 2;
          const ux = dx / d;
          const uy = dy / d;
          const aFixed = ids[i] === "sol";
          const bFixed = ids[j] === "sol";
          if (!aFixed) { a.x -= ux * (bFixed ? push * 2 : push); a.y -= uy * (bFixed ? push * 2 : push); }
          if (!bFixed) { b.x += ux * (aFixed ? push * 2 : push); b.y += uy * (aFixed ? push * 2 : push); }
          moved = true;
        }
      }
      if (!moved) break;
    }
    return positions;
  }

  /** Select a system and show the galaxy map. */
  show(systemId: string): void {
    this.selected = systemId;
    this.actions.showView();
  }

  render(): void {
    this.renderMap();
    this.renderSide();
  }

  private renderMap(): void {
    const { game } = this;
    const { empire, galaxy } = game;
    this.map.textContent = "";

    const head = el("div", "galaxy-head");
    head.append(
      el("h2", undefined, "The neighbourhood"),
      el(
        "p",
        "muted small",
        `${empire.knownSystems.size} of ${galaxy.systems.length} systems visited. Names and positions are real; what orbits each star is a mystery until you go there. Distance from Sol is compressed.`,
      ),
    );
    this.map.append(head);

    const canvas = svg("svg", { viewBox: `0 0 ${VIEW} ${VIEW}`, class: "galaxy-svg", role: "group", "aria-label": "Galaxy map" });

    // distance rings
    for (const ly of [5, 10, 20, 40]) {
      const r = RADIUS * Math.pow(ly / MAX_LY, 0.55);
      canvas.append(svg("circle", { cx: CENTRE, cy: CENTRE, r, class: "galaxy-ring" }));
      const label = svg("text", { x: CENTRE + r * 0.7071 + 3, y: CENTRE - r * 0.7071 - 3, class: "galaxy-ring-label" });
      label.textContent = `${ly} ly`;
      canvas.append(label);
    }

    const positions = this.layout();

    // links you have crossed
    const drawn = new Set<string>();
    for (const link of galaxy.links) {
      const a = galaxy.byId.get(link.a)!;
      const b = galaxy.byId.get(link.b)!;
      if (!empire.exploredJumpPoints.has(a.id)) continue;
      const key = [a.systemId, b.systemId].sort().join("|") + link.a;
      if (drawn.has(key)) continue;
      drawn.add(key);
      const pa = positions.get(a.systemId)!;
      const pb = positions.get(b.systemId)!;
      const gated = empire.gates.has(a.id);
      const line = svg("line", { x1: pa.x, y1: pa.y, x2: pb.x, y2: pb.y, class: `galaxy-link${gated ? " gate" : ""}` });
      line.dataset.link = `${a.systemId}-${b.systemId}`;
      canvas.append(line);
    }

    // jump points found but not followed: a short stub pointing nowhere in particular
    for (const system of galaxy.systems) {
      if (!empire.knownSystems.has(system.id)) continue;
      const p = positions.get(system.id)!;
      const open = galaxy.jumpPointsIn(system.id).filter(
        (jp) => empire.knownJumpPoints.has(jp.id) && !empire.exploredJumpPoints.has(jp.id),
      );
      open.forEach((_jp, i) => {
        const angle = (i / Math.max(1, open.length)) * Math.PI * 2 + 0.6;
        const stub = svg("line", {
          x1: p.x, y1: p.y,
          x2: p.x + Math.cos(angle) * 26, y2: p.y + Math.sin(angle) * 26,
          class: "galaxy-stub",
        });
        const tip = svg("text", { x: p.x + Math.cos(angle) * 32, y: p.y + Math.sin(angle) * 32 + 3, class: "galaxy-stub-label" });
        tip.textContent = "?";
        canvas.append(stub, tip);
      });
    }

    // fleets per system
    const fleetsAt = new Map<string, number>();
    for (const fleet of empire.fleets.values()) fleetsAt.set(fleet.systemId, (fleetsAt.get(fleet.systemId) ?? 0) + 1);

    for (const system of galaxy.systems) {
      const p = positions.get(system.id)!;
      const known = empire.knownSystems.has(system.id);
      const radius = 4 + Math.min(7, Math.log10(1 + system.meta.lumSol * 10) * 3.2);
      const group = svg("g", {
        class: `galaxy-node${known ? " known" : ""}${this.selected === system.id ? " selected" : ""}`,
        tabindex: 0,
        role: "button",
        "aria-label": `System ${system.name}`,
        transform: `translate(${p.x} ${p.y})`,
      });
      group.dataset.system = system.id;

      const colonies = [...empire.colonies.keys()].filter((id) => galaxy.byId.get(id)?.systemId === system.id).length;
      if (colonies) group.append(svg("circle", { r: radius + 6, class: "galaxy-colony" }));
      group.append(svg("circle", { r: radius, fill: system.meta.color, class: "galaxy-star" }));

      const label = svg("text", { x: radius + 6, y: 4, class: "galaxy-label" });
      label.textContent = system.name;
      group.append(label);
      const fleets = fleetsAt.get(system.id);
      if (fleets) {
        const badge = svg("text", { x: radius + 6, y: 17, class: "galaxy-fleets" });
        badge.textContent = `${fleets} fleet${fleets === 1 ? "" : "s"}`;
        group.append(badge);
      }

      const pick = () => {
        this.selected = system.id;
        this.render();
      };
      group.addEventListener("click", pick);
      group.addEventListener("dblclick", () => {
        if (known) this.actions.openSystem(system.id);
      });
      group.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          pick();
        }
      });
      canvas.append(group);
    }
    this.map.append(canvas);

    const legend = el("div", "galaxy-legend muted small");
    legend.append(
      "Bright: visited. Dim: charted by astronomers only. Cyan line: a crossed jump point. Green line: a gate. ? : a jump point found but not followed.",
    );
    this.map.append(legend);
  }

  private renderSide(): void {
    const { game } = this;
    const { empire, galaxy } = game;
    this.side.textContent = "";
    const system = galaxy.systemById.get(this.selected) ?? galaxy.sol;
    const known = empire.knownSystems.has(system.id);

    const head = el("div", "panel-head");
    head.append(el("span", undefined, system.name));
    head.append(el("span", "muted", system.meta.spectral));
    this.side.append(head);

    const body = el("div", "detail-body");
    this.side.append(body);

    const facts = el("div", "section");
    facts.append(el("h3", undefined, "Star"));
    const stat = (label: string, value: string) => {
      const row = el("div", "stat");
      row.append(el("span", "stat-label", label), el("span", "stat-value", value));
      facts.append(row);
    };
    stat("Distance from Sol", system.id === "sol" ? "-" : `${system.meta.distanceLy} ly`);
    stat("Mass", `${system.meta.massSol} Sol`);
    stat("Luminosity", `${system.meta.lumSol} Sol`);
    body.append(facts);
    body.append(el("p", "notes", system.meta.blurb));

    if (!known) {
      body.append(
        el(
          "p",
          "muted",
          "Not yet visited. A ship has to reach it through the jump network: find the jump points around the systems you know, and cross them.",
        ),
      );
      return;
    }

    const found = jumpCounts(empire, galaxy, system.id);
    const jumps = el("div", "section");
    jumps.append(el("h3", undefined, "Jump points"));
    jumps.append(
      el("p", "muted small", `${found.found} of ${found.total} found${found.found < found.total ? " - a gravitational survey finds the rest" : ""}.`),
    );
    for (const jp of galaxy.jumpPointsIn(system.id).filter((b) => empire.knownJumpPoints.has(b.id))) {
      const far = galaxy.otherEnd(jp.id);
      const explored = empire.exploredJumpPoints.has(jp.id);
      const row = el("div", "queue-row");
      row.append(
        el("span", "queue-name", `${jp.name}${explored && far ? ` - to ${galaxy.systemById.get(far.systemId)?.name}` : " - unexplored"}`),
      );
      if (empire.gates.has(jp.id)) row.append(el("span", "chip", "gate"));
      jumps.append(row);
    }
    body.append(jumps);

    const worlds = el("div", "section");
    const planets = visibleBodies(empire, galaxy, system.id).filter((b) => b.cls === "planet");
    worlds.append(el("h3", undefined, `Planets (${planets.length})`));
    for (const planet of planets) {
      const row = el("div", "queue-row galaxy-planet");
      const colony = empire.colonies.has(planet.id);
      row.append(
        el("span", "queue-name", `${planet.name}${planet.def.detected ? " *" : ""}`),
        el("span", "muted small",
          `${classLabel(planet)} - ${Math.round(planet.tempK)} K - ${Number.isFinite(planet.colonyCost) ? `cost ${planet.colonyCost}` : "no surface"}${colony ? " - colony" : ""}`),
      );
      row.title = describeAtmosphere(planet.atmosphere);
      worlds.append(row);
    }
    if (planets.some((p) => p.def.detected)) {
      worlds.append(el("p", "muted small", "* detected by astronomers; mass and orbit are measured, the rest was found by survey."));
    }
    body.append(worlds);

    const here = [...empire.fleets.values()].filter((f) => f.systemId === system.id);
    if (here.length) {
      const fleets = el("div", "section");
      fleets.append(el("h3", undefined, `Fleets here (${here.length})`));
      for (const fleet of here) {
        const row = el("div", "queue-row");
        row.append(el("span", "queue-name", `${fleet.name} - ${num(fleet.shipIds.length)} ships`));
        row.append(button("Open", () => this.actions.openFleet(fleet.id)));
        fleets.append(row);
      }
      body.append(fleets);
    }

    body.append(button("Open in the system map", () => this.actions.openSystem(system.id), "primary-btn"));
  }
}
