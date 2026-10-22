/**
 * Toasts: short-lived notices for things that just happened.
 *
 * They exist so that an event is a doorway, not a line in a log you have to
 * go and find. Clicking one takes you to where it happened.
 */

import type { LogCategory, LogLink } from "../state/empire";
import { el } from "./format";

export interface ToastSpec {
  text: string;
  category: LogCategory | "info";
  link?: LogLink;
  /** Heading shown above the text, e.g. why the clock stopped. */
  title?: string;
  /** A button on the toast, for notices that offer something to do. */
  action?: { label: string; run: () => void };
  /** Milliseconds before it goes away; longer for notices worth reading. */
  lifetime?: number;
}

const MAX_VISIBLE = 4;
const LIFETIME_MS = 8_000;

export class Toasts {
  private host = el("div", "toasts");

  constructor(
    parent: HTMLElement,
    private onOpen: (link: LogLink) => void,
  ) {
    this.host.setAttribute("aria-live", "polite");
    parent.append(this.host);
  }

  push(spec: ToastSpec): void {
    // A burst of identical notices is one notice.
    for (const existing of Array.from(this.host.children) as HTMLElement[]) {
      if (existing.dataset.text === spec.text) existing.remove();
    }

    const toast = el("div", `toast toast-${spec.category}`);
    toast.dataset.text = spec.text;
    if (spec.title) toast.append(el("div", "toast-title", spec.title));
    toast.append(el("div", "toast-text", spec.text));

    if (spec.link) {
      const hint = el("div", "toast-hint", "Click to open");
      toast.append(hint);
      toast.classList.add("clickable");
      toast.addEventListener("click", () => {
        this.onOpen(spec.link!);
        toast.remove();
      });
    }

    if (spec.action) {
      const act = el("button", "toast-action", spec.action.label);
      act.addEventListener("click", (event) => {
        event.stopPropagation();
        toast.remove();
        spec.action!.run();
      });
      toast.append(act);
    }

    const close = el("button", "toast-close", "x");
    close.setAttribute("aria-label", "Dismiss");
    close.addEventListener("click", (event) => {
      event.stopPropagation();
      toast.remove();
    });
    toast.append(close);

    this.host.append(toast);
    while (this.host.children.length > MAX_VISIBLE) this.host.firstElementChild?.remove();
    window.setTimeout(() => toast.remove(), spec.lifetime ?? LIFETIME_MS);
  }

  clear(): void {
    this.host.textContent = "";
  }
}
