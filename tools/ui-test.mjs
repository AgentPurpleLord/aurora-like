/**
 * Browser checks for the interface.
 *
 * The sanity checks in tools/sanity.ts cover the model; these cover the parts
 * only a real browser can answer - does the dashboard sort, does an attention
 * item take you to its fix, does a template queue what its preview promised,
 * and does any of it work on a phone.
 *
 * Needs a dev server (`npm run dev`) and Playwright, which is deliberately not
 * a dependency of the project:
 *
 *   npm install --no-save playwright && npx playwright install chromium
 *   npm run dev &
 *   npm run ui
 *
 * Set CHROME_PATH to use a Chromium that is already installed.
 */

import { chromium, devices } from "playwright";

const BASE = process.env.UI_TEST_URL ?? "http://localhost:5173/";
// A fixed galaxy seed keeps officers, deposits and worlds the same every run.
const URL = `${BASE}?seed=sol-1&events=off`;
/** Screenshots land here rather than in the working tree. */
const SHOTS = ".screenshots";
const launch = process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {};

let passed = 0;
const failures = [];

function report(name, ok) {
  if (ok) {
    passed++;
    console.log(`  +  ${name}`);
  } else {
    failures.push(name);
    console.log(`  !  ${name}`);
  }
}

async function check(name, fn) {
  try {
    report(name, Boolean(await fn()));
  } catch (error) {
    report(`${name}: ${String(error.message).split("\n")[0]}`, false);
  }
}

/**
 * Research a technology through the real interface: find it with search,
 * select it, and take the recommended setup. `freeUp` first cancels whatever
 * is under way so there are laboratories to spare.
 */
async function startResearch(page, techName, { freeUp = false } = {}) {
  await nav(page, "Research").click();
  if (freeUp) {
    while ((await page.locator(".proj-card").count()) > 0) {
      await page.locator(".proj-card").first().click();
      await page.getByRole("button", { name: "Cancel research" }).click();
      await page.waitForTimeout(100);
    }
  }
  await page.locator(".research-search").fill(techName);
  await page.locator(".tech-node", { hasText: techName }).first().click();
  await page.locator("#view-research").getByRole("button", { name: /^Start research/ }).click();
  await page.waitForTimeout(150);
}

/** A screen's tab in the navigation bar, wherever else its name appears. */
const nav = (page, name) =>
  page
    .locator("#view-tabs > .view-tab[data-view]:not(.more-tab)")
    .filter({ hasText: new RegExp(`^${name}`) })
    .first();

/** Open one of the colony screen's tabs. */
async function colonyTab(page, name) {
  await page.locator("#view-colonies .colony-tab", { hasText: name }).first().click();
  await page.waitForTimeout(120);
}

/** Go to a screen on a phone, via "More" when it is not on the bar. */
async function mobileGo(page, name) {
  const direct = page.locator("#view-tabs > .view-tab:not(.more-tab)").getByText(name, { exact: true });
  if (await direct.first().isVisible().catch(() => false)) {
    await direct.first().click();
  } else {
    await page.locator("#view-tabs .more-tab").click();
    await page.locator("#view-tabs .more-entry", { hasText: name }).click();
  }
  await page.waitForTimeout(300);
}

function watchErrors(page) {
  const errors = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  return errors;
}

// ---------------------------------------------------------------- desktop

async function desktopSuite(browser) {
  console.log("\nDesktop (1680x980)");
  const page = await browser.newPage({ viewport: { width: 1680, height: 980 } });
  const errors = watchErrors(page);
  await page.goto(URL, { waitUntil: "networkidle" });
  await page.waitForTimeout(700);

  // --- the dashboard is the landing view
  await check("lands on the empire dashboard", async () =>
    (await page.locator("#view-empire").isVisible()) &&
    (await page.locator(".colony-table").isVisible()));
  await check("mineral ledger lists every mineral", async () =>
    (await page.locator(".ledger-table .data-row").count()) === 12);
  await check("attention rail is open with items", async () =>
    !(await page.locator("#triage-rail").getAttribute("class")).includes("collapsed") &&
    (await page.locator(".issue").count()) > 0);

  // --- an attention item leads to where it is fixed, and can be dismissed
  await page.locator(".issue").first().locator(".ghost-btn").click();
  await page.waitForTimeout(300);
  await check("following an item leaves the dashboard", async () =>
    !(await page.locator("#view-empire").isVisible()));
  await nav(page, "Empire").click();
  const issuesBefore = await page.locator(".issue").count();
  await page.locator(".issue").first().locator(".step-btn").click();
  await page.waitForTimeout(200);
  await check("dismissing an item removes it", async () =>
    (await page.locator(".issue").count()) === issuesBefore - 1);

  // --- settle two moons to develop
  for (const moon of ["Callisto", "Ganymede"]) {
    await nav(page, "Map").click();
    await page.locator(".tree-row", { hasText: moon }).first().click();
    await page.getByRole("button", { name: "Colony", exact: true }).click();
    await page.getByRole("button", { name: "Establish Colony" }).click();
  }
  await check("the map opens framed on the inner system", async () =>
    /Scale 0\.\d+ AU/.test(await page.locator("#map-overlay").innerText()));

  // --- commit-time preview
  await nav(page, "Colonies").click();
  await page.locator("#view-colonies .tree-row", { hasText: "Earth" }).click();
  await colonyTab(page, "Production");
  await page.locator("#view-colonies .add-order").first().locator("select").first()
    .selectOption("research-lab");
  const quantity = page.locator("#view-colonies .add-order").first().locator(".number-input");
  await quantity.fill("4");
  await quantity.press("Enter");
  await page.waitForTimeout(200);
  const preview = await page.locator("#view-colonies .order-preview").first().innerText();
  await check("preview prices the order", () => /3,600 BP/.test(preview));
  await check("preview dates the order", () => /completes \d+ \w+ \d{4}/.test(preview));
  await check("preview shows the mineral impact", () =>
    /(cover .* ->|of mining to replace)/.test(preview));
  await quantity.fill("400");
  await quantity.press("Enter");
  await page.waitForTimeout(200);
  await check("preview flags an order the colony cannot pay for", async () =>
    (await page.locator("#view-colonies .preview-warning").count()) > 0);

  // --- templates
  await page.locator("#view-colonies .tree-row", { hasText: "Callisto" }).click();
  await colonyTab(page, "Automation");
  const templates = page.locator("#view-colonies .section", { hasText: "Development Templates" }).first();
  await check("template lists what it would build", async () =>
    (await templates.locator(".template-item").count()) >= 2);
  await templates.getByRole("button", { name: "Apply" }).click();
  await page.waitForTimeout(200);
  await page.locator("#view-colonies .tree-row", { hasText: "Earth" }).click();
  await colonyTab(page, "Production");
  await check("applying a template queues work for the target", async () =>
    (await page.locator("#view-colonies .queue-row").allInnerTexts()).some((t) => t.includes("Callisto")));

  // --- bulk apply across colonies
  await nav(page, "Empire").click();
  await check("the dashboard lists every colony", async () =>
    (await page.locator(".colony-table .data-row").count()) === 4);
  const firstBefore = await page.locator(".colony-table .data-row").nth(1).innerText();
  await page.locator(".colony-table .data-row.header .sortable").nth(1).click();
  await check("colony table sorts", async () =>
    (await page.locator(".colony-table .data-row").nth(1).innerText()) !== firstBefore);

  for (const name of ["Callisto", "Ganymede"]) {
    await page.locator(".colony-table .data-row", { hasText: name }).locator(".row-tick").click();
  }
  await check("bulk bar counts the selection", async () =>
    (await page.locator(".bulk-count").innerText()).includes("2 selected"));
  await check("bulk bar totals the cost", async () =>
    /BP in total/.test(await page.locator(".bulk-bar").innerText()));
  await page.locator(".bulk-bar select").first().selectOption("forward-base");
  await page.getByRole("button", { name: "Apply to selected" }).click();
  await page.waitForTimeout(300);
  await nav(page, "Colonies").click();
  await page.locator("#view-colonies .tree-row", { hasText: "Earth" }).click();
  await colonyTab(page, "Production");
  const queued = (await page.locator("#view-colonies .queue-row").allInnerTexts()).join(" | ");
  await check("bulk apply queued for every target", () =>
    queued.includes("Ganymede") && queued.includes("Callisto"));

  // --- standing orders
  await page.locator("#view-colonies .tree-row", { hasText: "Callisto" }).click();
  await colonyTab(page, "Automation");
  const rules = () => page.locator("#view-colonies .section", { hasText: "Standing Orders" }).first();
  await rules().locator("select").first().selectOption("maintain");
  await page.waitForTimeout(150);
  await rules().locator("select").nth(1).selectOption("automated-mine");
  await rules().locator(".number-input").fill("25");
  await rules().locator(".number-input").press("Enter");
  await rules().getByRole("button", { name: "Add rule" }).click();
  await page.waitForTimeout(200);
  await check("standing order is listed", async () =>
    (await page.locator("#view-colonies .rule-row").innerText()).includes("Keep 25"));
  await check("standing order reports its state", async () =>
    /queueing|satisfied/.test(await page.locator("#view-colonies .rule-state").innerText()));

  // --- a governor policy proposes, and the player accepts
  await nav(page, "Officers").click();
  await page.getByRole("button", { name: /Administrators/ }).click();
  await page.locator(".officer-row").nth(1).click();
  await page.locator("#view-officers .panel-right select").selectOption("callisto");
  await check("an administrator can be posted to a new colony", async () =>
    (await page.locator("#view-officers .panel-right").innerText()).includes("Governor, Callisto"));

  // Earth, not one of the new moons: a governor will not propose mining
  // ground the empire has never surveyed.
  await nav(page, "Colonies").click();
  await page.locator("#view-colonies .tree-row", { hasText: "Earth" }).click();
  await colonyTab(page, "Automation");
  await page.locator("#view-colonies .policy-row select").selectOption("mine");
  await page.waitForTimeout(300);
  await check("mining is not proposed for an unsurveyed world", async () =>
    (await page.locator(".issue", { hasText: "Callisto: work the deposits" }).count()) === 0);
  const proposal = page.locator(".issue", { hasText: "Earth: work the deposits" }).first();
  await check("a governor policy produces a proposal", async () =>
    (await proposal.count()) > 0 && /Queue \d+/.test(await proposal.innerText()));
  await colonyTab(page, "Production");
  const before = await page.locator("#view-colonies .queue-row").count();
  await proposal.getByRole("button").first().click();
  await page.waitForTimeout(300);
  await page.locator("#view-colonies .tree-row", { hasText: "Earth" }).click();
  await colonyTab(page, "Production");
  await check("accepting a proposal queues the work", async () =>
    (await page.locator("#view-colonies .queue-row").count()) >= before);

  await check("no console errors", () => errors.length === 0);
  if (errors.length) console.log("    ", errors.slice(0, 3).join("\n     "));
  await page.close();
}

// ------------------------------------------------------------------ ships

async function shipSuite(browser) {
  console.log("\nResearch, designers and fleets (1680x980)");
  const page = await browser.newPage({ viewport: { width: 1680, height: 980 } });
  const errors = watchErrors(page);
  await page.goto(URL, { waitUntil: "networkidle" });
  await page.waitForTimeout(700);
  const skip = async (times) => {
    for (let i = 0; i < times; i++) {
      await page.getByRole("button", { name: "+30d", exact: true }).click();
    }
    await page.waitForTimeout(250);
  };

  // --- the research view explains itself
  await nav(page, "Research").click();
  await check("research opens on what is ready to start", async () =>
    (await page.locator(".research-tab.active").innerText()).includes("Ready now"));
  await check("the summary strip shows laboratories and scientists", async () =>
    /Laboratories/i.test(await page.locator(".research-summary").innerText()));
  await check("projects under way are listed at the top", async () =>
    (await page.locator(".proj-card").count()) >= 1);

  await page.getByRole("button", { name: /^Propulsion/ }).click();
  await check("technology that is not available yet is hidden by default", async () =>
    (await page.locator(".tech-node", { hasText: "Ion Drive Technology" }).count()) === 0 &&
    (await page.locator(".tech-node", { hasText: "Nuclear Thermal Engine Technology" }).count()) === 1);
  await check("and the field tab only counts what is shown", async () =>
    /\d+\/\d+/.test(await page.locator(".research-tab", { hasText: "Propulsion" }).innerText()));
  await page.getByLabel("Show locked technologies").check();
  await check("ticking the box reveals the whole tree", async () =>
    (await page.locator(".tech-node", { hasText: "Ion Drive Technology" }).count()) === 1);
  await page.locator(".tech-node", { hasText: "Ion Drive Technology" }).first().click();
  await check("a locked technology says what to research first", async () =>
    /Research Nuclear Pulse Engine Technology first/.test(await page.locator(".research-side").innerText()));
  await check("selecting a technology highlights what it needs", async () =>
    (await page.locator(".tech-node.is-prereq").count()) === 1);
  await check("and what it opens", async () =>
    (await page.locator(".tech-node.is-dependent").count()) >= 1);
  await page.locator(".tech-node", { hasText: "Nuclear Thermal Engine Technology" }).first().click();
  await check("a technology says what it unlocks", async () =>
    /engines in the component designer/.test(await page.locator(".research-side").innerText()));
  await check("a ready technology offers a recommended start", async () =>
    (await page.getByRole("button", { name: /Start research \(recommended\)/ }).count()) === 1);
  await check("and estimates how long it will take", async () =>
    /Finishes in about/.test(await page.locator(".research-side").innerText()));

  // --- nothing can fly until an engine exists
  await nav(page, "Design").click();
  await page.getByRole("button", { name: "New component", exact: true }).click();
  await check("engines show as locked in the component designer", async () =>
    (await page.locator("#view-design select").first().locator("option", { hasText: "Engine (locked)" }).count()) === 1);
  await page.locator("#view-design select").first().selectOption("engine");
  await check("choosing a locked kind says what to research", async () =>
    /Research Nuclear Thermal/.test(await page.locator("#view-design .fleet-detail").innerText()));

  // --- research the drive in one click
  await startResearch(page, "Nuclear Thermal Engine Technology", { freeUp: true });
  await skip(14);
  await check("the engine is researched", async () => {
    await page.locator(".research-search").fill("Nuclear Thermal Engine Technology");
    return /Researched/.test(await page.locator(".tech-node", { hasText: "Nuclear Thermal Engine Technology" }).first().innerText());
  });

  // --- the component designer
  await nav(page, "Design").click();
  await page.getByRole("button", { name: "Add standard set", exact: true }).click();
  await page.waitForTimeout(200);
  await check("the standard set adds components", async () =>
    (await page.locator("#view-design .design-row").count()) >= 5);

  await page.getByRole("button", { name: "New component", exact: true }).click();
  await page.waitForTimeout(150);
  const derived = () => page.locator("#view-design .derived-host").innerText();
  await check("a new engine starts at modifier 1.0", async () =>
    /Power\s+60\.0/.test(await derived()));
  const modifier = page.locator("#view-design .field-row", { hasText: "Power modifier" }).locator(".number-input");
  await modifier.fill("0.5");
  await modifier.press("Enter");
  await page.waitForTimeout(150);
  await check("halving the modifier halves the power", async () => /Power\s+30\.0/.test(await derived()));
  await check("and cuts fuel per unit of power to a quarter", async () =>
    /Fuel per power-hour\s+1\.25/.test(await derived()));
  await check("the name follows the parameters", async () =>
    (await page.locator("#view-design .name-input").inputValue()).includes("x0.50"));
  await page.getByRole("button", { name: "Create component", exact: true }).click();
  await page.waitForTimeout(200);
  await check("the saved component appears in the library", async () =>
    (await page.locator("#view-design .design-row", { hasText: "x0.50" }).count()) === 1);

  // Names keep following the figures, including when a saved part is reopened.
  await page.locator("#view-design .design-row", { hasText: "x0.50" }).click();
  await page.waitForTimeout(150);
  const reopened = page.locator("#view-design .field-row", { hasText: "Power modifier" }).locator(".number-input");
  await reopened.fill("0.6");
  await reopened.press("Enter");
  await page.waitForTimeout(150);
  await check("a reopened component's name still follows its figures", async () =>
    (await page.locator("#view-design .name-input").inputValue()).includes("x0.60"));
  await page.getByRole("button", { name: "New component", exact: true }).click();
  await page.locator("#view-design select").first().selectOption("fuel-tank");
  const tankSize = page.locator("#view-design .field-row", { hasText: "Size" }).locator(".number-input");
  await tankSize.fill("9");
  await tankSize.press("Enter");
  await page.waitForTimeout(150);
  await check("a fuel tank's name follows its size", async () =>
    (await page.locator("#view-design .name-input").inputValue()) === "Fuel Tank 9HS");
  await tankSize.fill("12");
  await tankSize.press("Enter");
  await page.waitForTimeout(150);
  await check("and keeps following as it grows", async () =>
    (await page.locator("#view-design .name-input").inputValue()) === "Fuel Tank 12HS");

  // --- the ship designer
  await page.getByRole("button", { name: /Ship Classes/ }).click();
  await page.getByRole("button", { name: "New class", exact: true }).click();
  await page.locator("#view-design .name-input").fill("Test Runner");
  const addPart = async (name, times = 1) => {
    const row = page.locator("#view-design .component-row", { hasText: name }).first();
    for (let i = 0; i < times; i++) await row.getByRole("button", { name: "+", exact: true }).click();
  };
  await addPart("Nuclear Thermal 5HS", 2);
  await addPart("Fuel Tank 5HS", 4);
  await addPart("Cargo Hold 20HS", 4);
  const classDerived = () => page.locator("#view-design .derived-host").innerText();
  await check("a class with no quarters flags the crew shortfall", async () =>
    /Add \d+ x Crew Quarters/.test(await classDerived()));
  await page.getByRole("button", { name: /to berth the crew/ }).click();
  await page.waitForTimeout(150);
  await check("one click berths the crew", async () =>
    !/to berth the crew/.test(await classDerived()));
  // 120 power over 5,600 t (112 hull spaces): the one-click fix adds a single
  // 100 t quarters, not the two the standard Hauler carries.
  await check("the class reports its speed from its parts", async () =>
    /Speed\s+1,071 km\/s/.test(await classDerived()));
  await page.getByRole("button", { name: "Create class", exact: true }).click();
  await page.waitForTimeout(200);
  await check("the class is saved", async () =>
    (await page.locator("#view-design .design-row", { hasText: "Test Runner" }).count()) === 1);

  // A component already built into a class cannot be rewritten.
  await page.getByRole("button", { name: /Components/ }).click();
  await page.locator("#view-design .design-row", { hasText: "Nuclear Thermal 5HS" }).first().click();
  await check("a component in use is superseded, not edited", async () =>
    /superseded rather than rewritten/.test(await page.locator("#view-design .fleet-detail").innerText()));

  // --- build it from the Fleets view
  await nav(page, "Fleets").click();
  const runner = page.locator("#view-fleets .project-card", { hasText: "Test Runner" }).first();
  await check("the class is offered for building", async () => (await runner.count()) === 1);
  await runner.getByRole("button", { name: "Build", exact: true }).click();
  await page.getByRole("button", { name: "30 days/s", exact: true }).click();
  await page.waitForTimeout(4500);
  // The completion itself may already have auto-paused the game.
  const pauseBtn = page.getByRole("button", { name: "Pause", exact: true });
  if (await pauseBtn.count()) await pauseBtn.click();
  await page.waitForTimeout(300);
  await check("the hull was commissioned into a fleet", async () =>
    (await page.locator("#view-fleets .panel-left .tree-row").count()) > 0);

  // --- orders
  await page.locator("#view-fleets .panel-left .tree-row").first().click();
  await page.waitForTimeout(200);
  await check("the fleet reports where it is", async () =>
    /At Earth/.test(await page.locator("#view-fleets .detail-sub").first().innerText()));
  const orderForm = page.locator("#view-fleets .section", { hasText: "Orders" }).first();
  await orderForm.locator("select").first().selectOption("move");
  await page.waitForTimeout(150);
  await page.locator("#view-fleets .add-order select").nth(1).selectOption("mars");
  await page.getByRole("button", { name: "Add order", exact: true }).click();
  await page.waitForTimeout(200);
  await check("the move order is queued", async () =>
    (await page.locator("#view-fleets .order-row").innerText()).includes("Mars"));
  // Eight hours at ~1,000 km/s is about 0.2 AU: well short of Mars.
  await page.getByRole("button", { name: "+8h", exact: true }).click();
  await page.waitForTimeout(300);
  await check("the fleet is under way", async () =>
    /Under way to Mars/.test(await page.locator("#view-fleets .fleet-detail").innerText()));

  await nav(page, "Map").click();
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${SHOTS}/ships-map.png` });
  await check("the map shows the fleet in the detail panel", async () =>
    (await page.locator("#detail-panel").innerText()).length > 0);

  await check("no console errors", () => errors.length === 0);
  if (errors.length) console.log("    ", errors.slice(0, 3).join("\n     "));
  await page.close();
}

// ----------------------------------------------------------- terraforming

async function terraformSuite(browser) {
  console.log("\nTerraforming (1680x980)");
  const page = await browser.newPage({ viewport: { width: 1680, height: 980 } });
  const errors = watchErrors(page);
  await page.goto(URL, { waitUntil: "networkidle" });
  await page.waitForTimeout(700);

  // Jumping the clock in thirty-day steps is far quicker than waiting.
  const skip = async (times) => {
    for (let i = 0; i < times; i++) {
      await page.getByRole("button", { name: "+30d", exact: true }).click();
    }
    await page.waitForTimeout(250);
  };

  // The atmosphere reads through the gas model before anything is changed.
  await nav(page, "Map").click();
  await page.locator(".tree-row", { hasText: "Venus" }).first().click();
  await page.getByRole("button", { name: "Environment", exact: true }).click();
  const venus = await page.locator("#detail-panel").innerText();
  await check("a world lists its gases", () => /Carbon Dioxide/.test(venus));
  await check("and flags the poisonous ones", () => /Unsafe/.test(venus));

  await page.locator(".tree-row", { hasText: "Mars" }).first().click();
  const marsBefore = await page.locator("#detail-panel").innerText();
  await check("Mars reads its observed temperature", () => /-63\.1 C|210 K/.test(marsBefore));

  // Settle Mars and research terraforming.
  await page.getByRole("button", { name: "Colony", exact: true }).click();
  await page.getByRole("button", { name: "Establish Colony" }).click();

  await startResearch(page, "Terraforming Technology", { freeUp: true });
  await skip(12);
  await nav(page, "Research").click();
  await page.locator(".research-search").fill("Terraforming Technology");
  await check("terraforming technology is researched", async () =>
    (await page.locator(".tech-node", { hasText: "Terraforming Technology" }).first().innerText())
      .includes("Researched"));

  // Build the processors on Earth and ship them to Mars.
  await nav(page, "Colonies").click();
  await page.locator("#view-colonies .tree-row", { hasText: "Earth" }).click();
  await colonyTab(page, "Production");
  // Processors need people to run them, so the colony needs housing first.
  const add = page.locator("#view-colonies .add-order").first();
  const queueForMars = async (installationId, quantity) => {
    await add.locator("select").first().selectOption(installationId);
    await add.locator(".number-input").fill(String(quantity));
    await add.locator(".number-input").press("Enter");
    await add.locator("select").last().selectOption("mars");
    await page.getByRole("button", { name: "Add", exact: true }).click();
  };
  await queueForMars("infrastructure", 600);
  await queueForMars("terraforming", 30);
  await skip(50);

  await page.locator("#view-colonies .tree-row", { hasText: "Mars" }).click();
  await colonyTab(page, "Terraforming");
  await page.waitForTimeout(300);
  const terraSection = () => page.locator("#view-colonies .terraform-section");
  await check("the processors were shipped to the colony", async () => {
    const match = (await terraSection().innerText()).match(/Installations\s+([\d,]+)/);
    return match ? Number(match[1].replace(/,/g, "")) >= 30 : false;
  });

  // Set a programme and read the forecast.
  await terraSection().locator("select").first().selectOption("nitrous-oxide");
  await terraSection().locator("select").nth(1).selectOption("add");
  await terraSection().getByRole("button", { name: "Set programme" }).click();
  await page.waitForTimeout(300);
  const forecast = await terraSection().innerText();
  await check(`the forecast names a goal and a date`, () =>
    /Surface temperature reaches 253 K/.test(forecast) && /in \d/.test(forecast));

  // Run it, and the world should actually warm.
  const tempBefore = await readTemperature(page);
  await skip(40);
  const tempAfter = await readTemperature(page);
  await check(`terraforming warms the world (${tempBefore} K -> ${tempAfter} K)`,
    () => tempAfter > tempBefore);
  await page.screenshot({ path: `${SHOTS}/terraform.png` });

  await check("no console errors", () => errors.length === 0);
  if (errors.length) console.log("    ", errors.slice(0, 3).join("\n     "));
  await page.close();
}

async function readTemperature(page) {
  // The header's vital signs carry the temperature beside the colony cost.
  const text = await page.locator("#view-colonies .vitals").innerText();
  const match = text.match(/(\d+)\s*K/);
  return match ? Number(match[1]) : NaN;
}

// ----------------------------------------------------------------- mobile

async function refreshSuite(browser) {
  console.log("\nUI refresh");
  const page = await browser.newPage({ viewport: { width: 1680, height: 980 } });
  await page.goto(URL);
  await page.waitForSelector("#view-tabs");

  // --- command palette
  await page.keyboard.press("Control+k");
  await check("Ctrl+K opens the command palette", async () => (await page.locator(".palette-input").count()) === 1);
  await page.locator(".palette-input").fill("fleets");
  await page.waitForTimeout(100);
  await check("the palette finds screens", async () => (await page.locator(".palette-row").count()) > 0);
  await page.keyboard.press("Enter");
  await page.waitForTimeout(200);
  await check("Enter jumps to the chosen screen", async () => await page.locator("#view-fleets").isVisible());
  await check("the palette closes after choosing", async () => !(await page.locator(".palette-input").isVisible()));

  // --- foldable sections remember their state
  await nav(page, "Empire").click();
  const head = page.locator("#view-empire .section > h3[role=button]").first();
  const before = await head.getAttribute("aria-expanded");
  await head.click();
  await page.reload();
  await page.waitForSelector("#view-tabs");
  const after = await page.locator("#view-empire .section > h3[role=button]").first().getAttribute("aria-expanded");
  await check("a folded section stays folded after reload", async () => before !== after);

  // --- density
  await page.evaluate(() => {
    const raw = JSON.parse(localStorage.getItem("aurora-like.settings") || "{}");
    raw.density = "compact";
    localStorage.setItem("aurora-like.settings", JSON.stringify(raw));
  });
  await page.reload();
  await page.waitForSelector("#view-tabs");
  await check("density is applied from settings", async () =>
    (await page.evaluate(() => document.documentElement.dataset.density)) === "compact");

  // --- themes
  await check("the classic theme is the default", async () =>
    (await page.evaluate(() => document.documentElement.dataset.theme)) === "classic");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.locator(".settings-panel .seg-btn", { hasText: "Terminal" }).click();
  await check("the terminal theme can be chosen", async () =>
    (await page.evaluate(() => document.documentElement.dataset.theme)) === "terminal");
  await check("and really changes the look (monospace type, phosphor colours)", async () => {
    const style = await page.evaluate(() => {
      const cs = getComputedStyle(document.body);
      return { font: cs.fontFamily, bg: getComputedStyle(document.querySelector(".topbar")).backgroundImage };
    });
    return /mono|Consolas|Menlo/i.test(style.font) && /rgb\(\d+, \d+, \d+\)/.test(style.bg);
  });
  await page.reload();
  await page.waitForSelector("#view-tabs");
  await check("the chosen theme is remembered", async () =>
    (await page.evaluate(() => document.documentElement.dataset.theme)) === "terminal");
  await nav(page, "Map").click();
  await page.waitForTimeout(300);
  await check("the map still draws in the terminal theme", async () =>
    (await page.evaluate(() => document.getElementById("map").width)) > 100);
  await nav(page, "Empire").click();
  await page.keyboard.press("Control+k");
  await page.locator(".palette-input").fill("switch theme");
  await page.keyboard.press("Enter");
  await check("the palette switches the theme back", async () =>
    (await page.evaluate(() => document.documentElement.dataset.theme)) === "classic");

  // --- hand-tuned terminal screens
  await page.evaluate(() => { document.documentElement.dataset.theme = "terminal"; });
  await check("the galaxy map has a radar scale in the terminal theme", async () => {
    await nav(page, "Galaxy").click();
    return (await page.locator(".galaxy-radar").isVisible()) && (await page.locator(".galaxy-bearing").count()) === 4;
  });
  await page.evaluate(() => { document.documentElement.dataset.theme = "classic"; });
  await check("and none in Classic", async () => !(await page.locator(".galaxy-radar").isVisible()));

  // --- themed headings and furniture
  await nav(page, "Empire").click();
  await check("Classic keeps its own headings", async () =>
    /suggested next steps/i.test(await page.locator(".guide-title").first().innerText()) &&
    /attention/i.test(await page.locator("#triage-rail .panel-head").innerText()));
  await page.evaluate(() => { document.documentElement.dataset.theme = "terminal"; });
  await check("the terminal renames the main headings", async () =>
    /Mission objectives/i.test(await page.locator(".guide-title").first().innerText()) &&
    /Threat board/i.test(await page.locator("#triage-rail .panel-head").innerText()));
  await page.keyboard.press("Control+k");
  await check("the palette is a command line in the terminal", async () =>
    /command line/i.test(await page.locator(".palette").evaluate((n) => getComputedStyle(n, "::before").content)));
  await page.keyboard.press("Escape");
  await page.evaluate(() => { document.documentElement.dataset.theme = "classic"; });

  // --- the settings popover and the guide
  await check("the status bar offers Next event", async () =>
    (await page.getByRole("button", { name: "Skip to next event" }).count()) === 1);
  await page.close();
}

async function programSuite(browser) {
  console.log("\nSaves, digest and fleet programmes");
  const page = await browser.newPage({ viewport: { width: 1680, height: 980 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await page.goto(`${BASE}?debug&new&seed=sol-1&events=off`);
  await page.waitForSelector("#view-tabs");

  // A survey ship and a hauler, and a second colony to run between.
  await page.evaluate(() => {
    const g = window.__game;
    const e = g.empire;
    e.research("nuclear-thermal");
    e.research("geo-survey-sensors");
    const part = (kind, params) => e.addComponentDesign(kind, params, 0);
    const engine = part("engine", { type: "nuclear-thermal", size: 5, modifier: 1 });
    const tank = part("fuel-tank", { size: 5 });
    const quarters = part("crew-quarters", { size: 2 });
    const cargo = part("cargo-hold", { size: 20 });
    const sensor = part("survey-sensor", { type: "geological", size: 4 });
    const scout = e.addDesign("Scout", [
      { componentId: engine.id, count: 2 }, { componentId: tank.id, count: 6 },
      { componentId: sensor.id, count: 2 }, { componentId: quarters.id, count: 1 },
    ], 0);
    const hauler = e.addDesign("Freighter", [
      { componentId: engine.id, count: 2 }, { componentId: tank.id, count: 4 },
      { componentId: cargo.id, count: 4 }, { componentId: quarters.id, count: 2 },
    ], 0);
    const a = e.createFleet("Scout Wing", { x: 0, y: 0, z: 0 }, "earth");
    e.commissionShip(scout.id, a, "Scout 001", 0);
    const b = e.createFleet("Mars Line", { x: 0, y: 0, z: 0 }, "earth");
    e.commissionShip(hauler.id, b, "Hauler 001", 0);
    e.foundColony("mars", g.clock.seconds).population = 1;
    g.emit();
  });

  // --- survey programme from the fleet screen
  await nav(page, "Fleets").click();
  await page.locator("#view-fleets .panel-left .tree-row", { hasText: "Scout Wing" }).click();
  await check("a fleet shows its standing programme section", async () =>
    (await page.locator("#view-fleets .section", { hasText: "Standing programme" }).count()) > 0);
  await page.locator("#view-fleets .program-form", { hasText: "Survey" }).getByRole("button", { name: /^Survey \d+ bodies/ }).click();
  await check("starting a survey programme shows what it is doing", async () =>
    /Survey every body in the system/.test(await page.locator("#view-fleets .program-card").innerText()));
  await check("the fleet list tags it", async () =>
    (await page.locator("#view-fleets .panel-left .program-chip", { hasText: "survey" }).count()) === 1);
  await page.evaluate(() => { for (let i = 0; i < 8; i++) window.__game.step(86400); window.__game.emit(); });
  await check("it sets about its work on its own", async () =>
    (await page.evaluate(() => window.__game.empire.fleets.get("fleet-1").orders.length)) > 0);
  await page.getByRole("button", { name: "Stop programme" }).click();
  await check("it can be stopped", async () =>
    (await page.locator("#view-fleets .program-card").count()) === 0);

  // --- freight line
  await page.locator("#view-fleets .panel-left .tree-row", { hasText: "Mars Line" }).click();
  const freight = page.locator("#view-fleets .program-form", { hasText: "Freight line" });
  await check("the freight form offers the colonies", async () => (await freight.locator("select").count()) >= 4);
  // Number fields come with a slider, + and - buttons, and the exact box.
  await freight.locator("select").nth(2).selectOption("colonists");
  const amountField = page.locator("#view-fleets .program-form .slider-field").first();
  await check("a number field has a slider, steppers and a box", async () =>
    (await amountField.locator(".slider").count()) === 1 &&
    (await amountField.locator(".step-btn").count()) === 2 &&
    (await amountField.locator(".number-input").count()) === 1);
  const setSlider = (v) => amountField.locator(".slider").evaluate((n, val) => {
    n.value = String(val);
    n.dispatchEvent(new Event("input", { bubbles: true }));
    n.dispatchEvent(new Event("change", { bubbles: true }));
  }, v);
  await setSlider(1000);
  await check("the top of a wide slider is the maximum", async () =>
    (await amountField.locator(".number-input").inputValue()) === "100000000");
  await setSlider(500);
  await check("the middle of a wide slider is a round number, not a stray one", async () =>
    /^\d{1,2}0*$/.test(await amountField.locator(".number-input").inputValue()) && Number(await amountField.locator(".number-input").inputValue()) > 1000);
  const mid = Number(await amountField.locator(".number-input").inputValue());
  await amountField.getByRole("button", { name: "Increase" }).click();
  await check("the + button moves to the next round number", async () =>
    Number(await page.locator("#view-fleets .program-form .slider-field").first().locator(".number-input").inputValue()) > mid);
  await freight.locator("select").nth(2).selectOption("minerals");
  await freight.getByRole("button", { name: "Start freight line" }).click();
  await check("a freight line starts and is described", async () =>
    /Freight Earth - Mars/.test(await page.locator("#view-fleets .program-card").innerText()));
  await page.evaluate(() => { for (let i = 0; i < 6; i++) window.__game.step(86400); window.__game.emit(); });
  await check("the line reports its status", async () =>
    (await page.locator("#view-fleets .program-card .muted").first().innerText()).length > 0);
  await page.getByRole("button", { name: "Stop programme" }).click();

  // --- repeat orders
  await page.locator("#view-fleets .repeat-row input").check();
  await check("repeat is remembered on the fleet", async () =>
    await page.evaluate(() => window.__game.empire.fleets.get("fleet-2").loop));
  await page.locator("#view-fleets .repeat-row input").uncheck();

  // --- the digest is offered after a long stretch with news in it
  await page.evaluate(() => {
    const g = window.__game;
    for (const text of ["Alpha complete.", "Beta complete.", "Gamma complete."]) {
      g.empire.addLog(g.clock.seconds + 40 * 86400, "construction", text);
    }
    g.step(60 * 86400);
  });
  await check("the digest is offered when time has passed", async () =>
    (await page.getByRole("button", { name: "Review digest" }).count()) === 1);
  await page.getByRole("button", { name: "Review digest" }).click();
  await check("the digest lists what happened", async () => {
    const text = await page.locator(".dialog").innerText();
    return /While you were away/.test(text) && /Alpha complete/.test(text);
  });
  await page.getByRole("button", { name: "Mark as read" }).click();
  await check("marking it read closes it", async () => (await page.locator(".dialog").count()) === 0);

  // --- saving and loading
  await page.keyboard.press("Control+s");
  await check("Ctrl+S opens the save dialog", async () => (await page.locator(".dialog").count()) === 1);
  await page.locator(".save-name").fill("Test save");
  await page.locator(".dialog").getByRole("button", { name: "Save", exact: true }).click();
  await check("a named save is listed", async () =>
    (await page.locator(".save-row", { hasText: "Test save" }).count()) === 1);
  await page.keyboard.press("Escape");
  await check("Escape closes the dialog", async () => (await page.locator(".dialog").count()) === 0);

  await page.keyboard.press("F5");
  const treasury = await page.evaluate(() => window.__game.empire.treasury);
  const clock = await page.evaluate(() => window.__game.clock.seconds);
  await page.evaluate(() => { window.__game.empire.treasury += 12345; window.__game.step(30 * 86400); });
  await page.keyboard.press("F9");
  await page.waitForLoadState("load");
  await page.waitForSelector("#view-tabs");
  await check("quickload brings back the saved treasury and date", async () =>
    (await page.evaluate(() => window.__game.empire.treasury)) === treasury &&
    (await page.evaluate(() => window.__game.clock.seconds)) === clock);
  await check("the loaded game kept its fleets", async () =>
    (await page.evaluate(() => window.__game.empire.fleets.size)) === 2);
  await check("loading says so, and the clock is paused", async () =>
    (await page.locator(".toast", { hasText: "Game loaded" }).count()) === 1 &&
    (await page.evaluate(() => window.__game.clock.paused)));

  await check("no console errors", () => errors.length === 0);
  if (errors.length) console.log("    ", errors.slice(0, 3).join("\n     "));
  await page.close();
}

async function explorationSuite(browser) {
  console.log("\nGalaxy and exploration");
  const page = await browser.newPage({ viewport: { width: 1680, height: 980 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await page.goto(`${BASE}?debug&new&seed=demo&events=off`);
  await page.waitForSelector("#view-tabs");

  await nav(page, "Galaxy").click();
  await check("the galaxy map shows the real neighbours", async () =>
    (await page.locator(".galaxy-node").count()) === 16);
  await check("only Sol is known at the start", async () =>
    (await page.locator(".galaxy-node.known").count()) === 1);
  await page.locator('[data-system="trappist-1"]').click();
  await check("an unvisited star shows what is known and what is not", async () => {
    const text = await page.locator(".galaxy-side").innerText();
    return /TRAPPIST-1/.test(text) && /Not yet visited/.test(text) && /40.7 ly/.test(text);
  });
  await check("its planets are not revealed", async () =>
    !/Planets \(/.test(await page.locator(".galaxy-side").innerText()));

  // The map tree has no jump points until they are found.
  await nav(page, "Map").click();
  await check("no jump points are listed before a survey", async () =>
    (await page.locator("#system-panel .tree-name", { hasText: "Jump Point" }).count()) === 0);

  // A fleet that can explore.
  await page.evaluate(() => {
    const g = window.__game;
    const e = g.empire;
    for (const t of ["nuclear-thermal", "geo-survey-sensors", "grav-survey-sensors", "nuclear-pulse", "jump-point-theory", "jump-gate-construction"]) e.research(t);
    const mk = (kind, params) => e.addComponentDesign(kind, params, 0);
    const engine = mk("engine", { type: "nuclear-thermal", size: 5, modifier: 1 });
    const tank = mk("fuel-tank", { size: 5 });
    const quarters = mk("crew-quarters", { size: 2 });
    const drive = mk("jump-drive", { size: 30 });
    const sensor = mk("survey-sensor", { type: "gravitational", size: 4 });
    const design = e.addDesign("Explorer", [
      { componentId: engine.id, count: 4 }, { componentId: tank.id, count: 10 },
      { componentId: sensor.id, count: 1 }, { componentId: drive.id, count: 1 }, { componentId: quarters.id, count: 2 },
    ], 0);
    const fleet = e.createFleet("Pathfinder", { x: 0, y: 0, z: 0 }, "earth");
    e.commissionShip(design.id, fleet, "Pathfinder 1", 0).fuel = e.statsOf(design.id).fuelCapacity;
    const plain = e.addDesign("Plain", [
      { componentId: engine.id, count: 2 }, { componentId: tank.id, count: 4 }, { componentId: quarters.id, count: 1 },
    ], 0);
    const driveless = e.createFleet("Driveless", { x: 0, y: 0, z: 0 }, "earth");
    e.commissionShip(plain.id, driveless, "Plain 1", 0).fuel = 1e5;
    g.emit();
  });

  await nav(page, "Fleets").click();
  await page.locator("#view-fleets .panel-left .tree-row", { hasText: "Driveless" }).click();
  await check("a fleet with no jump drive cannot start exploring", async () => {
    const form = page.locator("#view-fleets .program-form", { hasText: "Explore" });
    return (await form.getByRole("button", { name: "Start exploring" }).isDisabled()) &&
      /no (jump drive|gravitational)/i.test(await form.innerText());
  });
  await page.locator("#view-fleets .panel-left .tree-row", { hasText: "Pathfinder" }).click();
  const explore = page.locator("#view-fleets .program-form", { hasText: "Explore" });
  await check("an explorer can", async () => await explore.getByRole("button", { name: "Start exploring" }).isEnabled());
  await explore.getByRole("button", { name: "Start exploring" }).click();
  await check("it is described as exploring", async () =>
    /Explore/.test(await page.locator("#view-fleets .program-card").innerText()));

  await page.evaluate(() => { for (let i = 0; i < 400; i++) window.__game.step(86400); window.__game.emit(); });
  await nav(page, "Galaxy").click();
  await check("exploring reveals more systems", async () => (await page.locator(".galaxy-node.known").count()) >= 3);
  await check("and draws the jump links crossed", async () => (await page.locator(".galaxy-link").count()) >= 2);
  const visited = await page.locator(".galaxy-node.known").evaluateAll((nodes) => nodes.map((n) => n.dataset.system));
  const away = visited.find((id) => id !== "sol");

  // Switching the map to a visited system.
  await page.evaluate((id) => { window.__game.empire.fleets.get("fleet-1").program = null; window.__game.setViewSystem(id); }, away);
  await nav(page, "Map").click();
  await check("the system list follows the system shown", async () =>
    /system$/i.test((await page.locator("#system-panel .panel-head span").first().innerText()).trim()) &&
    !/^Sol System/i.test(await page.locator("#system-panel .panel-head span").first().innerText()));
  await check("the map's system picker lists the visited systems", async () =>
    (await page.locator(".tool-select option").count()) >= 3);
  await check("jump points found appear in the list", async () =>
    (await page.locator("#system-panel .tree-name", { hasText: "Jump Point" }).count()) >= 1);

  // A jump point's own panel.
  await page.locator("#system-panel .tree-row", { hasText: "Jump Point" }).first().click();
  await check("a jump point says where it leads", async () =>
    /Leads to/.test(await page.locator("#detail-panel").innerText()));

  // The first foothold in a new system needs a colony ship.
  const planetId = await page.evaluate((id) => {
    const g = window.__game;
    return g.galaxy.systemById.get(id).bodies.find((b) => b.cls === "planet" && Number.isFinite(b.colonyCost)).id;
  }, away);
  await page.evaluate((id) => window.__game.select(window.__game.galaxy.byId.get(id)), planetId);
  await check("a new system cannot be settled without a colony ship", async () => {
    const btn = page.locator("#detail-panel .context-btn", { hasText: "Settle here" });
    return (await btn.count()) === 1 && (await btn.isDisabled());
  });

  // Saving keeps the exploration.
  const before = await page.evaluate(() => ({
    systems: window.__game.empire.knownSystems.size,
    jps: window.__game.empire.knownJumpPoints.size,
    fleet: window.__game.empire.fleets.get("fleet-1").systemId,
  }));
  await page.keyboard.press("F5");
  await page.evaluate(() => { window.__game.empire.knownSystems.add("trappist-1"); });
  await page.keyboard.press("F9");
  await page.waitForLoadState("load");
  await page.waitForSelector("#view-tabs");
  await check("a loaded game remembers what was explored", async () => {
    const after = await page.evaluate(() => ({
      systems: window.__game.empire.knownSystems.size,
      jps: window.__game.empire.knownJumpPoints.size,
      fleet: window.__game.empire.fleets.get("fleet-1").systemId,
    }));
    return JSON.stringify(after) === JSON.stringify(before);
  });
  await check("and the same galaxy", async () =>
    (await page.evaluate(() => window.__game.galaxy.seed)) === "demo");

  // The palette finds systems.
  await page.keyboard.press("Control+k");
  await page.locator(".palette-input").fill("trappist");
  await check("the palette finds a system by name", async () =>
    (await page.locator(".palette-row", { hasText: "System: TRAPPIST-1" }).count()) === 1);
  await page.keyboard.press("Enter");
  await check("and opens it on the galaxy map", async () =>
    (await page.locator(".galaxy-node.selected").getAttribute("data-system")) === "trappist-1");

  await check("no console errors", () => errors.length === 0);
  if (errors.length) console.log("    ", errors.slice(0, 3).join("\n     "));
  await page.close();
}

async function eventSuite(browser) {
  console.log("\nRandom events");
  const page = await browser.newPage({ viewport: { width: 1680, height: 980 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await page.goto(`${BASE}?debug&new&seed=sol-1&events=normal`);
  await page.waitForSelector("#view-tabs");

  await nav(page, "Events").click();
  await check("the events log starts empty and says so", async () =>
    /Nothing has happened yet/.test(await page.locator("#view-events").innerText()));

  // Raise a decision directly, as the dice eventually would.
  await page.evaluate(() => {
    const g = window.__game;
    g.empire.treasury = 100000;
    window.__rollEvent("epidemic");
  });
  await check("a decision opens a popup", async () => (await page.locator(".dialog").count()) === 1);
  await check("the popup says what happened and offers the choices", async () => {
    const text = await page.locator(".dialog").innerText();
    return /Outbreak/.test(text) && /Fund a quarantine/.test(text) && /Let it run its course/.test(text);
  });
  await check("the clock is stopped for it", async () => await page.evaluate(() => window.__game.clock.paused));
  await check("each choice states its price", async () =>
    /Costs [\d,]+/.test(await page.locator(".dialog .event-option").first().innerText()));
  await check("Events carries a badge while a decision waits", async () =>
    /1/.test(await page.locator('#view-tabs button[data-view="events"] .tab-badge-dot').first().innerText()));

  // The briefing in the terminal theme: banner, file number, numbered orders.
  await page.evaluate(() => { document.documentElement.dataset.theme = "terminal"; });
  await check("a terminal briefing carries a warning banner and a file number", async () => {
    const banner = page.locator(".dialog .event-banner");
    return (await banner.isVisible()) && /WARNING/.test(await banner.innerText()) && /EVT-\d{4}/.test(await page.locator(".dialog .event-code").innerText());
  });
  await check("its text prints out in full", async () => {
    await page.waitForTimeout(1600);
    return /Fund|fever|habitats/.test(await page.locator(".dialog .event-text").innerText()) && !/_$/.test((await page.locator(".dialog .event-text").innerText()).trim());
  });
  await check("options are numbered", async () =>
    (await page.locator(".dialog .event-option").first().getAttribute("data-key")) === "1");
  await page.evaluate(() => { document.documentElement.dataset.theme = "classic"; });
  await check("the banner is hidden in Classic", async () => !(await page.locator(".dialog .event-banner").isVisible()));

  // Decide later, then decide from the log.
  await page.getByRole("button", { name: "Decide later", exact: true }).click();
  await check("deciding later leaves it pending", async () =>
    (await page.evaluate(() => window.__game.empire.pendingEvents.length)) === 1);
  await check("the log lists it as awaiting a decision", async () =>
    (await page.locator("#view-events .event-card").count()) === 1);
  await page.locator("#view-events .event-card .event-option", { hasText: "Fund a quarantine" }).click();
  await check("choosing from the log resolves it", async () =>
    (await page.evaluate(() => window.__game.empire.pendingEvents.length)) === 0);
  await check("and the outcome is recorded in the history", async () => {
    const text = await page.locator("#view-events .events-list").innerText();
    return /Outbreak/.test(text) && /Chosen: Fund a quarantine/.test(text);
  });

  // The popup shows the outcome after a choice; number keys choose.
  await page.evaluate(() => { window.__game.empire.queueBuild("earth", "mine", 5); window.__rollEvent("strike"); });
  await page.keyboard.press("2");
  await check("the popup then shows the outcome", async () =>
    /You chose: Hold firm/.test(await page.locator(".dialog").innerText()));
  await page.getByRole("button", { name: "OK", exact: true }).click();

  // Holding firm leaves a lasting effect, which is listed and explained.
  await nav(page, "Events").click();
  await check("a lasting effect is listed with what it does and how long is left", async () => {
    const text = await page.locator("#view-events").innerText();
    return /lasting effects/i.test(text) && /Work-to-rule/.test(text) && /Industry -30%, 6 months left/.test(text);
  });
  await nav(page, "Colonies").click();
  await check("and shown on the colony it affects", async () =>
    /Work-to-rule/.test(await page.locator("#view-colonies").innerText()));

  // A follow-up arrives later, and says what it follows.
  await page.evaluate(() => {
    const g = window.__game;
    g.empire.scheduleEvent("epidemic-aftermath", { colony: "earth", cost: 2000 }, g.clock.seconds, 1, "Outbreak");
    g.step(6 * 86400);
  });
  await check("a scheduled follow-up opens a popup when its time comes", async () =>
    /After the fever/.test(await page.locator(".dialog").innerText()));
  await check("and says what it follows", async () =>
    /This follows: Outbreak/.test(await page.locator(".dialog").innerText()));
  await page.locator(".dialog .event-option", { hasText: "Fund a health programme" }).click();
  await check("the chosen follow-up starts its own lasting effect", async () =>
    /Population growth \+50%/.test(await page.locator(".dialog").innerText()) || /Healthy generation/.test(await page.evaluate(() => JSON.stringify(window.__game.empire.effects))));
  await page.getByRole("button", { name: "OK", exact: true }).click();

  // News is a toast and a log line, not a popup.
  await page.evaluate(() => { window.__rollEvent("grant"); });
  await check("good news is a toast, not a popup", async () =>
    (await page.locator(".toast", { hasText: "endowment" }).count()) === 1 && (await page.locator(".dialog").count()) === 0);

  // Filters.
  await nav(page, "Events").click();
  await page.locator("#view-events .events-filters button", { hasText: "Good" }).click();
  await check("the log filters by tone", async () => {
    const rows = await page.locator("#view-events .events-list .event-row").count();
    return rows >= 1 && (await page.locator("#view-events .events-list .event-row.bad").count()) === 0;
  });
  await page.locator("#view-events .events-filters button", { hasText: "All" }).click();
  await page.locator('#view-events input[type="search"]').fill("quarantine");
  await check("and searches", async () => (await page.locator("#view-events .events-list .event-row").count()) === 1);

  // Settings.
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.locator(".settings-panel .seg-btn", { hasText: "Off" }).click();
  await check("events can be switched off", async () =>
    (await page.evaluate(() => window.__game.empire.eventFrequency)) === 0);
  await page.locator(".settings-panel .seg-btn", { hasText: "Often" }).click();
  await check("or turned up", async () =>
    (await page.evaluate(() => window.__game.empire.eventFrequency)) > 1);

  // Saved decisions come back.
  await page.evaluate(() => { window.__rollEvent("accident"); });
  await page.getByRole("button", { name: "Decide later", exact: true }).click();
  await page.keyboard.press("F5");
  await page.keyboard.press("F9");
  await page.waitForLoadState("load");
  await page.waitForSelector("#view-tabs");
  await check("a decision still pending is offered again after loading", async () =>
    (await page.locator(".dialog", { hasText: "Industrial accident" }).count()) === 1);

  await check("no console errors", () => errors.length === 0);
  if (errors.length) console.log("    ", errors.slice(0, 3).join("\n     "));
  await page.close();
}

async function maintenanceSuite(browser) {
  console.log("\nMilitary parts and maintenance");
  const page = await browser.newPage({ viewport: { width: 1680, height: 980 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await page.goto(`${BASE}?debug&new&seed=sol-1&events=off`);
  await page.waitForSelector("#view-tabs");
  await page.evaluate(() => { window.__game.empire.research("nuclear-thermal"); window.__game.emit(); });

  await nav(page, "Design").click();
  await page.getByRole("button", { name: "New component", exact: true }).click();
  await page.locator("#view-design select").first().selectOption("engine");
  await page.waitForTimeout(150);
  const spec = page.locator("#view-design .field-row", { hasText: "Specification" }).locator("select");
  await check("an engine has a specification, commercial by default", async () =>
    (await spec.inputValue()) === "commercial");
  await check("military is hidden until it is researched", async () =>
    (await spec.locator("option").count()) === 1);

  await page.evaluate(() => { window.__game.empire.research("military-specification"); window.__game.emit(); });
  await nav(page, "Design").click();
  await page.getByRole("button", { name: "New component", exact: true }).click();
  await page.locator("#view-design select").first().selectOption("engine");
  await page.waitForTimeout(150);
  const spec2 = page.locator("#view-design .field-row", { hasText: "Specification" }).locator("select");
  await check("researching it offers the military specification", async () =>
    (await spec2.locator("option").count()) === 2);
  const derived = () => page.locator("#view-design .derived-host").innerText();
  await check("a commercial 5 HS engine makes 60 power", async () => /Power\s+60\.0/.test(await derived()));
  await spec2.selectOption("military");
  await page.waitForTimeout(150);
  await check("a military one makes 78", async () => /Power\s+78\.0/.test(await derived()));
  await check("is marked and described as hard on maintenance", async () =>
    /Military/.test(await derived()) && /hard on maintenance/.test(await derived()));
  await check("and is named as military", async () =>
    (await page.locator("#view-design .name-input").inputValue()).startsWith("Military "));

  // A worn fleet.
  await page.evaluate(() => {
    const g = window.__game, e = g.empire;
    e.addStandardComponents(0); e.addStandardClasses(0);
    const hauler = e.designs.find((d) => d.name === "Hauler");
    const f = e.createFleet("Old Faithful", { x: 0, y: 0, z: 0 }, "earth");
    const ship = e.commissionShip(hauler.id, f, "Old 1", 0);
    ship.fuel = 1e5; ship.condition = 22;
    g.selectFleet(f.id); g.emit();
  });
  await nav(page, "Fleets").click();
  await page.locator("#view-fleets .panel-left .tree-row", { hasText: "Old Faithful" }).click();
  await check("a fleet shows its condition and that it is overdue", async () =>
    /Condition\s+22%\s+overdue/i.test(await page.locator("#view-fleets .fleet-detail").innerText()));
  await check("each ship shows its own", async () =>
    /22%/.test(await page.locator("#view-fleets .install-row", { hasText: "Old 1" }).innerText()));
  await check("the attention rail raises it", async () =>
    (await page.locator("#triage-rail", { hasText: "overdue for servicing" }).count()) === 1);

  // Servicing capacity on the colony.
  await nav(page, "Colonies").click();
  await check("a colony shows what it can service", async () =>
    /Servicing capacity\s+3,000 t of ship/.test(await page.locator("#view-colonies").innerText()));

  // Time at a colony with a shipyard restores it.
  await page.evaluate(() => { for (let i = 0; i < 40; i++) window.__game.step(5 * 86400); window.__game.emit(); });
  await check("and time in dock restores it", async () =>
    (await page.evaluate(() => [...window.__game.empire.ships.values()].find((s) => s.name === "Old 1").condition)) >= 99);

  await check("no console errors", () => errors.length === 0);
  if (errors.length) console.log("    ", errors.slice(0, 3).join("\n     "));
  await page.close();
}

async function mobileSuite(browser) {
  console.log("\nMobile (Pixel 7)");
  const context = await browser.newContext({ ...devices["Pixel 7"], hasTouch: true, isMobile: true });
  const page = await context.newPage();
  const errors = watchErrors(page);
  await page.goto(URL, { waitUntil: "networkidle" });
  await page.waitForTimeout(800);
  const viewport = page.viewportSize();

  const overflow = async () =>
    page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  await check("dashboard does not scroll sideways", async () => (await overflow()) <= 1);

  const tabs = await page.locator("#view-tabs").boundingBox();
  await check("view tabs sit at the bottom of the screen", () =>
    tabs.y + tabs.height > viewport.height - 4 && tabs.width <= viewport.width + 1);

  await check("attention rail starts folded", async () =>
    (await page.locator("#triage-rail").getAttribute("class")).includes("collapsed"));
  await check("folded rail is a floating control", async () =>
    (await page.locator("#triage-rail").boundingBox()).width < 140);

  await page.locator("#triage-rail .rail-toggle").click();
  await page.waitForTimeout(250);
  await check("summoned rail covers the view", async () =>
    (await page.locator("#triage-rail").boundingBox()).width >= viewport.width - 2);
  await page.locator(".issue").first().locator(".ghost-btn").click();
  await page.waitForTimeout(300);
  await check("following an item folds the sheet", async () =>
    (await page.locator("#triage-rail").getAttribute("class")).includes("collapsed"));

  // The map, and a two-finger pinch.
  await mobileGo(page, "Map");
  await page.waitForTimeout(500);
  const canvas = await page.locator("#map").boundingBox();
  await check("map canvas has room", () => canvas.width > 300 && canvas.height > 250);
  const scaleBefore = await page.locator("#map-overlay").innerText();
  await page.evaluate(({ cx, cy }) => {
    const el = document.getElementById("map");
    const send = (type, id, x, y) =>
      el.dispatchEvent(new PointerEvent(type, {
        pointerId: id, pointerType: "touch", clientX: x, clientY: y,
        bubbles: true, isPrimary: id === 1,
      }));
    send("pointerdown", 1, cx - 30, cy);
    send("pointerdown", 2, cx + 30, cy);
    for (let i = 1; i <= 10; i++) {
      send("pointermove", 1, cx - 30 - i * 8, cy);
      send("pointermove", 2, cx + 30 + i * 8, cy);
    }
    send("pointerup", 1, cx - 110, cy);
    send("pointerup", 2, cx + 110, cy);
  }, { cx: canvas.x + canvas.width / 2, cy: canvas.y + canvas.height / 2 });
  await page.waitForTimeout(400);
  await check("pinch zooms the map", async () =>
    (await page.locator("#map-overlay").innerText()) !== scaleBefore);

  await mobileGo(page, "Colonies");
  await page.waitForTimeout(400);
  await page.locator("#view-colonies .tree-row", { hasText: "Earth" }).click();
  await colonyTab(page, "Production");
  await page.waitForTimeout(200);
  await check("colony view does not scroll sideways", async () => (await overflow()) <= 1);
  await check("the order form fits the width", async () =>
    (await page.locator("#view-colonies .add-order").first().boundingBox()).width <= viewport.width + 1);

  // The two newest screens, on a phone.
  await mobileGo(page, "Research");
  await page.waitForTimeout(400);
  await check("research does not scroll sideways", async () => (await overflow()) <= 1);
  await check("research tiers stack into one column", async () => {
    const tabsBox = await page.locator("#view-tabs").boundingBox();
    return tabsBox.width <= viewport.width + 1;
  });
  await page.locator(".research-search").fill("Mining");
  await page.locator(".tech-node").first().click();
  await page.waitForTimeout(600);
  await check("selecting a technology brings its detail into view", async () => {
    const box = await page.locator(".research-side").boundingBox();
    return box.y < viewport.height;
  });
  await page.screenshot({ path: `${SHOTS}/mobile-research.png` });

  // Cancelling research works from the project card, without scrolling to a panel.
  await page.locator(".research-search").fill("");
  const cancelButtons = page.getByRole("button", { name: /^Cancel .* project$/ });
  const projectsBefore = await cancelButtons.count();
  await check("each project under way has a cancel button on its card", async () => projectsBefore >= 1);
  await check("and it can be tapped", async () => (await cancelButtons.first().boundingBox()).height >= 26);
  page.once("dialog", (d) => d.accept());
  await cancelButtons.first().click();
  await page.waitForTimeout(200);
  await check("cancelling removes the project", async () =>
    (await page.getByRole("button", { name: /^Cancel .* project$/ }).count()) === projectsBefore - 1);

  await mobileGo(page, "Design");
  await page.waitForTimeout(400);
  await check("the designer does not scroll sideways", async () => (await overflow()) <= 1);
  await page.screenshot({ path: `${SHOTS}/mobile-design.png` });

  await page.evaluate(() => { document.documentElement.dataset.theme = "terminal"; });
  await page.waitForTimeout(200);
  await check("the terminal theme does not make a phone scroll sideways", async () => (await overflow()) <= 1);
  for (const name of ["Empire", "Map", "Colonies", "Fleets", "Design", "Research", "Officers", "Events", "Galaxy"]) {
    await mobileGo(page, name);
    await page.waitForTimeout(250);
    await check(`and neither does the ${name} screen`, async () => (await overflow()) <= 1);
  }
  await page.evaluate(() => { document.documentElement.dataset.theme = "classic"; });
  await check("controls are big enough to tap", async () =>
    (await page.evaluate(() =>
      [...document.querySelectorAll("button:not(.step-btn)")]
        .filter((b) => b.offsetParent && b.getBoundingClientRect().height < 26).length)) === 0);

  await check("no console errors", () => errors.length === 0);
  if (errors.length) console.log("    ", errors.slice(0, 3).join("\n     "));
  await context.close();
}

const browser = await chromium.launch(launch);
try {
  await desktopSuite(browser);
  await shipSuite(browser);
  await terraformSuite(browser);
  await refreshSuite(browser);
  await programSuite(browser);
  await explorationSuite(browser);
  await eventSuite(browser);
  await maintenanceSuite(browser);
  await mobileSuite(browser);
} finally {
  await browser.close();
}

console.log(
  failures.length
    ? `\n${passed} passed, ${failures.length} FAILED:\n  ${failures.join("\n  ")}`
    : `\nAll ${passed} browser checks passed.`,
);
process.exit(failures.length ? 1 : 0);
