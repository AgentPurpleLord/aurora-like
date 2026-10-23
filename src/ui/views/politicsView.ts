/**
 * Politics: factions, laws, capital, demands and the next election.
 *
 * The one screen that is never finished with. Support drifts every cycle, laws
 * cost upkeep, demands come with deadlines, and the election is coming.
 */

import type { Game } from "../../state/game";
import {
  COURT_COST, COURT_GAIN, FACTIONS, FUND_GAIN, POLICIES, POLICY_BY_ID, POLICY_SLOTS, REJECT_COST, REJECT_PENALTY, REPEAL_COST,
  WIN_APPROVAL, approval, capitalIncome, capitalUpkeep, courtFaction, demandProgress, enactPolicy, fundFaction, judge,
  moodEffect, moodLabel, rejectDemand, repealPolicy,
} from "../../sim/politics";
import { programmeCost } from "../../sim/economy/finance";
import { formatShortDate } from "../../sim/clock";
import { el, num, themed } from "../format";
import { button, emptyNote, progressBar, section, stat } from "../widgets";

const YEAR = 365.25 * 86_400;

export class PoliticsView {
  /** Why the last action was refused; shown until the next one succeeds. */
  private message: string | null = null;

  constructor(private root: HTMLElement, private game: Game) {
    this.root.classList.add("view-politics");
  }

  render(): void {
    const { empire } = this.game;
    const p = empire.politics;
    const now = this.game.clock.seconds;
    this.root.textContent = "";
    const page = el("div", "events-page politics-page");
    this.root.append(page);

    const act = (fn: () => string | null) => () => {
      this.message = fn();
      this.game.emit();
    };

    // --- header
    const head = el("div", "events-head");
    { const h = el("h2"); h.append(themed("Politics", "Political situation")); head.append(h); }
    const score = approval(p);
    const toGo = (p.nextElection - now) / YEAR;
    head.append(
      el("p", "muted small",
        `Approval ${Math.round(score)}% (${WIN_APPROVAL}% wins). ` +
        (p.nextElection > 0 ? `Next election ${formatShortDate(p.nextElection)}, in ${Math.max(0, toGo).toFixed(1)} years.` : "The first election date is set after the first production cycle.")),
    );
    page.append(head);
    const notice = el("p", "project-warning politics-notice");
    notice.textContent = this.message ?? "";
    notice.hidden = !this.message;
    page.append(notice);

    // --- capital
    const cap = section(page, "Political capital");
    const income = capitalIncome(empire, now);
    const upkeep = capitalUpkeep(p);
    stat(cap, "Capital", p.capital.toFixed(1));
    stat(cap, "Income / yr", `+${income.toFixed(1)}`);
    stat(cap, "Law upkeep / yr", `-${upkeep.toFixed(1)}`, upkeep > income ? "bad" : undefined);
    if (p.caretakerUntil > now) {
      cap.append(el("p", "project-warning", `A caretaker government is in charge until ${formatShortDate(p.caretakerUntil)}: capital income is halved and stability is down 5%.`));
    }
    if (p.lastElection) {
      cap.append(el("p", "muted small",
        `Last election ${formatShortDate(p.lastElection.time)}: ${Math.round(p.lastElection.approval)}% - ${p.lastElection.won ? "won" : "lost"}.`));
    }

    // --- factions
    const facSec = section(page, "Factions");
    for (const def of FACTIONS) {
      const state = p.factions.find((f) => f.id === def.id)!;
      const card = el("div", "event-card politics-faction");
      const title = el("div", "event-title");
      title.append(el("span", undefined, def.name));
      title.append(el("span", `chip ${state.support >= 50 ? "good" : state.support >= 35 ? "warn" : "bad"}`, `${moodLabel(state.support)} ${Math.round(state.support)}`));
      card.append(title);
      card.append(el("div", "muted small", `${def.creed} Influence ${Math.round(state.influence * 100)}%.`));
      card.append(progressBar(state.support / 100));
      const mood = moodEffect(state.support) * Math.min(2, state.influence * FACTIONS.length);
      if (Math.abs(mood) > 0.001) {
        card.append(el("div", `small ${mood > 0 ? "good" : "bad"}`,
          `${mood > 0 ? "+" : ""}${(mood * 100).toFixed(1)}% to ${def.domainText}`));
      }
      const why = judge(empire, def.id, now);
      const list = el("div", "muted small");
      list.textContent = `Heading for ${Math.round(why.target)}: ` +
        why.terms.map((t) => `${t.label} ${t.value >= 0 ? "+" : ""}${t.value.toFixed(0)}`).join(", ");
      card.append(list);

      const row = el("div", "form-actions");
      const court = button(`Court (${COURT_COST} capital)`, act(() => courtFaction(empire, def.id, now)), "ghost-btn");
      court.title = `+${COURT_GAIN} support now; it fades back towards what they think of you.`;
      court.setAttribute("aria-label", `Court ${def.name}`);
      const cost = programmeCost(empire.snapshot.income);
      const fund = button(`Fund (${num(cost)})`, act(() => fundFaction(empire, def.id, cost, now)), "ghost-btn");
      fund.title = `+${FUND_GAIN} support now, paid from the treasury.`;
      fund.setAttribute("aria-label", `Fund ${def.name}`);
      row.append(court, fund);
      card.append(row);
      facSec.append(card);
    }

    // --- demands
    const dem = section(page, `Demands (${p.demands.length})`);
    if (!p.demands.length) emptyNote(dem, "No faction is demanding anything right now. They will.");
    for (const d of p.demands) {
      const name = FACTIONS.find((f) => f.id === d.factionId)!.name;
      const card = el("div", "event-card");
      const left = Math.max(0, (d.deadline - now) / YEAR);
      card.append(el("div", "event-title", `${name}: ${d.label}`));
      const have = demandProgress(empire, d);
      card.append(el("div", "muted small", `Now ${Math.round(have)} of ${d.target}; ${left.toFixed(1)} years left. Meeting it: +15 support and +5 capital. Ignoring it: -12 support.`));
      card.append(progressBar(Math.min(1, Math.max(0, (have - d.baseline) / Math.max(1, d.target - d.baseline)))));
      const reject = button(`Reject (${REJECT_COST} capital, -${REJECT_PENALTY} support)`, act(() => rejectDemand(empire, d.id, now)), "ghost-btn");
      reject.setAttribute("aria-label", `Reject demand: ${d.label}`);
      card.append(reject);
      dem.append(card);
    }

    // --- laws
    const laws = section(page, `Laws (${p.policies.length} of ${POLICY_SLOTS})`);
    for (const entry of p.policies) {
      const def = POLICY_BY_ID.get(entry.id)!;
      const row = el("div", "event-card good");
      row.append(el("div", "event-title", def.name));
      row.append(el("div", "muted small", def.blurb));
      row.append(el("div", "muted small", reaction(def.likes)));
      if (def.maxYears) {
        const left = Math.max(0, def.maxYears - (now - entry.since) / YEAR);
        row.append(el("div", "small warn", `Lapses in ${left.toFixed(1)} years.`));
      }
      const locked = entry.lockedUntil && entry.lockedUntil > now;
      const repeal = button(locked ? "Locked in" : `Repeal (${REPEAL_COST} capital)`, act(() => repealPolicy(empire, def.id, now)), "ghost-btn");
      repeal.disabled = Boolean(locked);
      repeal.setAttribute("aria-label", `Repeal ${def.name}`);
      row.append(repeal);
      laws.append(row);
    }
    const open = POLICIES.filter((d) => !p.policies.some((e) => e.id === d.id));
    for (const def of open) {
      const row = el("div", "event-card neutral");
      row.append(el("div", "event-title", def.name));
      row.append(el("div", "muted small", def.blurb));
      row.append(el("div", "muted small", reaction(def.likes)));
      const enact = button(`Enact (${def.cost} capital)`, act(() => enactPolicy(empire, def.id, now)));
      enact.disabled = p.policies.length >= POLICY_SLOTS || p.capital < def.cost;
      enact.setAttribute("aria-label", `Enact ${def.name}`);
      row.append(enact);
      laws.append(row);
    }
  }
}

function reaction(likes: Partial<Record<string, number>>): string {
  const parts = FACTIONS.filter((f) => likes[f.id]).map((f) => `${f.name} ${likes[f.id]! > 0 ? "+" : ""}${likes[f.id]}`);
  return parts.length ? `Support: ${parts.join(", ")}` : "";
}
