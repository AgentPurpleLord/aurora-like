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

export function openEventDialog(
  game: Game,
  eventId: string,
  navigate: (link: LogLink) => void,
  onClose?: () => void,
): DialogHandle | null {
  const initial = game.empire.events.find((e) => e.id === eventId);
  if (!initial) return null;
  let result: string | null = null;

  return showDialog(initial.title, (body, handle) => {
    const event = game.empire.events.find((e) => e.id === eventId) as GameEvent;
    body.parentElement?.classList.add(`event-${event.tone}`);

    const meta = el("div", "event-meta");
    meta.append(
      el("span", `chip event-chip ${event.tone}`, TONE_LABEL[event.tone]),
      el("span", "muted small", formatShortDate(event.time)),
    );
    body.append(meta, el("p", "event-text", event.text));

    // Already settled, or just settled by this dialog: show what came of it.
    if (event.status !== "pending") {
      if (event.chosen) body.append(el("p", "event-chosen", `You chose: ${event.chosen}`));
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
    for (const option of optionsFor(game.empire, game.galaxy, event, game.clock.seconds)) {
      const choice = el("button", "event-option");
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
    }
    body.append(options);

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
  }, { onClose, label: `Event: ${initial.title}` });
}
