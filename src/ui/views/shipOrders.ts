/**
 * Hulls on order: the shipbuilding tasks at a colony, or at every colony,
 * with what Aurora's shipyard screen lets you do to a task - hold it, move it
 * up the queue, change how many, pin it to a yard, or cancel it.
 */

import type { Game } from "../../state/game";
import type { BuildOrder, Colony } from "../../state/colony";
import { colonyOutput } from "../../sim/economy/production";
import { isMilitaryDesign, orderRefund, shipBuildProblem, yardFor } from "../../sim/economy/shipyards";
import { el, num } from "../format";
import { button, emptyNote, progressBar, select } from "../widgets";
import { formatYears } from "./economyView";

export interface ShipOrderOptions {
  /** Show only this colony's orders; otherwise every colony's, with its name. */
  bodyId?: string;
  onChange: () => void;
}

export function shipOrderCount(game: Game, bodyId?: string): number {
  let n = 0;
  for (const colony of game.empire.colonies.values()) {
    if (bodyId && colony.bodyId !== bodyId) continue;
    n += colony.buildQueue.filter((o) => o.designId).length;
  }
  return n;
}

export function renderShipOrders(parent: HTMLElement, game: Game, options: ShipOrderOptions): void {
  const { empire } = game;
  let any = false;
  for (const colony of empire.colonies.values()) {
    if (options.bodyId && colony.bodyId !== options.bodyId) continue;
    for (const order of colony.buildQueue) {
      if (!order.designId) continue;
      any = true;
      parent.append(orderCard(game, colony, order, options));
    }
  }
  if (!any) emptyNote(parent, "No hulls on order.");
}

function orderCard(game: Game, colony: Colony, order: BuildOrder, options: ShipOrderOptions): HTMLElement {
  const { empire } = game;
  const design = empire.design(order.designId);
  const stats = empire.statsOf(order.designId);
  const buildable = empire.buildableOf(order);
  const colonyName = game.galaxy.byId.get(colony.bodyId)?.name ?? colony.bodyId;
  const card = el("div", "event-card order-card");
  card.dataset.order = order.id;
  if (!design || !stats || !buildable) {
    card.append(el("div", "event-title", "A class that no longer exists"));
    card.append(button("Remove", () => { empire.cancelBuild(colony.bodyId, order.id); options.onChange(); }));
    return card;
  }

  const military = isMilitaryDesign(empire, design.id);
  const pinned = order.yardId ? colony.yards.find((y) => y.id === order.yardId) : undefined;
  const problem = shipBuildProblem(empire, colony.bodyId, design.id, order.yardId ?? null);
  const yard = pinned ?? yardFor(colony, stats.tons, military);

  // --- headline and status
  const head = el("div", "event-title");
  head.append(el("span", undefined, `${order.quantity} x ${design.name}${options.bodyId ? "" : ` at ${colonyName}`}`));
  if (order.paused) head.append(el("span", "chip warn", "Paused"));
  else if (problem) head.append(el("span", "chip bad", "Cannot build"));
  else if (order.starved) head.append(el("span", "chip warn", "Short of minerals"));
  else head.append(el("span", "chip good", yard ? `Building at ${yard.name}` : "Building"));
  card.append(head);

  // --- progress on the hull in the slipway, and the whole order
  const unit = buildable.cost > 0 ? Math.min(1, order.progress / buildable.cost) : 0;
  card.append(progressBar(unit));
  const outstanding = Math.max(0, order.quantity * buildable.cost - order.progress);
  const body = game.galaxy.byId.get(colony.bodyId);
  const annual = body ? colonyOutput(empire, body, colony, empire.stats).buildPoints : 0;
  const eta = annual > 0 ? ` - about ${formatYears(outstanding / annual)} for the lot at ${colonyName}'s output` : "";
  card.append(el("div", "muted small",
    `${Math.round(unit * 100)}% of the current hull. ${num(buildable.cost)} BP each, ${num(outstanding)} BP outstanding${eta}.`));
  if (problem) card.append(el("div", "project-warning", problem));

  // --- controls
  const row = el("div", "form-actions");
  const act = (fn: () => void) => () => { fn(); options.onChange(); };
  const label = (text: string) => `${text} ${design.name}`;
  const up = button("Up", act(() => empire.moveOrder(colony.bodyId, order.id, -1)), "ghost-btn");
  up.setAttribute("aria-label", label("Move up"));
  up.title = "Build earlier";
  const down = button("Down", act(() => empire.moveOrder(colony.bodyId, order.id, 1)), "ghost-btn");
  down.setAttribute("aria-label", label("Move down"));
  down.title = "Build later";
  const less = button("-1", act(() => empire.setOrderQuantity(colony.bodyId, order.id, order.quantity - 1)), "ghost-btn");
  less.setAttribute("aria-label", label("One fewer"));
  less.disabled = order.quantity <= 1;
  const more = button("+1", act(() => empire.setOrderQuantity(colony.bodyId, order.id, order.quantity + 1)), "ghost-btn");
  more.setAttribute("aria-label", label("One more"));
  const pause = button(order.paused ? "Resume" : "Pause", act(() => empire.pauseOrder(colony.bodyId, order.id, !order.paused)), "ghost-btn");
  pause.setAttribute("aria-label", label(order.paused ? "Resume" : "Pause"));
  row.append(up, down, less, more, pause);

  const eligible = colony.yards.filter((y) => y.slipways > 0 && (!military || y.kind === "military"));
  if (eligible.length > 1 || order.yardId) {
    const yardSelect = select(
      [{ value: "", label: "Any suitable yard" }, ...colony.yards.map((y) => ({ value: y.id, label: y.name }))],
      order.yardId ?? "",
      (value) => {
        const bad = empire.setOrderYard(colony.bodyId, order.id, value || null);
        if (bad) window.alert(bad);
        options.onChange();
      },
    );
    yardSelect.setAttribute("aria-label", label("Yard for"));
    row.append(yardSelect);
  }

  const cancel = button("Cancel order", () => {
    const refund = orderRefund(empire, order);
    const salvaged = Object.values(refund).reduce((s, v) => s + (v ?? 0), 0);
    if (order.progress > 0) {
      const text = `Cancel ${order.quantity} x ${design.name}? The hull in the slipway is ${Math.round(unit * 100)}% built. ` +
        `Half the minerals used on it (${num(salvaged)} t) are salvaged; the rest, and the build points, are lost.`;
      if (!window.confirm(text)) return;
    }
    empire.cancelBuild(colony.bodyId, order.id);
    options.onChange();
  }, "ghost-btn");
  cancel.setAttribute("aria-label", label("Cancel order for"));
  row.append(cancel);
  card.append(row);
  return card;
}
