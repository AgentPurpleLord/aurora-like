/** The return digest dialog: what happened since the player last looked. */

import type { Game } from "../state/game";
import type { LogLink } from "../state/empire";
import { buildDigest } from "../sim/digest";
import { formatShortDate } from "../sim/clock";
import { showDialog, type DialogHandle } from "./dialog";
import { compact, el, num, population } from "./format";
import { button } from "./widgets";

const SHOWN_PER_GROUP = 8;

function signed(value: number, text: string): string {
  return `${value > 0 ? "+" : value < 0 ? "-" : ""}${text}`;
}

export function openDigestDialog(
  game: Game,
  navigate: (link: LogLink) => void,
  onClose?: () => void,
): DialogHandle {
  const expanded = new Set<string>();

  return showDialog("While you were away", (body, handle) => {
    const digest = buildDigest(game.empire, game.galaxy, game.clock.seconds);
    const events = digest.groups.reduce((sum, g) => sum + g.entries.length, 0);

    body.append(
      el(
        "p",
        "muted",
        digest.days >= 1 || events
          ? `Since ${formatShortDate(digest.fromTime)} - ${Math.round(digest.days)} days.`
          : "Nothing has happened since you last looked.",
      ),
    );

    // --- the numbers
    const tiles = el("div", "digest-tiles");
    const tile = (label: string, value: string, tone?: "good" | "bad") => {
      const t = el("div", "digest-tile");
      t.append(el("span", "digest-tile-label", label), el("span", `digest-tile-value${tone ? ` ${tone}` : ""}`, value));
      tiles.append(t);
    };
    const d = digest.deltas;
    tile("Treasury", signed(d.treasury, compact(Math.abs(d.treasury))), d.treasury >= 0 ? "good" : "bad");
    tile("Population", signed(d.population, population(Math.abs(d.population))), d.population >= 0 ? "good" : "bad");
    tile("Technologies", signed(d.techs, String(Math.abs(d.techs))));
    tile("Colonies", signed(d.colonies, String(Math.abs(d.colonies))));
    tile("Ships", signed(d.ships, String(Math.abs(d.ships))));
    body.append(tiles);

    // --- what wants a decision
    if (digest.attention.length) {
      const attention = el("div", "digest-attention");
      attention.append(el("h3", undefined, "Needs your attention"));
      for (const issue of digest.attention) {
        const row = el("div", `digest-issue sev-${issue.severity}`);
        const text = el("div", "digest-issue-text");
        text.append(el("div", "digest-issue-title", issue.title), el("div", "muted small", issue.detail));
        row.append(text);
        row.append(
          button(issue.action.label, () => {
            handle.close();
            navigate({ view: issue.action.view, bodyId: issue.action.bodyId });
          }),
        );
        attention.append(row);
      }
      body.append(attention);
    }

    // --- what happened
    if (events) {
      body.append(el("h3", undefined, `What happened (${events})`));
      for (const group of digest.groups) {
        const block = el("div", "digest-group");
        block.append(el("h4", undefined, `${group.label} (${group.entries.length})`));
        const all = expanded.has(group.category);
        const shown = all ? group.entries : group.entries.slice(-SHOWN_PER_GROUP);
        for (const entry of shown) {
          const line = el("div", `digest-line${entry.link ? " clickable" : ""}`);
          line.append(el("span", "digest-date", formatShortDate(entry.time)), el("span", undefined, entry.text));
          if (entry.link) {
            line.addEventListener("click", () => {
              handle.close();
              navigate(entry.link!);
            });
          }
          block.append(line);
        }
        if (group.entries.length > shown.length) {
          block.append(
            button(`Show ${num(group.entries.length - shown.length)} earlier`, () => {
              expanded.add(group.category);
              handle.refresh();
            }),
          );
        }
        body.append(block);
      }
    }
    if (digest.routine) {
      body.append(
        el("p", "muted small", `${num(digest.routine)} routine movements by automated fleets are in the log but not listed here.`),
      );
    }
    if (digest.truncated) {
      body.append(el("p", "muted small", "The log keeps only the most recent events, so the earliest are not shown."));
    }

    const foot = el("div", "dialog-foot");
    foot.append(
      button("Mark as read", () => {
        game.empire.markReviewed(game.clock.seconds);
        handle.close();
        game.emit();
      }, "primary-btn"),
      button("Close", () => handle.close()),
    );
    body.append(foot);
  }, { wide: true, onClose, label: "Digest", terminalTitle: "Situation report" });
}
