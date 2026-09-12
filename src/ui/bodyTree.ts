/** Left-hand system list: every body in Sol, in orbital order. */

import type { Game } from "../state/game";
import type { Body } from "../sim/system";
import { classLabel } from "../sim/system";
import { distance, el, num } from "./format";
import { AU_KM } from "../sim/orbit";

export class BodyTreePanel {
  private list: HTMLElement;
  private filter = "";
  private rows = new Map<string, HTMLElement>();

  constructor(
    private root: HTMLElement,
    private game: Game,
    private onZoomTo: (body: Body) => void,
  ) {
    const head = el("div", "panel-head");
    head.append(el("span", undefined, "Sol System"));
    const count = el("span", "muted", `${game.system.bodies.length} bodies`);
    head.append(count);
    this.root.append(head);

    const search = el("input", "search");
    search.type = "search";
    search.placeholder = "Filter bodies...";
    search.addEventListener("input", () => {
      this.filter = search.value.trim().toLowerCase();
      this.build();
    });
    this.root.append(search);

    this.list = el("div", "tree");
    this.root.append(this.list);
    this.build();
  }

  /** Rebuild the rows; called on filter changes only. */
  private build(): void {
    this.list.textContent = "";
    this.rows.clear();
    for (const body of this.game.system.tree()) {
      if (this.filter && !body.name.toLowerCase().includes(this.filter)) continue;
      const row = el("div", `tree-row depth-${Math.min(body.depth, 3)}`);
      row.dataset.id = body.id;

      const dot = el("span", "dot");
      dot.style.background = body.def.color;
      row.append(dot);

      row.append(el("span", "tree-name", body.name));

      const meta = el("span", "tree-meta");
      meta.textContent = !body.def.orbit
        ? classLabel(body)
        : body.cls === "moon"
          ? `${num(body.def.orbit.a * AU_KM)} km`
          : distance(body.def.orbit.a);
      row.append(meta);

      if (this.game.empire.colonies.has(body.id)) {
        const flag = el("span", "colony-flag", "C");
        flag.title = "Colony present";
        row.append(flag);
      }

      row.addEventListener("click", () => this.game.select(body));
      row.addEventListener("dblclick", () => this.onZoomTo(body));
      this.list.append(row);
      this.rows.set(body.id, row);
    }
    this.refresh();
  }

  /** Cheap update for selection changes. */
  refresh(): void {
    const selectedId = this.game.selected?.id;
    for (const [id, row] of this.rows) {
      row.classList.toggle("selected", id === selectedId);
    }
    const row = selectedId ? this.rows.get(selectedId) : undefined;
    row?.scrollIntoView({ block: "nearest" });
  }

  /** Colony markers can appear after the tree is built. */
  rebuild(): void {
    this.build();
  }
}
