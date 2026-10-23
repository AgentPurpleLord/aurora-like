/**
 * Economy view: the colony's books.
 *
 * Left is the colony list, centre is the selected colony - industry, mining,
 * stockpile and the build queue - and right is the empire summary and the
 * event log.
 */

import {
  MAX_NEW_SLIPWAYS, MILITARY_YARD_COST, YARD_KIND_BLURB, YARD_KIND_NAMES, abandonYard, addSlipways, canBuildMilitary,
  convertYard, createYard, isMilitaryDesign, pendingSlipways, syncYards, yardFor, yardLimit, type YardKind,
} from "../../sim/economy/shipyards";
import { SHIPYARD_TONS } from "../../sim/economy/installations";
import { FACTIONS } from "../../sim/politics";
import { GOODS, POP_BY_ID, computeMarket, fertility, popStability } from "../../sim/economy/goods";
import { stabilityLabel, stabilityTarget } from "../../sim/economy/finance";
import { formatShortDate } from "../../sim/clock";
import type { Game } from "../../state/game";
import type { Body } from "../../sim/system";
import { classLabel } from "../../sim/system";
import { settleBlocker } from "../../sim/exploration";
import { servicingCapacity } from "../../sim/ships/maintenance";
import { fleetStats } from "../../sim/ships/fleet";
import type { Colony } from "../../state/colony";
import { installationCount } from "../../state/colony";
import {
  CATEGORY_NAMES,
  INSTALLATIONS,
  INSTALLATION_BY_ID,
  type InstallationCategory,
} from "../../sim/economy/installations";
import {
  colonyOutput,
  effectiveColonyCost,
  migrationInflow,
  populationCapacity,
  shipyardCapacity,
  terraformOutlook,
  terraformRate,
} from "../../sim/economy/production";
import { MINERALS } from "../../sim/minerals";
import { GASES, GAS_BY_ID, maxPressureFor, totalPressure } from "../../sim/atmosphere";
import { previewItems, previewOrder, type OrderPreview } from "../../sim/economy/ledger";
import { activeIssues, type Issue } from "../../sim/issues";
import { hintFor } from "../glossary";
import { saveSettings, settings } from "../settings";
import {
  resolveTemplate,
  templateFromQueue,
  templateIsApplicable,
} from "../../sim/economy/templates";
import {
  describeRule,
  shortfallFor,
} from "../../sim/economy/standingOrders";
import { POLICY_BLURBS, POLICY_NAMES, type GovernorPolicy } from "../../sim/governors";
import { fullName, type Officer } from "../../sim/people/officers";
import { compact, describeEffect, el, formatPressure, num, population } from "../format";
import { button, emptyNote, numberInput, progressBar, section, select, stat } from "../widgets";

export class EconomyView {
  private list: HTMLElement;
  private detail: HTMLElement;
  private orderInstallation = "automated-mine";
  private orderQuantity = 1;
  private orderDestination = "";
  /** Rebuilt in place as the order is edited, so the preview tracks the form. */
  private previewHost = el("div", "preview-host");
  private templateHost = el("div", "preview-host");
  private templateId = "mining-outpost";
  private templateSource = "";
  private ruleKind: "maintain" | "infrastructure" = "infrastructure";
  private ruleInstallation = "automated-mine";
  private ruleTarget = 20;
  private ruleHeadroom = 25;
  private terraformGas = "nitrous-oxide";
  private terraformMode: "add" | "remove" = "add";

  constructor(private root: HTMLElement, private game: Game) {
    this.root.classList.add("view-colonies");
    this.list = el("aside", "panel panel-left");
    this.detail = el("section", "colony-detail");
    this.root.append(this.list, this.detail);
  }

  render(): void {
    this.renderColonyList();
    this.renderColony();
  }

  // ------------------------------------------------------------- colonies

  private renderColonyList(): void {
    const { game } = this;
    this.list.textContent = "";
    const head = el("div", "panel-head");
    head.append(el("span", undefined, "Colonies"));
    head.append(el("span", "muted", `${game.empire.colonies.size}`));
    this.list.append(head);

    const rows = el("div", "tree");
    for (const colony of game.empire.colonies.values()) {
      const body = game.galaxy.byId.get(colony.bodyId);
      if (!body) continue;
      const row = el("div", "tree-row");
      row.classList.toggle("selected", game.selected?.id === body.id);

      const dot = el("span", "dot");
      dot.style.background = body.def.color;
      row.append(dot, el("span", "tree-name", body.name));
      row.append(el("span", "tree-meta", population(colony.population)));
      if (colony.buildQueue.length) {
        const flag = el("span", "colony-flag", "B");
        flag.title = `${colony.buildQueue.length} item(s) in the build queue`;
        row.append(flag);
      }
      row.addEventListener("click", () => game.select(body));
      rows.append(row);
    }
    this.list.append(rows);
  }

  private renderColony(): void {
    const { game } = this;
    this.detail.textContent = "";

    const body = game.selected;
    if (!body) {
      emptyNote(this.detail, "Select a colony.");
      return;
    }
    const colony = game.empire.colony(body.id);
    if (!colony) {
      this.renderNoColony(body);
      return;
    }

    const { empire } = game;
    const stats = empire.stats;
    const output = colonyOutput(empire, body, colony, stats);
    const cost = effectiveColonyCost(body, stats);
    const capacity = populationCapacity(body, colony, stats);

    // --- the header: who this is, how it is doing, and the tabs. It sits
    // outside the scrolling body, so it is always in view.
    const head = el("div", "detail-head colony-head");
    const title = el("div", "detail-title", body.name);
    const dot = el("span", "dot big");
    dot.style.background = body.def.color;
    title.prepend(dot);
    head.append(title);
    head.append(
      el("div", "detail-sub", `${classLabel(body)} - settled ${formatShortDate(colony.founded)}`),
    );

    const vitals = el("div", "vitals");
    const vital = (label: string, value: string, tone?: string, note?: string) => {
      const item = el("div", "vital");
      item.append(el("span", "vital-label", label));
      item.append(el("span", `vital-value${tone ? ` ${tone}` : ""}`, value));
      if (note) item.append(el("span", `vital-note ${tone ?? ""}`.trim(), note));
      const hint = hintFor(label);
      if (hint) item.title = hint;
      vitals.append(item);
    };
    vital(
      "Population",
      population(colony.population),
      undefined,
      `${output.populationGrowth >= 0 ? "+" : ""}${population(output.populationGrowth)}/yr`,
    );
    vital("Colony Cost", cost.toFixed(2), cost <= 0 ? "good" : undefined, `${body.tempK.toFixed(0)} K`);
    vital(
      "Staffed",
      `${Math.round(output.employment * 100)}%`,
      output.employment < 0.95 ? "warn" : undefined,
    );
    vital("BP/yr", num(output.buildPoints), empire.austerity ? "bad" : undefined);
    vital("Mining t/yr", num(Object.values(output.mining).reduce((n, v) => n + (v ?? 0), 0)));
    vital("Wealth/yr", num(output.wealth));
    head.append(vitals);

    const alerts = this.alertsFor(colony.bodyId);
    const terraformAvailable =
      empire.stats.unlocked.has("terraforming") || installationCount(colony, "terraforming") > 0;
    const tabs: { id: string; label: string; badge?: string }[] = [
      { id: "overview", label: "Overview", badge: alerts.length ? String(alerts.length) : undefined },
      { id: "production", label: "Production", badge: colony.buildQueue.length ? String(colony.buildQueue.length) : undefined },
      { id: "people", label: "People", badge: colony.starving ? "!" : undefined },
      { id: "yards", label: "Shipyards", badge: colony.yards.length ? String(colony.yards.length) : undefined },
      { id: "mining", label: "Mining & stores" },
      ...(terraformAvailable ? [{ id: "terraform", label: "Terraforming" }] : []),
      { id: "automation", label: "Automation", badge: colony.policy !== "none" || empire.standingOrdersFor(colony.bodyId).length ? "on" : undefined },
    ];
    if (!tabs.some((t) => t.id === settings.colonyTab)) settings.colonyTab = "overview";

    const bar = el("div", "colony-tabs");
    for (const tab of tabs) {
      const btn = el("button", "colony-tab");
      btn.append(el("span", undefined, tab.label));
      if (tab.badge) btn.append(el("span", "tab-badge", tab.badge));
      btn.classList.toggle("active", settings.colonyTab === tab.id);
      btn.addEventListener("click", () => {
        settings.colonyTab = tab.id;
        saveSettings();
        this.render();
      });
      bar.append(btn);
    }
    head.append(bar);
    this.detail.append(head);

    const scroll = el("div", "detail-body");
    this.detail.append(scroll);

    switch (settings.colonyTab) {
      case "production":
        this.renderIndustry(scroll, colony, output.buildPoints);
        break;
      case "mining":
        this.renderMining(scroll, body, colony, output.mining);
        this.renderStockpile(scroll, colony);
        this.renderStored(scroll, colony);
        break;
      case "people":
        this.renderPeople(scroll, body, colony);
        break;
      case "yards":
        this.renderYards(scroll, body, colony);
        break;
      case "terraform":
        this.renderTerraforming(scroll, body, colony);
        break;
      case "automation":
        this.renderGovernor(scroll, colony);
        this.renderTemplates(scroll, body, colony);
        this.renderStandingOrders(scroll, colony);
        break;
      default:
        this.renderOverview(scroll, body, colony, output, cost, capacity, alerts);
    }
  }

  /** Attention items that concern this colony, so problems show where they live. */
  private alertsFor(bodyId: string): Issue[] {
    return activeIssues(this.game.empire, this.game.galaxy, this.game.clock.seconds).filter(
      (issue) => issue.action.bodyId === bodyId,
    );
  }

  private renderOverview(
    scroll: HTMLElement,
    body: Body,
    colony: Colony,
    output: ReturnType<typeof colonyOutput>,
    cost: number,
    capacity: number,
    alerts: Issue[],
  ): void {
    const { game } = this;

    // Lasting effects from events, which explain output that looks off.
    const effects = game.empire.effects.filter((e) => e.target === colony.bodyId || e.target === "empire");
    if (effects.length) {
      const lasting = section(scroll, `Lasting effects (${effects.length})`);
      for (const effect of effects) {
        const row = el("div", `alert-row ${effect.factor >= 1 ? "info" : "warning"}`);
        row.append(el("span", `issue-dot ${effect.factor >= 1 ? "info" : "warning"}`));
        const text = el("div", "alert-text");
        text.append(
          el("div", "alert-title", effect.label),
          el("div", "muted small", `${describeEffect(effect, game.clock.seconds)}${effect.target === "empire" ? " - empire-wide" : ""}`),
        );
        row.append(text);
        lasting.append(row);
      }
    }

    const attention = section(scroll, "Needs attention here");
    if (!alerts.length) {
      emptyNote(attention, "Nothing wrong at this colony.");
    }
    for (const issue of alerts) {
      const row = el("div", `alert-row ${issue.severity}`);
      row.append(el("span", `issue-dot ${issue.severity}`));
      const text = el("div", "alert-text");
      text.append(el("div", "alert-title", issue.title), el("div", "muted small", issue.detail));
      row.append(text);
      attention.append(row);
    }

    const summary = section(scroll, "Colony");
    summary.classList.add("two-col");
    stat(summary, "Population", population(colony.population));
    stat(summary, "Supported Population", capacity > 0 ? population(capacity) : "none");
    stat(summary, "Annual Growth", `${output.populationGrowth >= 0 ? "+" : ""}${population(output.populationGrowth)}`,
      output.populationGrowth >= 0 ? "good" : "bad");
    stat(summary, "Colony Cost", cost.toFixed(2));
    stat(summary, "Temperature", `${body.tempK.toFixed(0)} K`);
    stat(
      summary,
      "Workforce",
      `${population(Math.min(colony.population, output.workersRequired))} / ${population(output.workersRequired)}`,
      output.employment < 0.999 ? "warn" : undefined,
    );
    stat(summary, "Wealth", `${num(output.wealth)} / year`);
    stat(summary, "Stability", `${Math.round(colony.stability)} - ${stabilityLabel(colony.stability)}`,
      colony.stability < 40 ? "bad" : colony.stability < 60 ? "warn" : undefined);
    {
      const governor = this.game.empire.governorOf(colony.bodyId);
      const why = stabilityTarget({
        taxRate: this.game.empire.taxRate, welfare: this.game.empire.welfare, treasury: this.game.empire.treasury,
        expenses: this.game.empire.snapshot.expenses, effect: this.game.empire.effectFactor("stability", colony.bodyId),
        administration: governor ? governor.skills.administration ?? 0 : null,
        pops: popStability(colony),
      });
      const sign = (v: number) => `${v >= 0 ? "+" : ""}${v.toFixed(0)}`;
      const note = el("p", "muted small",
        `Heading for ${Math.round(why.target)}: taxes ${sign(why.tax)}, welfare ${sign(why.welfare)}, treasury ${sign(why.treasury)}, ${governor ? "governor" : "no governor"} ${sign(why.governor)}, people ${sign(why.pops)}.`);
      summary.append(note);
    }
    const governor = game.empire.governorOf(colony.bodyId);
    stat(summary, "Governor", governor ? fullName(governor) : "vacant", governor ? undefined : "warn");
    const inflow = migrationInflow(game.empire, body, colony, game.galaxy);
    if (inflow > 0) {
      const row = stat(summary, "Colonists Arriving", `${population(inflow)} / year`, "good");
      row.title = "Civilian shipping from the capital - a stand-in until colony ships exist.";
    }

    this.renderInstallations(scroll, colony);
  }

  private renderNoColony(body: Body): void {
    const head = el("div", "detail-head");
    head.append(el("div", "detail-title", body.name));
    head.append(el("div", "detail-sub", classLabel(body)));
    this.detail.append(head);

    const scroll = el("div", "detail-body");
    const sec = section(scroll, "No Colony");
    const cost = effectiveColonyCost(body, this.game.empire.stats);
    if (!Number.isFinite(cost)) {
      emptyNote(sec, "This body has no surface to build on.");
    } else {
      const blocked = settleBlocker(this.game.empire, this.game.galaxy, body);
      emptyNote(sec, blocked ?? `Colony cost ${cost.toFixed(2)}. A colony can be established here.`);
      const establish = button(
          "Establish Colony",
          () => {
            this.game.empire.foundColony(body.id, this.game.clock.seconds);
            this.game.empire.addLog(
              this.game.clock.seconds,
              "colony",
              `A colony has been established on ${body.name}.`,
            );
            this.game.emit();
          },
          "primary-btn",
        );
      establish.disabled = blocked !== null;
      sec.append(establish);
    }
    this.detail.append(scroll);
  }

  private renderGovernor(parent: HTMLElement, colony: Colony): void {
    const { empire } = this.game;
    const sec = section(parent, "Governor");
    const current = empire.governorOf(colony.bodyId);

    const options = [
      { value: "", label: "- vacant -" },
      ...empire.officers
        .byBranch("civilian")
        .filter((o) => !o.assignment || o.assignment.targetId === colony.bodyId)
        .map((o) => ({ value: o.id, label: `${fullName(o)}  ${skillTag(o)}` })),
    ];
    sec.append(
      select(options, current?.id ?? "", (value) => {
        if (current && value !== current.id) empire.assignOfficer(current.id, null);
        if (value) {
          empire.assignOfficer(value, {
            kind: "governor",
            targetId: colony.bodyId,
            since: this.game.clock.seconds,
          });
        }
        this.game.emit();
      }),
    );

    if (current) {
      const policyRow = el("div", "policy-row");
      policyRow.append(el("span", "muted small", "Policy"));
      policyRow.append(
        select(
          (Object.keys(POLICY_NAMES) as GovernorPolicy[]).map((p) => ({
            value: p,
            label: POLICY_NAMES[p],
          })),
          colony.policy,
          (value) => {
            colony.policy = value as GovernorPolicy;
            this.game.emit();
          },
        ),
      );
      sec.append(policyRow);
      sec.append(el("p", "muted small", POLICY_BLURBS[colony.policy]));

      const bonuses = el("div", "bonus-row");
      for (const [skill, label] of [
        ["production", "Production"],
        ["mining", "Mining"],
        ["wealth", "Wealth"],
        ["populationGrowth", "Growth"],
      ] as const) {
        const value = current.skills[skill] ?? 0;
        if (!value) continue;
        const chip = el("span", `chip ${value > 0 ? "good" : "bad"}`, `${label} ${value > 0 ? "+" : ""}${value}%`);
        bonuses.append(chip);
      }
      sec.append(bonuses);
    }
  }

  private yardForm = { name: "", kind: "commercial" as YardKind, slipways: 2, add: 1 };
  private yardMessage: string | null = null;

  /** Named yards, commercial or military, with their slipways; and a form to found another. */
  private renderYards(parent: HTMLElement, body: Body, colony: Colony): void {
    const { empire } = this.game;
    syncYards(colony, canBuildMilitary(empire));
    const act = (fn: () => string | null) => () => {
      this.yardMessage = fn();
      this.game.emit();
      this.render();
    };

    if (this.yardMessage) parent.append(el("p", "project-warning", this.yardMessage));

    const yards = section(parent, `Shipyards at ${body.name} (${colony.yards.length})`);
    if (!colony.yards.length) emptyNote(yards, "No shipyards here yet. Found one below.");
    for (const yard of colony.yards) {
      const card = el("div", "event-card yard-card");
      const head = el("div", "event-title");
      head.append(el("span", undefined, yard.name));
      head.append(el("span", `chip ${yard.kind === "military" ? "warn" : "good"}`, YARD_KIND_NAMES[yard.kind]));
      card.append(head);
      const pending = pendingSlipways(colony, yard.id);
      card.append(el("div", "muted small",
        yard.slipways > 0
          ? `${yard.slipways} slipway${yard.slipways === 1 ? "" : "s"}: hulls up to ${num(yardLimit(yard))} t. ${YARD_KIND_BLURB[yard.kind]}`
          : `No slipways finished yet. ${YARD_KIND_BLURB[yard.kind]}`));
      if (pending > 0) card.append(el("div", "small warn", `${pending} slipway${pending === 1 ? "" : "s"} waiting in the build queue (Production tab).`));

      const row = el("div", "form-actions");
      const addCount = numberInput(this.yardForm.add, (v) => (this.yardForm.add = v), 1, MAX_NEW_SLIPWAYS);
      const add = button("Add slipways", act(() => addSlipways(empire, colony.bodyId, yard.id, this.yardForm.add)), "ghost-btn");
      add.setAttribute("aria-label", `Add slipways to ${yard.name}`);
      add.title = yard.kind === "military" ? `Each costs ${MILITARY_YARD_COST.toLocaleString()} wealth plus the installation.` : "Queues Shipyard installations for this yard.";
      row.append(addCount, add);
      if (yard.kind === "commercial") {
        const convert = button("Convert to military", act(() => convertYard(empire, colony.bodyId, yard.id, "military")), "ghost-btn");
        convert.disabled = !canBuildMilitary(empire);
        convert.title = canBuildMilitary(empire)
          ? `Costs ${(MILITARY_YARD_COST * Math.max(1, yard.slipways)).toLocaleString()} wealth.`
          : "Needs the Military Specification.";
        convert.setAttribute("aria-label", `Convert ${yard.name} to military`);
        row.append(convert);
      } else {
        const convert = button("Convert to commercial", act(() => convertYard(empire, colony.bodyId, yard.id, "commercial")), "ghost-btn");
        convert.setAttribute("aria-label", `Convert ${yard.name} to commercial`);
        row.append(convert);
      }
      if (yard.slipways <= 0) {
        const drop = button("Abandon", act(() => abandonYard(empire, colony.bodyId, yard.id)), "ghost-btn");
        drop.setAttribute("aria-label", `Abandon ${yard.name}`);
        row.append(drop);
      }
      card.append(row);
      yards.append(card);
    }

    // --- found a new yard
    const found = section(parent, "Found a new shipyard");
    const nameRow = el("div", "field-row");
    const nameInput = el("input", "select name-input");
    nameInput.type = "text";
    nameInput.placeholder = "Yard name";
    nameInput.value = this.yardForm.name;
    nameInput.setAttribute("aria-label", "Yard name");
    nameInput.addEventListener("input", () => (this.yardForm.name = nameInput.value));
    nameRow.append(el("label", "field-label", "Name"), nameInput);
    found.append(nameRow);

    const militaryOpen = canBuildMilitary(empire);
    if (!militaryOpen && this.yardForm.kind === "military") this.yardForm.kind = "commercial";
    const kindRow = el("div", "field-row");
    const kindSelect = select(
      [
        { value: "commercial", label: "Commercial" },
        { value: "military", label: militaryOpen ? "Military" : "Military (needs Military Specification)" },
      ],
      this.yardForm.kind,
      (value) => {
        this.yardForm.kind = value as YardKind;
        this.render();
      },
    );
    kindSelect.setAttribute("aria-label", "Yard type");
    kindRow.append(el("label", "field-label", "Type"), kindSelect);
    found.append(kindRow);
    found.append(el("p", "muted small", YARD_KIND_BLURB[this.yardForm.kind]));

    const slipRow = el("div", "field-row");
    slipRow.append(
      el("label", "field-label", "Slipways"),
      numberInput(this.yardForm.slipways, (v) => { this.yardForm.slipways = v; this.render(); }, 1, MAX_NEW_SLIPWAYS),
    );
    found.append(slipRow);
    const hull = this.yardForm.slipways * SHIPYARD_TONS;
    const cost = this.yardForm.kind === "military" ? MILITARY_YARD_COST * this.yardForm.slipways : 0;
    found.append(el("p", "muted small",
      `Hulls up to ${num(hull)} t. Queues ${this.yardForm.slipways} Shipyard installation${this.yardForm.slipways === 1 ? "" : "s"}${cost ? ` and costs ${num(cost)} wealth` : ""}; the slipways appear as they are built.`));
    const create = button("Found shipyard", act(() => {
      const problem = createYard(empire, colony.bodyId, this.yardForm.name, this.yardForm.kind, this.yardForm.slipways);
      if (!problem) this.yardForm.name = "";
      return problem;
    }), "primary-btn");
    found.append(create);

    // --- hulls in the queue and where they will be laid down
    const ships = colony.buildQueue.filter((o) => o.designId);
    if (ships.length) {
      const sec = section(parent, "Hulls on order");
      for (const order of ships) {
        const design = empire.design(order.designId);
        const stats = empire.statsOf(order.designId);
        if (!design || !stats) continue;
        const military = isMilitaryDesign(empire, design.id);
        const yard = yardFor(colony, stats.tons, military);
        const row = el("div", "queue-row pop-row");
        row.append(el("span", undefined, `${order.quantity} x ${design.name} (${num(stats.tons)} t${military ? ", military" : ""})`));
        row.append(el("span", `chip ${yard ? "good" : "bad"}`, yard ? yard.name : military && !colony.yards.some((y) => y.kind === "military") ? "needs a military yard" : "no slipway big enough"));
        sec.append(row);
      }
    }
  }

  private renderPeople(parent: HTMLElement, body: Body, colony: Colony): void {
    const { empire } = this.game;
    const market = computeMarket(empire, this.game.galaxy).colonies.get(colony.bodyId);

    const groups = section(parent, "Who lives here");
    for (const g of colony.pops) {
      const def = POP_BY_ID.get(g.id)!;
      const row = el("div", "queue-row pop-row");
      row.append(el("span", undefined, `${def.name} - ${population(colony.population * g.share)} (${Math.round(g.share * 100)}%)`));
      const sat = Math.round(g.satisfaction);
      row.append(el("span", `chip ${sat >= 60 ? "good" : sat >= 40 ? "warn" : "bad"}`, `Content ${sat}`));
      if (g.radicalism >= 20) row.append(el("span", `chip ${g.radicalism >= 50 ? "bad" : "warn"}`, `Radical ${Math.round(g.radicalism)}`));
      row.append(progressBar(g.satisfaction / 100));
      row.append(el("span", "muted small", `${def.blurb} Lean towards ${leaningText(def.leaning)}. Content ${def.boosts}.`));
      groups.append(row);
    }

    const goods = section(parent, "Goods");
    if (!market) {
      emptyNote(goods, "Nobody lives here yet.");
      return;
    }
    for (const good of GOODS) {
      const f = market.goods[good.id];
      const row = el("div", "queue-row pop-row");
      row.append(el("span", undefined, good.name));
      const pct = Math.round(f.met * 100);
      row.append(el("span", `chip ${pct >= 90 ? "good" : pct >= 60 ? "warn" : "bad"}`, `${pct}% met`));
      row.append(el("span", "muted small",
        `Made ${num(f.supply)}, needed ${num(f.demand)}` +
        (f.imported > 0.5 ? `, imported ${num(f.imported)}` : "") +
        (f.exported > 0.5 ? `, exported ${num(f.exported)}` : "") + " a year."));
      goods.append(row);
    }
    const fertile = fertility(body.colonyCost);
    goods.append(el("p", "muted small",
      fertile > 0
        ? `Good land: this world grows ${Math.round(fertile * 125)}% of its people's food without help.`
        : "Poor land: food must come from hydroponic farms here or be shipped in."));
    goods.append(el("p", "muted small",
      "Surplus moves between colonies by civilian shipping (within a system) and along freight lines. Consumer plants and luxury workshops burn Corundium and Gallicite from this colony's stockpile."));
  }

  private renderIndustry(parent: HTMLElement, colony: Colony, buildPoints: number): void {
    const { empire } = this.game;
    const sec = section(parent, "Industry");
    stat(sec, "Construction Factories", num(installationCount(colony, "construction-factory")));
    stat(sec, "Output Capacity", `${num(buildPoints)} BP / year`, empire.austerity ? "bad" : undefined);
    const yards = installationCount(colony, "shipyard");
    if (yards > 0) {
      stat(sec, "Shipyards", `${num(yards)} - hulls to ${num(shipyardCapacity(colony))} t`);
    }
    if (empire.austerity) {
      emptyNote(sec, "Treasury in deficit - industrial output is halved.");
    }

    const queue = section(parent, "Build Queue");
    if (!colony.buildQueue.length) {
      emptyNote(queue, "Nothing queued.");
    }
    for (const order of colony.buildQueue) {
      const type = INSTALLATION_BY_ID.get(order.installationId);
      if (!type) continue;
      const row = el("div", "queue-row");
      const destination = order.destination
        ? this.game.galaxy.byId.get(order.destination)?.name ?? order.destination
        : null;
      const name = el(
        "span",
        "queue-name",
        `${type.name} x${num(order.quantity)}${destination ? ` -> ${destination}` : ""}`,
      );
      name.title = type.blurb;
      row.append(name);
      if (order.auto) {
        const badge = el("span", "chip", "auto");
        badge.title = "Queued by a standing order";
        name.append(badge);
      }

      const remaining = order.quantity * type.cost - order.progress;
      const years = buildPoints > 0 ? remaining / buildPoints : Infinity;
      row.append(progressBar(order.progress / type.cost));
      row.append(
        el(
          "span",
          `queue-eta${order.starved ? " bad" : ""}`,
          order.starved ? "no minerals" : Number.isFinite(years) ? formatYears(years) : "stalled",
        ),
      );

      row.append(button("^", () => this.move(colony, order.id, -1), "step-btn"));
      row.append(button("v", () => this.move(colony, order.id, 1), "step-btn"));
      row.append(button("x", () => this.cancel(colony, order.id), "step-btn"));
      queue.append(row);
    }

    // --- add an order
    const add = el("div", "add-order");
    const options = INSTALLATIONS.filter((i) => empire.stats.unlocked.has(i.id)).map((i) => ({
      value: i.id,
      label: `${i.name}  (${num(i.cost)} BP)`,
    }));
    if (!options.some((o) => o.value === this.orderInstallation)) {
      this.orderInstallation = options[0]?.value ?? "";
    }
    add.append(
      select(options, this.orderInstallation, (value) => {
        this.orderInstallation = value;
        this.refreshPreview(colony);
      }),
    );
    add.append(
      numberInput(this.orderQuantity, (value) => {
        this.orderQuantity = value;
        this.refreshPreview(colony);
      }),
    );
    // Anything built here can be shipped to another colony on completion -
    // the stand-in for freighters.
    const destinations = [
      { value: "", label: "keep here" },
      ...[...empire.colonies.values()]
        .filter((c) => c.bodyId !== colony.bodyId)
        .map((c) => ({
          value: c.bodyId,
          label: `ship to ${this.game.galaxy.byId.get(c.bodyId)?.name ?? c.bodyId}`,
        })),
    ];
    add.append(
      select(destinations, this.orderDestination, (value) => {
        this.orderDestination = value;
      }),
    );
    add.append(
      button(
        "Add",
        () => {
          empire.queueBuild(
            colony.bodyId,
            this.orderInstallation,
            this.orderQuantity,
            this.orderDestination || null,
          );
          this.game.emit();
        },
        "primary-btn",
      ),
    );
    queue.append(add);

    queue.append(this.previewHost);
    this.refreshPreview(colony);
  }

  /** Redraw just the preview, leaving the form (and its focus) alone. */
  private refreshPreview(colony: Colony): void {
    this.previewHost.textContent = "";
    const type = INSTALLATION_BY_ID.get(this.orderInstallation);
    if (!type) return;
    this.previewHost.append(el("p", "muted small", type.blurb));
    const preview = previewOrder(
      this.game.empire,
      this.game.galaxy,
      colony,
      this.orderInstallation,
      this.orderQuantity,
    );
    if (preview) this.previewHost.append(this.previewBlock(preview));
  }

  /**
   * What a pending order or template would cost, when it would land, and what
   * it does to the empire's mineral cover - shown before the player commits.
   */
  private previewBlock(preview: OrderPreview): HTMLElement {
    const wrap = el("div", "order-preview");

    const head = el("div", "preview-head");
    head.append(el("span", "preview-cost", `${num(preview.buildPoints)} BP`));
    if (preview.noIndustry) {
      head.append(el("span", "bad", "no industry here - this would never start"));
    } else {
      const when = formatShortDate(this.game.clock.seconds + preview.completionSeconds);
      head.append(el("span", undefined, `completes ${when}  (${formatYears(preview.years)})`));
      if (preview.queuedAhead > 0) {
        head.append(el("span", "muted", `${num(preview.queuedAhead)} BP queued ahead`));
      }
    }
    wrap.append(head);

    if (!preview.minerals.length) {
      wrap.append(el("div", "preview-line muted", "No minerals required."));
    }
    for (const mineral of preview.minerals) {
      const line = el("div", `preview-line${mineral.shortfall > 0 ? " bad" : ""}`);
      line.append(el("span", "preview-mineral", mineral.mineral));
      line.append(
        el("span", "preview-amount",
          `${num(mineral.required)} t of ${compact(mineral.held)} held`),
      );
      if (mineral.shortfall > 0) {
        line.append(el("span", "preview-note", `short ${num(mineral.shortfall)} t`));
      } else if (Number.isFinite(mineral.coverAfter)) {
        line.append(
          el("span", "preview-note muted",
            `cover ${formatYears(mineral.coverBefore)} -> ${formatYears(mineral.coverAfter)}`),
        );
      } else if (Number.isFinite(mineral.replacementYears)) {
        line.append(
          el("span", "preview-note muted",
            `${formatYears(mineral.replacementYears)} of mining to replace`),
        );
      }
      wrap.append(line);
    }

    if (!preview.affordable) {
      wrap.append(
        el("div", "preview-warning bad",
          "The colony cannot cover this from its own stockpile; the order will stall until minerals arrive."),
      );
    }
    return wrap;
  }

  private renderTemplates(parent: HTMLElement, body: Body, colony: Colony): void {
    const { empire } = this.game;
    const sec = section(parent, "Development Templates");

    const templates = empire.templates.filter((t) =>
      templateIsApplicable(t, body, colony, empire.stats),
    );
    if (!templates.length) {
      emptyNote(sec, "No template applies to this world.");
      return;
    }
    if (!templates.some((t) => t.id === this.templateId)) {
      this.templateId = templates[0].id;
    }

    const sources = [...empire.colonies.values()].filter(
      (c) => installationCount(c, "construction-factory") > 0,
    );
    if (!sources.some((c) => c.bodyId === this.templateSource)) {
      this.templateSource =
        sources.find((c) => c.bodyId === colony.bodyId)?.bodyId ??
        sources.find((c) => c.bodyId === empire.capital)?.bodyId ??
        sources[0]?.bodyId ?? "";
    }

    const row = el("div", "add-order");
    row.append(
      select(
        templates.map((t) => ({ value: t.id, label: t.name })),
        this.templateId,
        (value) => {
          this.templateId = value;
          this.refreshTemplate(body, colony);
        },
      ),
    );
    row.append(
      select(
        sources.map((c) => ({
          value: c.bodyId,
          label: `built at ${this.game.galaxy.byId.get(c.bodyId)?.name ?? c.bodyId}`,
        })),
        this.templateSource,
        (value) => {
          this.templateSource = value;
          this.refreshTemplate(body, colony);
        },
      ),
    );
    row.append(
      button(
        "Apply",
        () => {
          const template = empire.templates.find((t) => t.id === this.templateId);
          const source = empire.colony(this.templateSource);
          if (!template || !source) return;
          for (const item of resolveTemplate(template, body, colony, empire.stats)) {
            empire.queueBuild(
              source.bodyId,
              item.installationId,
              item.quantity,
              source.bodyId === colony.bodyId ? null : colony.bodyId,
            );
          }
          empire.addLog(
            this.game.clock.seconds,
            "construction",
            `${template.name} queued at ${this.game.galaxy.byId.get(source.bodyId)?.name} for ${body.name}.`,
          );
          this.game.emit();
        },
        "primary-btn",
      ),
    );
    sec.append(row);
    sec.append(this.templateHost);
    this.refreshTemplate(body, colony);

    const save = el("div", "template-actions");
    save.append(
      button("Save this queue as a template", () => {
        if (!colony.buildQueue.length) return;
        const name = `${body.name} plan`;
        empire.saveTemplate(
          templateFromQueue(name, colony, `custom-${Date.now().toString(36)}`),
        );
        empire.addLog(this.game.clock.seconds, "construction", `Saved build template "${name}".`);
        this.game.emit();
      }),
    );
    const current = empire.templates.find((t) => t.id === this.templateId);
    if (current && !current.builtIn) {
      save.append(
        button("Delete template", () => {
          empire.deleteTemplate(current.id);
          this.game.emit();
        }),
      );
    }
    sec.append(save);
  }

  /** Redraw the template's contents and cost without rebuilding the form. */
  private refreshTemplate(body: Body, colony: Colony): void {
    const { empire } = this.game;
    this.templateHost.textContent = "";
    const template = empire.templates.find((t) => t.id === this.templateId);
    const source = empire.colony(this.templateSource);
    if (!template || !source) return;

    this.templateHost.append(el("p", "muted small", template.description));
    const items = resolveTemplate(template, body, colony, empire.stats);
    const preview = previewItems(empire, this.game.galaxy, source, items, template.name);
    if (!preview) return;

    const list = el("div", "template-items");
    for (const item of items) {
      const line = el("div", "template-item");
      line.append(
        el("span", undefined, INSTALLATION_BY_ID.get(item.installationId)?.name ?? item.installationId),
      );
      line.append(el("span", "right", `x${num(item.quantity)}`));
      list.append(line);
    }
    this.templateHost.append(list);
    this.templateHost.append(this.previewBlock(preview));
  }

  private renderStandingOrders(parent: HTMLElement, colony: Colony): void {
    const { empire } = this.game;
    const sec = section(parent, "Standing Orders");
    const rules = empire.standingOrdersFor(colony.bodyId);

    if (!rules.length) {
      emptyNote(sec, "No rules. A standing order tops this colony up without being asked.");
    }

    for (const rule of rules) {
      const row = el("div", "rule-row");
      const label = describeRule(rule.rule, (id) => INSTALLATION_BY_ID.get(id)?.name ?? id);
      row.append(el("span", "rule-name", label));
      const sourceName = this.game.galaxy.byId.get(rule.sourceId)?.name ?? rule.sourceId;
      row.append(el("span", "muted small", `built at ${sourceName}`));

      const pending = shortfallFor(empire, this.game.galaxy, rule);
      row.append(
        el("span", `rule-state ${pending ? "warn" : "good"}`,
          pending ? `queueing ${num(pending.quantity)}` : "satisfied"),
      );

      row.append(
        button(rule.enabled ? "Pause" : "Resume", () => {
          rule.enabled = !rule.enabled;
          this.game.emit();
        }, "step-btn"),
      );
      row.append(
        button("x", () => {
          empire.removeStandingOrder(rule.id);
          this.game.emit();
        }, "step-btn"),
      );
      sec.append(row);
    }

    const form = el("div", "add-order");
    form.append(
      select(
        [
          { value: "infrastructure", label: "Keep capacity ahead of population" },
          { value: "maintain", label: "Maintain a number of installations" },
        ],
        this.ruleKind,
        (value) => {
          this.ruleKind = value as "maintain" | "infrastructure";
          this.render();
        },
      ),
    );

    if (this.ruleKind === "maintain") {
      form.append(
        select(
          INSTALLATIONS.filter((i) => empire.stats.unlocked.has(i.id)).map((i) => ({
            value: i.id,
            label: i.name,
          })),
          this.ruleInstallation,
          (value) => (this.ruleInstallation = value),
        ),
      );
      form.append(numberInput(this.ruleTarget, (value) => (this.ruleTarget = value), 1, 99999));
    } else {
      form.append(numberInput(this.ruleHeadroom, (value) => (this.ruleHeadroom = value), 5, 500));
      form.append(el("span", "muted small", "% headroom"));
    }

    const sources = [...empire.colonies.values()].filter(
      (c) => installationCount(c, "construction-factory") > 0,
    );
    if (!sources.some((c) => c.bodyId === this.templateSource)) {
      this.templateSource = sources[0]?.bodyId ?? colony.bodyId;
    }
    form.append(
      select(
        sources.map((c) => ({
          value: c.bodyId,
          label: `built at ${this.game.galaxy.byId.get(c.bodyId)?.name ?? c.bodyId}`,
        })),
        this.templateSource,
        (value) => (this.templateSource = value),
      ),
    );
    form.append(
      button(
        "Add rule",
        () => {
          empire.addStandingOrder({
            colonyId: colony.bodyId,
            sourceId: this.templateSource || colony.bodyId,
            enabled: true,
            rule:
              this.ruleKind === "maintain"
                ? { kind: "maintain", installationId: this.ruleInstallation, target: this.ruleTarget }
                : { kind: "infrastructure", headroomPercent: this.ruleHeadroom },
          });
          this.game.emit();
        },
        "primary-btn",
      ),
    );
    sec.append(form);
  }

  /**
   * Terraforming: pick a gas and a direction, and watch the consequences.
   * The outlook is the same arithmetic the production cycle runs, pointed
   * forwards, so the number on screen is the number being simulated.
   */
  private renderTerraforming(parent: HTMLElement, body: Body, colony: Colony): void {
    const { empire } = this.game;
    const installations = installationCount(colony, "terraforming");
    if (!installations && !empire.stats.unlocked.has("terraforming")) return;

    const sec = section(parent, "Terraforming");
    sec.classList.add("terraform-section");
    if (!Number.isFinite(body.colonyCost)) {
      emptyNote(sec, "There is no surface here to terraform.");
      return;
    }

    stat(sec, "Installations", num(installations));
    const rate = terraformRate(empire, colony);
    stat(sec, "Rate", `${formatPressure(rate)} atm / year`, rate <= 0 ? "warn" : undefined);
    stat(sec, "Atmosphere", `${formatPressure(totalPressure(body.atmosphere))} of ${
      formatPressure(maxPressureFor(body.gravity))
    } atm`);

    if (!installations) {
      emptyNote(sec, "No terraforming installations here. Build or ship some in.");
      return;
    }

    const current = colony.terraforming;
    const row = el("div", "add-order");
    row.append(
      select(
        GASES.map((g) => ({
          value: g.id,
          label: `${g.name}${g.greenhouse > 0 ? " (greenhouse)" : ""}${g.oxygen ? " (breathable)" : ""}`,
        })),
        current?.gasId ?? this.terraformGas,
        (value) => {
          this.terraformGas = value;
          this.render();
        },
      ),
    );
    row.append(
      select(
        [
          { value: "add", label: "Add to atmosphere" },
          { value: "remove", label: "Remove from atmosphere" },
        ],
        current?.mode ?? this.terraformMode,
        (value) => {
          this.terraformMode = value as "add" | "remove";
          this.render();
        },
      ),
    );
    row.append(
      button(
        "Set programme",
        () => {
          colony.terraforming = { gasId: this.terraformGas, mode: this.terraformMode };
          empire.addLog(
            this.game.clock.seconds,
            "colony",
            `${body.name}: terraformers begin ${
              this.terraformMode === "add" ? "adding" : "removing"
            } ${GAS_BY_ID.get(this.terraformGas)?.name}.`,
          );
          this.game.emit();
        },
        "primary-btn",
      ),
    );
    sec.append(row);

    if (current) {
      const gas = GAS_BY_ID.get(current.gasId);
      stat(
        sec,
        "Programme",
        `${current.mode === "add" ? "Adding" : "Removing"} ${gas?.name ?? current.gasId}`,
      );
      const outlook = terraformOutlook(empire, body, colony);
      if (outlook) {
        const line = el("div", "preview-head");
        line.append(el("span", "preview-cost", outlook.text));
        if (outlook.years !== null) {
          line.append(el("span", undefined, `in ${formatYears(outlook.years)}`));
        }
        sec.append(line);
      }
      sec.append(
        button("Stop terraforming", () => {
          colony.terraforming = null;
          this.game.emit();
        }),
      );
    } else {
      emptyNote(sec, "No programme set; the terraformers are idle.");
    }
  }

  private renderMining(
    parent: HTMLElement,
    body: Body,
    colony: Colony,
    mining: Partial<Record<string, number>>,
  ): void {
    const { empire } = this.game;
    const sec = section(parent, "Mining");
    stat(sec, "Mines", num(installationCount(colony, "mine")));
    stat(sec, "Automated Mines", num(installationCount(colony, "automated-mine")));

    if (!this.game.empire.surveyed.has(body.id)) {
      emptyNote(sec, "This body has not been surveyed. Send a ship with geological sensors.");
    } else if (!body.minerals.length) {
      emptyNote(sec, "No deposits on this body.");
    } else {
      const table = el("div", "mineral-table");
      const header = el("div", "mineral-head");
      header.append(el("span", undefined, "Deposit"));
      header.append(el("span", undefined, "Remaining"));
      header.append(el("span", undefined, "Acc"));
      header.append(el("span", undefined, "Per year"));
      header.append(el("span", undefined, "Depleted"));
      table.append(header);

      for (const deposit of body.minerals) {
        const rate = mining[deposit.mineral] ?? 0;
        const row = el("div", "mineral-line");
        row.append(el("span", undefined, deposit.mineral));
        row.append(el("span", "right", compact(deposit.amount)));
        row.append(el("span", "right", deposit.accessibility.toFixed(1)));
        row.append(el("span", "right", rate > 0 ? num(rate) : "-"));
        row.append(
          el("span", "right muted", rate > 0 ? formatYears(deposit.amount / rate) : "-"),
        );
        if (deposit.amount <= 0) row.classList.add("depleted");
        table.append(row);
      }
      sec.append(table);
    }

    const drivers = installationCount(colony, "mass-driver");
    if (drivers > 0) {
      stat(sec, "Mass Drivers", `${num(drivers)}  (${num(drivers * empire.stats.massDriverThroughput)} tons/year)`);
      const targets = [
        { value: "", label: "- hold minerals here -" },
        ...[...empire.colonies.values()]
          .filter((c) => c.bodyId !== colony.bodyId)
          .map((c) => ({
            value: c.bodyId,
            label: this.game.galaxy.byId.get(c.bodyId)?.name ?? c.bodyId,
          })),
      ];
      const row = el("div", "stat");
      row.append(el("span", "stat-label", "Shipping To"));
      row.append(
        select(targets, colony.massDriverTarget ?? "", (value) => {
          colony.massDriverTarget = value || null;
          this.game.emit();
        }),
      );
      sec.append(row);
    }
  }

  private renderStockpile(parent: HTMLElement, colony: Colony): void {
    const sec = section(parent, "Stockpile");
    const grid = el("div", "stock-grid");
    for (const mineral of MINERALS) {
      const amount = colony.stockpile[mineral];
      const cell = el("div", `stock-cell${amount <= 0 ? " empty" : ""}`);
      cell.append(el("span", "stock-name", mineral));
      cell.append(el("span", "stock-value", compact(amount)));
      grid.append(cell);
    }
    sec.append(grid);
    stat(sec, "Fuel", `${compact(colony.fuel)} litres`);
  }

  /** Finished items crated up at the colony, waiting for a freighter. */
  private renderStored(parent: HTMLElement, colony: Colony): void {
    const entries = Object.entries(colony.stored).filter(([, n]) => n > 0);
    if (!entries.length) return;
    const sec = section(parent, "Awaiting Transport");
    for (const [id, count] of entries) {
      const type = INSTALLATION_BY_ID.get(id);
      const row = el("div", "install-row");
      row.append(el("span", "install-name", type?.name ?? id));
      row.append(
        el("span", "install-count", `${num(count)}  (${compact((type?.tons ?? 25000) * count)} t)`),
      );
      sec.append(row);
    }
    sec.append(
      el("p", "muted small", "Load these onto a freighter from the Fleets view."),
    );
  }

  private renderInstallations(parent: HTMLElement, colony: Colony): void {
    const sec = section(parent, "Installations");
    const servicing = servicingCapacity(this.game.empire, colony);
    if (servicing > 0) {
      const docked = [...this.game.empire.fleets.values()]
        .filter((f) => f.anchorId === colony.bodyId)
        .reduce((sum, f) => sum + fleetStats(this.game.empire, f).tons, 0);
      stat(
        sec, "Servicing capacity",
        `${num(servicing)} t of ship  (${num(docked)} t in dock)`,
        docked > servicing ? "warn" : undefined,
      );
    }
    const entries = Object.entries(colony.installations).filter(([, n]) => n > 0);
    if (!entries.length) {
      emptyNote(sec, "Nothing built here yet.");
      return;
    }
    const byCategory = new Map<InstallationCategory, [string, number][]>();
    for (const [id, count] of entries) {
      const type = INSTALLATION_BY_ID.get(id);
      if (!type) continue;
      const list = byCategory.get(type.category) ?? [];
      list.push([type.name, count]);
      byCategory.set(type.category, list);
    }
    for (const [category, list] of byCategory) {
      sec.append(el("div", "sub-head", CATEGORY_NAMES[category]));
      for (const [name, count] of list) {
        const row = el("div", "install-row");
        row.append(el("span", "install-name", name));
        row.append(el("span", "install-count", num(count)));
        sec.append(row);
      }
    }
  }

  private move(colony: Colony, orderId: string, delta: number): void {
    this.game.empire.moveOrder(colony.bodyId, orderId, delta);
    this.game.emit();
  }

  private cancel(colony: Colony, orderId: string): void {
    this.game.empire.cancelOrder(colony.bodyId, orderId);
    this.game.emit();
  }
}

function skillTag(officer: Officer): string {
  const best = Object.entries(officer.skills)
    .filter(([skill]) => skill !== "administration")
    .sort((a, b) => b[1] - a[1])[0];
  return best ? `(${best[0]} ${best[1] > 0 ? "+" : ""}${best[1]}%)` : "";
}

export function formatYears(years: number): string {
  if (!Number.isFinite(years)) return "never";
  if (years >= 100) return "100+ yr";
  if (years >= 1) return `${years.toFixed(1)} yr`;
  const days = years * 365.25;
  if (days >= 30) return `${(days / 30.44).toFixed(1)} mo`;
  return `${Math.max(1, Math.round(days))} d`;
}

export { formatShortDate };

/** "Civic Union and Colonial League", for the factions a group leans towards. */
function leaningText(leaning: Record<string, number>): string {
  return FACTIONS.filter((f) => (leaning[f.id] ?? 0) >= 0.2)
    .sort((a, b) => leaning[b.id] - leaning[a.id])
    .map((f) => f.name)
    .join(" and ");
}
