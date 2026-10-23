/** The treasury's books, line by line, for the finance panel. */

import type { Empire } from "../../state/empire";
import type { Galaxy } from "../galaxy";
import { colonyOutput } from "./production";
import { DEBT_INTEREST, reserveErosion } from "./finance";
import { tradeLines, type TradeLine } from "./trade";

export interface Budget {
  taxes: number;
  trade: number;
  centres: number;
  income: number;
  construction: number;
  research: number;
  upkeep: number;
  welfare: number;
  interest: number;
  /** Idle reserves lost to inflation. */
  erosion: number;
  /** Working freight lines, which carry the trade. */
  lines: TradeLine[];
  /** Ship servicing and anything else not itemised. */
  other: number;
  expenses: number;
  net: number;
  /** Years the treasury lasts at the current net, if it is shrinking. */
  runwayYears: number | null;
  /** Mean and lowest stability across populated colonies. */
  meanStability: number;
  lowest: { bodyId: string; stability: number } | null;
}

export function budgetOf(empire: Empire, system: Galaxy): Budget {
  let taxes = 0;
  let trade = 0;
  let centres = 0;
  let upkeep = 0;
  let stabilitySum = 0;
  let populated = 0;
  let lowest: Budget["lowest"] = null;
  for (const colony of empire.colonies.values()) {
    const body = system.byId.get(colony.bodyId);
    if (!body) continue;
    const out = colonyOutput(empire, body, colony, empire.stats);
    taxes += out.taxes;
    trade += out.trade;
    centres += out.centres;
    for (const [id, count] of Object.entries(colony.installations)) {
      if (id !== "infrastructure") upkeep += count * 0.05;
    }
    if (colony.population > 0.1) {
      stabilitySum += colony.stability;
      populated++;
      if (!lowest || colony.stability < lowest.stability) lowest = { bodyId: colony.bodyId, stability: colony.stability };
    }
  }
  const income = taxes + trade + centres;
  const construction = empire.snapshot.buildPoints;
  const research = empire.snapshot.researchPoints;
  const welfare = taxes * empire.welfare;
  const interest = empire.treasury < 0 ? -empire.treasury * DEBT_INTEREST : 0;
  const known = construction + research + upkeep + welfare + interest;
  const expenses = Math.max(empire.snapshot.expenses, known);
  const erosion = Math.min(reserveErosion(empire.treasury, expenses), expenses);
  const other = Math.max(0, expenses - known - erosion);
  const net = income - expenses;
  return {
    taxes, trade, centres, income, construction, research, upkeep, welfare, interest, erosion, lines: tradeLines(empire), other, expenses, net,
    runwayYears: net < 0 && empire.treasury > 0 ? empire.treasury / -net : null,
    meanStability: populated ? stabilitySum / populated : 70,
    lowest,
  };
}
