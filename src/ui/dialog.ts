/**
 * A modal dialog: a titled card over a dimmed screen that closes on Escape or
 * a click outside it. Used for the things that deserve the whole screen for a
 * moment - saves, the return digest - without becoming a permanent view.
 */

import { el } from "./format";

export interface DialogHandle {
  readonly body: HTMLElement;
  close(): void;
  /** Rebuild the body, keeping the frame (and focus) in place. */
  refresh(): void;
}

let openDialog: DialogHandle | null = null;

export function showDialog(
  title: string,
  build: (body: HTMLElement, handle: DialogHandle) => void,
  options: { wide?: boolean; onClose?: () => void; label?: string } = {},
): DialogHandle {
  openDialog?.close();

  const overlay = el("div", "dialog-overlay open");
  const card = el("div", `dialog${options.wide ? " wide" : ""}`);
  card.setAttribute("role", "dialog");
  card.setAttribute("aria-modal", "true");
  card.setAttribute("aria-label", options.label ?? title);

  const head = el("div", "dialog-head");
  head.append(el("h2", "dialog-title", title));
  const closeButton = el("button", "icon-btn", "Close");
  closeButton.setAttribute("aria-label", `Close ${options.label ?? title}`);
  head.append(closeButton);

  const body = el("div", "dialog-body");
  card.append(head, body);
  overlay.append(card);

  const onKey = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      event.stopPropagation();
      handle.close();
    }
  };

  const handle: DialogHandle = {
    body,
    close() {
      if (!overlay.isConnected) return;
      overlay.remove();
      window.removeEventListener("keydown", onKey, true);
      if (openDialog === handle) openDialog = null;
      options.onClose?.();
    },
    refresh() {
      body.textContent = "";
      build(body, handle);
    },
  };

  closeButton.addEventListener("click", () => handle.close());
  overlay.addEventListener("mousedown", (event) => {
    if (event.target === overlay) handle.close();
  });
  window.addEventListener("keydown", onKey, true);

  document.getElementById("app")!.append(overlay);
  openDialog = handle;
  build(body, handle);
  closeButton.focus();
  return handle;
}

export function closeDialog(): void {
  openDialog?.close();
}

export function dialogOpen(): boolean {
  return openDialog !== null;
}
