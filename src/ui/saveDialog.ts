/** The save/load dialog: quick slots, named saves, autosaves, files. */

import type { Game } from "../state/game";
import {
  QUICKSAVE_ID,
  defaultName,
  deleteSave,
  downloadSave,
  importSaveFile,
  listSaves,
  makeSave,
  readSave,
  requestLoad,
  requestNewGame,
  saveManual,
  saveQuick,
  type SaveMeta,
} from "../state/save";
import { formatShortDate } from "../sim/clock";
import { showDialog, type DialogHandle } from "./dialog";
import { el } from "./format";
import { button } from "./widgets";

export interface SaveDialogHooks {
  /** Told after anything is written, so the autosave timer can reset. */
  saved(): void;
  toast(text: string): void;
}

function ago(ms: number): string {
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86_400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86_400)} d ago`;
}

function size(bytes: number): string {
  return bytes >= 1e6 ? `${(bytes / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1000))} kB`;
}

export function openSaveDialog(game: Game, hooks: SaveDialogHooks): DialogHandle {
  let message = "";
  let nameDraft = "";

  return showDialog("Save and load", (body, handle) => {
    const say = (text: string) => {
      message = text;
      handle.refresh();
    };

    // --- save now
    const now = el("div", "save-now");
    const name = el("input", "save-name");
    name.type = "text";
    name.placeholder = defaultName(game);
    name.value = nameDraft;
    name.setAttribute("aria-label", "Save name");
    name.addEventListener("input", () => (nameDraft = name.value));
    now.append(name);
    now.append(
      button("Save", () => {
        const result = saveManual(game, nameDraft);
        if (result.ok) {
          nameDraft = "";
          hooks.saved();
          say(`Saved "${result.meta!.name}".`);
        } else say(result.error ?? "Could not save.");
      }, "primary-btn"),
    );
    now.append(
      button("Quicksave", () => {
        const result = saveQuick(game);
        if (result.ok) hooks.saved();
        say(result.ok ? "Quicksaved." : (result.error ?? "Could not save."));
      }),
    );
    body.append(now);
    if (message) body.append(el("div", "save-message", message));

    // --- the list
    const saves = listSaves();
    if (!saves.length) {
      body.append(el("p", "muted", "No saves yet. The game saves itself every couple of minutes."));
    }
    const list = el("div", "save-list");
    for (const meta of saves) list.append(row(meta));
    body.append(list);

    // --- files and new game
    const foot = el("div", "save-foot");
    foot.append(
      button("Export current game to a file", () => {
        downloadSave(makeSave(game, "export", defaultName(game), "manual"));
      }),
    );
    const picker = el("input");
    picker.type = "file";
    picker.accept = ".json,application/json";
    picker.hidden = true;
    picker.addEventListener("change", async () => {
      const file = picker.files?.[0];
      if (!file) return;
      const result = await importSaveFile(file);
      say(result.ok ? `Imported "${result.meta!.name}" - load it from the list.` : (result.error ?? "Import failed."));
    });
    foot.append(picker, button("Import a save file", () => picker.click()));
    foot.append(
      button("New game", () => {
        if (window.confirm("Start a new campaign? Your autosaves and saves are kept; you can load them later.")) {
          requestNewGame();
        }
      }, "danger-btn"),
    );
    body.append(foot);

    function row(meta: SaveMeta): HTMLElement {
      const r = el("div", "save-row");
      const text = el("div", "save-text");
      const title = el("div", "save-title");
      title.append(el("span", "save-name-label", meta.name));
      title.append(el("span", `chip save-kind save-${meta.kind}`, meta.kind === "auto" ? "auto" : meta.kind === "quick" ? "quick" : "saved"));
      text.append(title);
      text.append(
        el("div", "muted small", `${formatShortDate(meta.gameTime)} - ${meta.summary}`),
        el("div", "muted small", `${ago(meta.savedAt)} - ${size(meta.bytes)}`),
      );
      r.append(text);

      const actions = el("div", "save-actions");
      actions.append(
        button("Load", () => {
          if (!readSave(meta.id)) return say("That save could not be read.");
          requestLoad(meta.id);
        }, "primary-btn"),
        button("Export", () => {
          const file = readSave(meta.id);
          if (file) downloadSave(file);
        }),
        button("Delete", () => {
          deleteSave(meta.id);
          handle.refresh();
        }, "ghost-btn"),
      );
      r.append(actions);
      r.dataset.saveId = meta.id;
      if (meta.id === QUICKSAVE_ID) r.classList.add("quick");
      return r;
    }
  }, { label: "Save and load" });
}
