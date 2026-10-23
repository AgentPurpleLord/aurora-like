/**
 * Saving and loading.
 *
 * A save is the campaign's state as JSON, wrapped in a small envelope that
 * says what it is, when it was made and what it looked like, so the list of
 * saves can be shown without opening any of them. Everything derived - issues,
 * previews, goals, research statistics, ship figures - is rebuilt on load, so
 * a save made before a rule changed still plays by the new rule.
 *
 * Saves live in the browser's local storage; they can also be exported to a
 * file and imported back, which is the only way to move one between browsers.
 */

import { Game, type GameState } from "./game";
import { formatShortDate } from "../sim/clock";

export const SAVE_VERSION = 1;

export type SaveKind = "auto" | "quick" | "manual";

/** What the list of saves shows. */
export interface SaveMeta {
  id: string;
  name: string;
  kind: SaveKind;
  /** Wall-clock milliseconds. */
  savedAt: number;
  /** Simulation seconds since J2000, for the in-game date. */
  gameTime: number;
  summary: string;
  bytes: number;
}

export interface SaveFile {
  format: "aurora-like";
  version: number;
  meta: Omit<SaveMeta, "bytes">;
  state: GameState;
}

const INDEX_KEY = "aurora-like.saves";
const SLOT_PREFIX = "aurora-like.save.";
const PENDING_KEY = "aurora-like.pending";
/** Autosaves rotate through this many slots, oldest first overwritten. */
export const AUTOSAVE_SLOTS = 4;
export const QUICKSAVE_ID = "quick";

// ------------------------------------------------------------------ envelope

export function summarise(game: Game): string {
  const { empire } = game;
  const people = [...empire.colonies.values()].reduce((sum, c) => sum + c.population, 0);
  const parts = [
    `${empire.colonies.size} ${empire.colonies.size === 1 ? "colony" : "colonies"}`,
    `${people.toFixed(people < 100 ? 1 : 0)} M people`,
    `${empire.researched.size} techs`,
  ];
  if (empire.fleets.size) parts.push(`${empire.ships.size} ships`);
  return parts.join(" - ");
}

export function makeSave(game: Game, id: string, name: string, kind: SaveKind): SaveFile {
  return {
    format: "aurora-like",
    version: SAVE_VERSION,
    meta: {
      id, name, kind,
      savedAt: Date.now(),
      gameTime: game.clock.seconds,
      summary: summarise(game),
    },
    state: game.exportState(),
  };
}

/** Older saves are brought up to date here as the format changes. */
function migrate(file: SaveFile): SaveFile {
  // Version 1 is the first; nothing to do yet.
  return file;
}

/** Parse and sanity-check text that should be a save. Throws a readable error. */
export function parseSave(text: string): SaveFile {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error("That is not a save file (it is not valid JSON).");
  }
  const file = raw as Partial<SaveFile> | null;
  if (!file || file.format !== "aurora-like" || !file.state || !file.meta) {
    throw new Error("That file is not an aurora-like save.");
  }
  if (typeof file.version !== "number" || file.version > SAVE_VERSION) {
    throw new Error("That save was made by a newer version of the game.");
  }
  return migrate(file as SaveFile);
}

/** Build a game from a save. */
export function gameFromSave(file: SaveFile): Game {
  return new Game(file.state.seed, file.state);
}

// ------------------------------------------------------------------- storage

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function readIndex(): SaveMeta[] {
  const store = storage();
  if (!store) return [];
  try {
    const list = JSON.parse(store.getItem(INDEX_KEY) ?? "[]") as SaveMeta[];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function writeIndex(list: SaveMeta[]): void {
  storage()?.setItem(INDEX_KEY, JSON.stringify(list));
}

/** Every save, newest first. */
export function listSaves(): SaveMeta[] {
  return readIndex().sort((a, b) => b.savedAt - a.savedAt);
}

export interface WriteResult {
  ok: boolean;
  error?: string;
  meta?: SaveMeta;
}

export function writeSave(file: SaveFile): WriteResult {
  const store = storage();
  if (!store) return { ok: false, error: "This browser is not letting the game store saves." };
  const text = JSON.stringify(file);
  try {
    store.setItem(SLOT_PREFIX + file.meta.id, text);
  } catch {
    return {
      ok: false,
      error: "The browser's storage is full. Delete an old save or export one to a file.",
    };
  }
  const meta: SaveMeta = { ...file.meta, bytes: text.length };
  try {
    writeIndex([...readIndex().filter((m) => m.id !== meta.id), meta]);
  } catch {
    return { ok: false, error: "The save was written but could not be listed." };
  }
  return { ok: true, meta };
}

export function readSave(id: string): SaveFile | null {
  try {
    const text = storage()?.getItem(SLOT_PREFIX + id);
    return text ? parseSave(text) : null;
  } catch {
    return null;
  }
}

export function deleteSave(id: string): void {
  const store = storage();
  if (!store) return;
  store.removeItem(SLOT_PREFIX + id);
  try {
    writeIndex(readIndex().filter((m) => m.id !== id));
  } catch {
    /* nothing more to do */
  }
}

/** Save under a fresh id. */
export function saveManual(game: Game, name: string): WriteResult {
  const id = `manual-${Date.now().toString(36)}`;
  return writeSave(makeSave(game, id, name.trim() || defaultName(game), "manual"));
}

export function saveQuick(game: Game): WriteResult {
  return writeSave(makeSave(game, QUICKSAVE_ID, "Quicksave", "quick"));
}

/**
 * Write the next autosave in the ring. Returns the result so the caller can
 * tell the player when storage has filled up rather than failing silently.
 */
export function saveAuto(game: Game): WriteResult {
  const autos = readIndex().filter((m) => m.kind === "auto");
  let slot = 1;
  if (autos.length >= AUTOSAVE_SLOTS) {
    // Overwrite the oldest.
    const oldest = [...autos].sort((a, b) => a.savedAt - b.savedAt)[0];
    slot = Number(oldest.id.replace("auto-", "")) || 1;
  } else {
    const used = new Set(autos.map((m) => m.id));
    while (used.has(`auto-${slot}`)) slot++;
  }
  return writeSave(makeSave(game, `auto-${slot}`, "Autosave", "auto"));
}

export function defaultName(game: Game): string {
  return `${formatShortDate(game.clock.seconds)} - ${summarise(game)}`;
}

/** The most recent save of any kind, for "continue". */
export function latestSave(): SaveMeta | undefined {
  return listSaves()[0];
}

// --------------------------------------------------------- loading and files

/**
 * Loading rebuilds the whole interface, so it is done by restarting the page
 * with the chosen save waiting in storage. That is far less error-prone than
 * threading a new game object through every view.
 */
export function requestLoad(id: string): void {
  try {
    window.sessionStorage.setItem(PENDING_KEY, id);
  } catch {
    /* falls back to the latest save on reload */
  }
  window.location.reload();
}

export function requestNewGame(): void {
  try {
    window.sessionStorage.setItem(PENDING_KEY, "new");
  } catch {
    /* ignore */
  }
  window.location.reload();
}

/**
 * Work out which game to start with: whatever a load or new-game request
 * asked for, otherwise the latest save, otherwise a fresh campaign.
 */
export function startingGame(): { game: Game; resumed: SaveMeta | null; error?: string } {
  let pending: string | null = null;
  try {
    pending = window.sessionStorage.getItem(PENDING_KEY);
    window.sessionStorage.removeItem(PENDING_KEY);
  } catch {
    /* ignore */
  }
  const params = new URLSearchParams(window.location.search);
  // A request made in this tab beats the address; `?new` is for a fresh start
  // when nothing was asked for.
  const seed = params.get("seed") ?? freshSeed();
  if (pending === "new" || (!pending && params.has("new"))) return { game: new Game(seed), resumed: null };

  const meta = pending ? listSaves().find((m) => m.id === pending) : latestSave();
  if (!meta) return { game: new Game(seed), resumed: null };
  try {
    const file = readSave(meta.id);
    if (file) return { game: gameFromSave(file), resumed: meta };
  } catch (error) {
    return { game: new Game(seed), resumed: null, error: `Could not read "${meta.name}": ${String(error)}` };
  }
  return { game: new Game(seed), resumed: null, error: `Could not read "${meta.name}".` };
}

/** A new campaign rolls a new galaxy; the seed is kept in saves so it can be rebuilt. */
function freshSeed(): string {
  return `g${Math.floor(Math.random() * 0xffffff).toString(36)}${Date.now().toString(36).slice(-3)}`;
}

export function downloadSave(file: SaveFile): void {
  const blob = new Blob([JSON.stringify(file)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `aurora-like-${file.meta.id}.json`;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Store a save file the player picked and return its id. */
export async function importSaveFile(file: File): Promise<WriteResult> {
  try {
    const parsed = parseSave(await file.text());
    parsed.meta = { ...parsed.meta, id: `import-${Date.now().toString(36)}`, kind: "manual" };
    return writeSave(parsed);
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}
