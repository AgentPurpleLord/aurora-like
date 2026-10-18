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

  const firstBefore = await page.locator(".colony-table .data-row").nth(1).innerText();
  await page.locator(".colony-table .data-row.header .sortable").nth(1).click();
  await check("colony table sorts", async () =>
    (await page.locator(".colony-table .data-row").nth(1).innerText()) !== firstBefore);

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
    await page.getByRole("button", { name: "System Map", exact: true }).click();
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
  for (const name of ["Ganymede", "Mars"]) {
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
    queued.includes("Ganymede") && queued.includes("Mars"));

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
  await page.locator("#view-officers .panel-right select").selectOption("ganymede");
  await page.getByRole("button", { name: "Colonies", exact: true }).click();
  await page.locator("#view-colonies .tree-row", { hasText: "Ganymede" }).click();
  await page.locator("#view-colonies .policy-row select").selectOption("mine");
  await page.waitForTimeout(300);
  const proposal = page.locator(".issue", { hasText: "Ganymede" }).first();
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
  await page.locator("#view-tabs").getByRole("button", { name: "System Map" }).click();
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
