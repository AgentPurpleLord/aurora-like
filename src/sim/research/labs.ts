/**
 * Laboratories: how many there are, what they are doing, and who is
 * stopping the idle ones from working.
 *
 * A project's labs are a number the player set, so a newly built laboratory
 * sits idle until someone gives it to a project. With auto-assign on, the
 * production cycle does that: idle labs go to projects at the same colony
 * whose scientists can direct more.
 */

import type { Empire } from "../../state/empire";
import { installationCount } from "../../state/colony";
import { labCapacity } from "../people/officers";
import { TECH_BY_ID } from "./techs";

export interface ColonyLabs {
  colonyId: string;
  built: number;
  /** Labs given to projects (never more than built). */
  working: number;
  idle: number;
  /** Idle labs that a scientist could still take on. */
  absorbable: number;
  /** Why idle labs are idle, in words, or null if none are. */
  blocker: string | null;
}

/** Room a project has for more labs: what its scientist can direct, less what it has. */
export function projectRoom(empire: Empire, projectId: string): number {
  const project = empire.projects.find((p) => p.id === projectId);
  if (!project) return 0;
  const scientist = empire.officers.get(project.scientistId ?? undefined);
  return scientist ? Math.max(0, labCapacity(scientist) - project.labs) : 0;
}

export function labReport(empire: Empire): ColonyLabs[] {
  const out: ColonyLabs[] = [];
  for (const colony of empire.colonies.values()) {
    const built = installationCount(colony, "research-lab");
    if (built <= 0) continue;
    const used = empire.labsInUse(colony.bodyId);
    const working = Math.min(built, used);
    const idle = Math.max(0, built - used);
    const here = empire.projects.filter((p) => p.colonyId === colony.bodyId);
    const room = here.reduce((s, p) => s + projectRoom(empire, p.id), 0);
    let blocker: string | null = null;
    if (idle > 0) {
      if (!here.length) blocker = "No project is running here. Start one, or run a project from another colony's scientists.";
      else if (room <= 0) blocker = "Every scientist here is already directing as many labs as their administration allows. Start another project.";
      else blocker = "Waiting to be assigned.";
    }
    out.push({ colonyId: colony.bodyId, built, working, idle, absorbable: Math.min(idle, room), blocker });
  }
  return out.sort((a, b) => b.built - a.built);
}

export interface Assignment {
  colonyId: string;
  techId: string;
  labs: number;
}

/**
 * Give idle labs to the projects at their colony, fewest labs first, as far
 * as each scientist can direct. Returns what was done.
 */
export function assignIdleLabs(empire: Empire): Assignment[] {
  const done: Assignment[] = [];
  for (const colony of empire.colonies.values()) {
    let idle = installationCount(colony, "research-lab") - empire.labsInUse(colony.bodyId);
    if (idle <= 0) continue;
    const here = empire.projects
      .filter((p) => p.colonyId === colony.bodyId)
      .sort((a, b) => a.labs - b.labs);
    for (const project of here) {
      if (idle <= 0) break;
      const add = Math.min(idle, projectRoom(empire, project.id));
      if (add <= 0) continue;
      project.labs += add;
      idle -= add;
      done.push({ colonyId: colony.bodyId, techId: project.techId, labs: add });
    }
  }
  return done;
}

export function describeAssignment(a: Assignment, colonyName: string): string {
  const tech = TECH_BY_ID.get(a.techId)?.name ?? a.techId;
  return `${a.labs} idle laborator${a.labs === 1 ? "y" : "ies"} on ${colonyName} put to work on ${tech}.`;
}
