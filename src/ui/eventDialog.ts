/** The popup for a random event: what happened, and what you can do about it. */

import type { Game } from "../state/game";
import type { LogLink } from "../state/empire";
import type { GameEvent } from "../sim/events/types";
import { optionsFor, resolveEvent } from "../sim/events/engine";
import { formatShortDate } from "../sim/clock";
import { showDialog, type DialogHandle } from "./dialog";
import { el } from "./format";
import { button } from "./widgets";

const TONE_LABEL = { good: "Good news", bad: "Trouble", neutral: "An opportunity" } as const;
/** The banner the terminal theme shows across the top of a briefing. */
const BANNER = { good: "COMMENDATION", bad: "WARNING", neutral: "ADVISORY" } as const;

/** "event-7" as the file number on a briefing: EVT-0007. */
const fileNumber = (id: string) => `EVT-${id.replace(/\D/g, "").padStart(4, "0")}`;

/**
 * In the terminal theme the briefing text prints out a few characters at a
 * time, like a console receiving it. A click or key shows it all at once, and
 * it is instant under "reduce motion". The full text is always in the page.
 */
function typeOut(node: HTMLElement, full: string): void {
  const terminal = document.documentElement.dataset.theme === "terminal";
  const calm = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  node.textContent = full;
  if (!terminal || calm || full.length < 4) return;

  node.setAttribute("aria-label", full);
  node.textContent = "";
  const cursor = el("span", "event-cursor", "_");
  let shown = 0;
  const finish = () => {
    window.clearInterval(timer);
    node.removeEventListener("click", finish);
    node.textContent = full;
  };
  const timer = window.setInterval(() => {
    shown = Math.min(full.length, shown + 3);
    node.textContent = full.slice(0, shown);
    node.append(cursor);
    if (shown >= full.length) finish();
  }, 14);
  node.addEventListener("click", finish);
}

export function openEventDialog(
  game: Game,
  eventId: string,
  navigate: (link: LogLink) => void,
  onClose?: () => void,
): DialogHandle | null {
  const initial = game.empire.events.find((e) => e.id === eventId);
  if (!initial) return null;
  let result: string | null = null;
  let printed = false;
  let keys: (e: KeyboardEvent) => void = () => {};

  return showDialog(initial.title, (body, handle) => {
    window.removeEventListener("keydown", keys, true);
    const event = game.empire.events.find((e) => e.id === eventId) as GameEvent;
    body.parentElement?.classList.add(`event-${event.tone}`);

    // The banner and file number are for the terminal theme; Classic hides them.
    body.append(el("div", `event-banner ${event.tone}`, BANNER[event.tone]));
    const meta = el("div", "event-meta");
    meta.append(
      el("span", `chip event-chip ${event.tone}`, TONE_LABEL[event.tone]),
      el("span", "muted small", formatShortDate(event.time)),
      el("span", "event-code", fileNumber(event.id)),
    );
    const text = el("p", "event-text");
    body.append(meta, text);
    // The briefing prints out once; the after-action view shows it whole.
    if (event.status === "pending" && !printed) {
      printed = true;
      typeOut(text, event.text);
    } else {
      text.textContent = event.text;
    }
    if (event.follows) body.append(el("p", "muted small", `This follows: ${event.follows}.`));

    // Already settled, or just settled by this dialog: show what came of it.
    if (event.status !== "pending") {
      if (event.chosen) body.append(el("p", "event-chosen", `You chose: ${event.chosen}`));
      body.append(el("div", "event-report-label", "After-action report"));
      body.append(el("p", "event-outcome", result ?? event.outcome ?? ""));
      const foot = el("div", "dialog-foot");
      if (event.link) {
        foot.append(button("Show me", () => {
          handle.close();
          navigate(event.link!);
        }));
      }
      foot.append(button("OK", () => handle.close(), "primary-btn"));
      body.append(foot);
      return;
    }

    const options = el("div", "event-options");
    const available = optionsFor(game.empire, game.galaxy, event, game.clock.seconds);
    const buttons: HTMLButtonElement[] = [];
    available.forEach((option, index) => {
      const choice = el("button", "event-option");
      choice.dataset.key = String(index + 1);
      choice.title = `Press ${index + 1}`;
      buttons.push(choice);
      choice.append(el("span", "event-option-label", option.label));
      if (option.detail) choice.append(el("span", "muted small", option.detail));
      if (option.disabled) {
        choice.disabled = true;
        choice.append(el("span", "project-warning", option.disabled));
      }
      choice.addEventListener("click", () => {
        result = resolveEvent(game.empire, game.galaxy, event.id, option.id, game.clock.seconds);
        game.emit();
        handle.refresh();
      });
      options.append(choice);
    });
    body.append(options);

    // Number keys pick an option, as on a console. The dialog's own handler
    // is replaced on every redraw, so there is only ever one.
    window.removeEventListener("keydown", keys, true);
    keys = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const index = Number(e.key) - 1;
      const target = buttons[index];
      if (target && !target.disabled) {
        e.preventDefault();
        e.stopPropagation();
        target.click();
      }
    };
    window.addEventListener("keydown", keys, true);

    const foot = el("div", "dialog-foot");
    if (event.link) {
      foot.append(button("Look first", () => {
        handle.close();
        navigate(event.link!);
      }));
    }
    foot.append(button("Decide later", () => handle.close()));
    if (event.expires !== undefined) {
      const days = Math.max(0, Math.round((event.expires - game.clock.seconds) / 86_400));
      foot.prepend(el("span", "muted small event-expiry", `Settles itself in ${days} days if left`));
    }
    body.append(foot);
  }, {
    onClose: () => {
      window.removeEventListener("keydown", keys, true);
      onClose?.();
    },
    label: `Event: ${initial.title}`,
  });
}
