/**
 * Commanders and specialists.
 *
 * Every officer is a person with a name, an age, a service record and a set
 * of skills; the empire's output depends on who is posted where. Officers
 * enter the pool over time, are promoted, and eventually retire.
 */

import type { Random } from "../rng";
import { RESEARCH_FIELDS, type ResearchField } from "../research/fields";
import { GIVEN_NAMES, SURNAMES } from "./names";
import { DAYS_PER_YEAR, SECONDS_PER_DAY } from "../orbit";

export type Branch = "science" | "civilian" | "navy" | "ground";

export const BRANCH_NAMES: Record<Branch, string> = {
  science: "Scientists",
  civilian: "Administrators",
  navy: "Naval Officers",
  ground: "Ground Officers",
};

export type SkillId =
  | "research"
  | "administration"
  | "production"
  | "mining"
  | "wealth"
  | "populationGrowth"
  | "crewTraining"
  | "tactical"
  | "engineering"
  | "survey"
  | "logistics"
  | "groundCombat"
  | "training";

export const SKILL_LABELS: Record<SkillId, string> = {
  research: "Research",
  administration: "Administration",
  production: "Production",
  mining: "Mining",
  wealth: "Wealth Creation",
  populationGrowth: "Population Growth",
  crewTraining: "Crew Training",
  tactical: "Tactical",
  engineering: "Engineering",
  survey: "Survey",
  logistics: "Logistics",
  groundCombat: "Ground Combat",
  training: "Ground Training",
};

/** Skills expressed as a rating rather than a percentage bonus. */
export const RATING_SKILLS: SkillId[] = ["administration"];

export type AssignmentKind = "research" | "governor" | "fleet";

export interface Assignment {
  kind: AssignmentKind;
  /** Project id, colony (body) id for a governorship, or fleet id. */
  targetId: string;
  since: number;
}

export interface Officer {
  id: string;
  name: string;
  branch: Branch;
  rank: number;
  /** Simulation seconds. */
  born: number;
  commissioned: number;
  lastPromotion: number;
  skills: Partial<Record<SkillId, number>>;
  /** Scientists only. */
  specialty?: ResearchField;
  assignment: Assignment | null;
}

export const RANKS: Record<Branch, string[]> = {
  navy: [
    "Lieutenant", "Lieutenant Commander", "Commander", "Captain",
    "Commodore", "Rear Admiral", "Vice Admiral", "Admiral",
  ],
  ground: [
    "Lieutenant", "Captain", "Major", "Lieutenant Colonel",
    "Colonel", "Brigadier", "Major General", "Lieutenant General",
  ],
  science: ["Doctor", "Senior Researcher", "Professor", "Academician"],
  civilian: ["Administrator", "Senior Administrator", "Commissioner", "Director"],
};

/** Skills each branch can be born with, and the range they roll in. */
const SKILL_TABLE: Record<Branch, { skill: SkillId; min: number; max: number }[]> = {
  science: [
    { skill: "research", min: 5, max: 40 },
    { skill: "administration", min: 1, max: 6 },
  ],
  civilian: [
    { skill: "administration", min: 1, max: 8 },
    { skill: "production", min: -5, max: 30 },
    { skill: "mining", min: -5, max: 30 },
    { skill: "wealth", min: -5, max: 25 },
    { skill: "populationGrowth", min: -5, max: 25 },
  ],
  navy: [
    { skill: "crewTraining", min: 0, max: 30 },
    { skill: "tactical", min: 0, max: 30 },
    { skill: "engineering", min: 0, max: 25 },
    { skill: "survey", min: 0, max: 30 },
    { skill: "logistics", min: 0, max: 20 },
  ],
  ground: [
    { skill: "groundCombat", min: 0, max: 30 },
    { skill: "training", min: 0, max: 25 },
    { skill: "logistics", min: 0, max: 20 },
  ],
};

const YEAR_SECONDS = DAYS_PER_YEAR * SECONDS_PER_DAY;

export function ageOf(officer: Officer, now: number): number {
  return Math.floor((now - officer.born) / YEAR_SECONDS);
}

export function yearsOfService(officer: Officer, now: number): number {
  return (now - officer.commissioned) / YEAR_SECONDS;
}

export function rankTitle(officer: Officer): string {
  return RANKS[officer.branch][Math.min(officer.rank, RANKS[officer.branch].length - 1)];
}

export function fullName(officer: Officer): string {
  return `${rankTitle(officer)} ${officer.name}`;
}

/** The percentage bonus a skill grants, as a multiplier of 1 + x. */
export function bonus(officer: Officer | undefined, skill: SkillId): number {
  if (!officer) return 0;
  return (officer.skills[skill] ?? 0) / 100;
}

/**
 * How many laboratories a scientist can personally direct. Administration is
 * the limiting rating, as it is for a governor's span of control.
 */
export function labCapacity(officer: Officer): number {
  return 5 + (officer.skills.administration ?? 0) * 5;
}

export function generateOfficer(
  rng: Random,
  branch: Branch,
  now: number,
  id: string,
): Officer {
  const skills: Partial<Record<SkillId, number>> = {};
  for (const entry of SKILL_TABLE[branch]) {
    // Most officers are unremarkable; a few are worth building a plan around.
    const roll = Math.round(rng.gaussian((entry.min + entry.max) / 2.6, (entry.max - entry.min) / 4));
    const value = Math.max(entry.min, Math.min(entry.max, roll));
    if (entry.skill === "administration") skills[entry.skill] = Math.max(1, value);
    else if (value !== 0) skills[entry.skill] = value;
  }

  const ageAtCommission = rng.int(24, 34);
  return {
    id,
    name: `${rng.pick(GIVEN_NAMES)} ${rng.pick(SURNAMES)}`,
    branch,
    rank: 0,
    born: now - ageAtCommission * YEAR_SECONDS,
    commissioned: now,
    lastPromotion: now,
    skills,
    specialty: branch === "science" ? rng.pick(RESEARCH_FIELDS) : undefined,
    assignment: null,
  };
}

/**
 * Officers already in service when the campaign opens, so the pool is not
 * uniformly fresh-faced on day one.
 */
export function backdateCareer(officer: Officer, rng: Random, now: number): Officer {
  const years = rng.int(0, 22);
  officer.commissioned = now - years * YEAR_SECONDS;
  officer.born -= years * YEAR_SECONDS;
  officer.rank = Math.min(RANKS[officer.branch].length - 1, Math.floor(years / 6) + rng.int(0, 1));
  officer.lastPromotion = now - rng.int(0, 5) * YEAR_SECONDS;
  return officer;
}

export interface PoolEvent {
  kind: "joined" | "promoted" | "retired";
  officer: Officer;
  text: string;
}

/**
 * The officer corps. Recruitment, promotion and retirement are rolled once
 * per production cycle rather than continuously.
 */
export class OfficerPool {
  readonly officers = new Map<string, Officer>();
  private nextId = 1;

  constructor(private rng: Random) {}

  get list(): Officer[] {
    return [...this.officers.values()];
  }

  byBranch(branch: Branch): Officer[] {
    return this.list.filter((o) => o.branch === branch);
  }

  get(id: string | undefined): Officer | undefined {
    return id ? this.officers.get(id) : undefined;
  }

  add(branch: Branch, now: number): Officer {
    const officer = generateOfficer(this.rng, branch, now, `off-${this.nextId++}`);
    this.officers.set(officer.id, officer);
    return officer;
  }

  /** Starting corps: already serving, with careers of varying length. */
  seed(counts: Record<Branch, number>, now: number): void {
    for (const [branch, count] of Object.entries(counts) as [Branch, number][]) {
      for (let i = 0; i < count; i++) {
        backdateCareer(this.add(branch, now), this.rng, now);
      }
    }
  }

  /**
   * Advance the corps by `years`. `academyRate` is the number of extra
   * officers per year contributed by military academies.
   */
  advance(years: number, now: number, academyRate: number): PoolEvent[] {
    const events: PoolEvent[] = [];
    const expected = (1.5 + academyRate) * years;
    let intake = Math.floor(expected);
    if (this.rng.chance(expected - intake)) intake++;

    for (let i = 0; i < intake; i++) {
      const branch = this.rng.pick<Branch>(["science", "civilian", "navy", "navy", "ground"]);
      const officer = this.add(branch, now);
      events.push({
        kind: "joined",
        officer,
        text: `${fullName(officer)} has entered service${
          officer.specialty ? ` (${officer.specialty})` : ""
        }.`,
      });
    }

    for (const officer of this.list) {
      const age = ageOf(officer, now);

      // Retirement: unlikely before 60, near-certain by 75.
      if (age >= 58) {
        const annual = Math.min(0.5, (age - 57) * 0.03);
        if (this.rng.chance(1 - Math.pow(1 - annual, years))) {
          this.officers.delete(officer.id);
          events.push({
            kind: "retired",
            officer,
            text: `${fullName(officer)} has retired at the age of ${age}.`,
          });
          continue;
        }
      }

      // Promotion: time in rank, nudged by the officer's best skill.
      const maxRank = RANKS[officer.branch].length - 1;
      if (officer.rank < maxRank) {
        const inRank = (now - officer.lastPromotion) / YEAR_SECONDS;
        const best = Math.max(0, ...Object.values(officer.skills));
        if (inRank > 4) {
          const annual = 0.08 + best / 400;
          if (this.rng.chance(1 - Math.pow(1 - annual, years))) {
            officer.rank++;
            officer.lastPromotion = now;
            events.push({
              kind: "promoted",
              officer,
              text: `${officer.name} has been promoted to ${rankTitle(officer)}.`,
            });
          }
        }
      }
    }

    return events;
  }

  /** Clear any posting pointing at a target that no longer exists. */
  unassignTarget(kind: AssignmentKind, targetId: string): void {
    for (const officer of this.officers.values()) {
      if (officer.assignment?.kind === kind && officer.assignment.targetId === targetId) {
        officer.assignment = null;
      }
    }
  }

  assign(officerId: string, assignment: Assignment | null): void {
    const officer = this.officers.get(officerId);
    if (!officer) return;
    if (assignment) {
      // One posting at a time, and one officer per post.
      for (const other of this.officers.values()) {
        if (
          other.id !== officerId &&
          other.assignment?.kind === assignment.kind &&
          other.assignment.targetId === assignment.targetId
        ) {
          other.assignment = null;
        }
      }
    }
    officer.assignment = assignment;
  }

  /** The officer holding a given post, if any. */
  holderOf(kind: AssignmentKind, targetId: string): Officer | undefined {
    return this.list.find(
      (o) => o.assignment?.kind === kind && o.assignment.targetId === targetId,
    );
  }
}
