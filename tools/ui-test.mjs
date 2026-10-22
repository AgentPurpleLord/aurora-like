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

const URL = process.env.UI_TEST_URL ?? "http://localhost:5173/";
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
  await page.getByRole("button", { name: "Research", exact: true }).click();
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
  await page.getByRole("button", { name: "Empire", exact: true }).click();
  const issuesBefore = await page.locator(".issue").count();
  await page.locator(".issue").first().locator(".step-btn").click();
  await page.waitForTimeout(200);
  await check("dismissing an item removes it", async () =>
    (await page.locator(".issue").count()) === issuesBefore - 1);

  // --- settle two moons to develop
  for (const moon of ["Callisto", "Ganymede"]) {
    await page.getByRole("button", { name: "Map", exact: true }).click();
    await page.locator(".tree-row", { hasText: moon }).first().click();
    await page.getByRole("button", { name: "Colony", exact: true }).click();
    await page.getByRole("button", { name: "Establish Colony" }).click();
  }
  await check("the map opens framed on the inner system", async () =>
    /Scale 0\.\d+ AU/.test(await page.locator("#map-overlay").innerText()));

  // --- commit-time preview
  await page.getByRole("button", { name: "Colonies", exact: true }).click();
  await page.locator("#view-colonies .tree-row", { hasText: "Earth" }).click();
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
  const templates = page.locator("#view-colonies .section", { hasText: "Development Templates" }).first();
  await check("template lists what it would build", async () =>
    (await templates.locator(".template-item").count()) >= 2);
  await templates.getByRole("button", { name: "Apply" }).click();
  await page.waitForTimeout(200);
  await page.locator("#view-colonies .tree-row", { hasText: "Earth" }).click();
  await check("applying a template queues work for the target", async () =>
    (await page.locator("#view-colonies .queue-row").allInnerTexts()).some((t) => t.includes("Callisto")));

  // --- bulk apply across colonies
  await page.getByRole("button", { name: "Empire", exact: true }).click();
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
  await page.getByRole("button", { name: "Colonies", exact: true }).click();
  await page.locator("#view-colonies .tree-row", { hasText: "Earth" }).click();
  const queued = (await page.locator("#view-colonies .queue-row").allInnerTexts()).join(" | ");
  await check("bulk apply queued for every target", () =>
    queued.includes("Ganymede") && queued.includes("Callisto"));

  // --- standing orders
  await page.locator("#view-colonies .tree-row", { hasText: "Callisto" }).click();
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
  await page.getByRole("button", { name: "Officers", exact: true }).click();
  await page.getByRole("button", { name: /Administrators/ }).click();
  await page.locator(".officer-row").nth(1).click();
  await page.locator("#view-officers .panel-right select").selectOption("callisto");
  await check("an administrator can be posted to a new colony", async () =>
    (await page.locator("#view-officers .panel-right").innerText()).includes("Governor, Callisto"));

  // Earth, not one of the new moons: a governor will not propose mining
  // ground the empire has never surveyed.
  await page.getByRole("button", { name: "Colonies", exact: true }).click();
  await page.locator("#view-colonies .tree-row", { hasText: "Earth" }).click();
  await page.locator("#view-colonies .policy-row select").selectOption("mine");
  await page.waitForTimeout(300);
  await check("mining is not proposed for an unsurveyed world", async () =>
    (await page.locator(".issue", { hasText: "Callisto: work the deposits" }).count()) === 0);
  const proposal = page.locator(".issue", { hasText: "Earth: work the deposits" }).first();
  await check("a governor policy produces a proposal", async () =>
    (await proposal.count()) > 0 && /Queue \d+/.test(await proposal.innerText()));
  const before = await page.locator("#view-colonies .queue-row").count();
  await proposal.getByRole("button").first().click();
  await page.waitForTimeout(300);
  await page.locator("#view-colonies .tree-row", { hasText: "Earth" }).click();
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
  await page.getByRole("button", { name: "Research", exact: true }).click();
  await check("research opens on what is ready to start", async () =>
    (await page.locator(".research-tab.active").innerText()).includes("Ready now"));
  await check("the summary strip shows laboratories and scientists", async () =>
    /Laboratories/i.test(await page.locator(".research-summary").innerText()));
  await check("projects under way are listed at the top", async () =>
    (await page.locator(".proj-card").count()) >= 1);

  await page.getByRole("button", { name: /^Propulsion/ }).click();
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
  await page.getByRole("button", { name: "Design", exact: true }).click();
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
  await page.getByRole("button", { name: "Design", exact: true }).click();
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
  await page.getByRole("button", { name: "Fleets", exact: true }).click();
  const runner = page.locator("#view-fleets .project-card", { hasText: "Test Runner" }).first();
  await check("the class is offered for building", async () => (await runner.count()) === 1);
  await runner.getByRole("button", { name: "Build", exact: true }).click();
  await page.getByRole("button", { name: "30 days/s", exact: true }).click();
  await page.waitForTimeout(4500);
  await page.getByRole("button", { name: "Pause", exact: true }).click();
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

  await page.getByRole("button", { name: "Map", exact: true }).click();
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
  await page.getByRole("button", { name: "Map", exact: true }).click();
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
  await page.getByRole("button", { name: "Research", exact: true }).click();
  await page.locator(".research-search").fill("Terraforming Technology");
  await check("terraforming technology is researched", async () =>
    (await page.locator(".tech-node", { hasText: "Terraforming Technology" }).first().innerText())
      .includes("Researched"));

  // Build the processors on Earth and ship them to Mars.
  await page.getByRole("button", { name: "Colonies", exact: true }).click();
  await page.locator("#view-colonies .tree-row", { hasText: "Earth" }).click();
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
  const text = await page.locator("#view-colonies .section", { hasText: "Colony" }).first().innerText();
  const match = text.match(/Temperature\s+(\d+)\s*K/);
  return match ? Number(match[1]) : NaN;
}

// ----------------------------------------------------------------- mobile

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
  await page.locator("#view-tabs").getByRole("button", { name: "Map" }).click();
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

  await page.locator("#view-tabs").getByRole("button", { name: "Colonies" }).click();
  await page.waitForTimeout(400);
  await page.locator("#view-colonies .tree-row", { hasText: "Earth" }).click();
  await page.waitForTimeout(200);
  await check("colony view does not scroll sideways", async () => (await overflow()) <= 1);
  await check("the order form fits the width", async () =>
    (await page.locator("#view-colonies .add-order").first().boundingBox()).width <= viewport.width + 1);

  // The two newest screens, on a phone.
  await page.locator("#view-tabs").getByRole("button", { name: "Research" }).click();
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

  await page.locator("#view-tabs").getByRole("button", { name: "Design" }).click();
  await page.waitForTimeout(400);
  await check("the designer does not scroll sideways", async () => (await overflow()) <= 1);
  await page.screenshot({ path: `${SHOTS}/mobile-design.png` });

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
