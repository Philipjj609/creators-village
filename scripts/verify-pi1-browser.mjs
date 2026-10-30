import { chromium, firefox, webkit, expect } from "@playwright/test";
import fs from "node:fs/promises";
const origin = "http://localhost:5174",
  out = process.env.CV_EVIDENCE_DIR ?? "docs/testing/evidence/pi1";
await fs.mkdir(out, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  args: ["--enable-unsafe-swiftshader"],
});
const owner = await browser.newContext({
    viewport: { width: 1440, height: 1080 },
  }),
  member = await browser.newContext({
    viewport: { width: 1440, height: 1080 },
  });
async function projects(p) {
  const b = p.getByRole("button", { name: "Community projects", exact: true });
  if ((await b.getAttribute("aria-pressed")) !== "true") await b.click();
}
const op = await owner.newPage(),
  mp = await member.newPage(),
  errors = [];
for (const p of [op, mp]) p.on("pageerror", (e) => errors.push(e.message));
try {
  const response = await owner.request.get(
      "http://localhost:3002/__wf2_test/login/owner",
    ),
    fixture = await response.json();
  await member.request.get("http://localhost:3002/__wf2_test/login/member");
  await op.goto(origin + "/");
  await expect(
    op.getByRole("heading", {
      name: "A home for your community.",
    }),
  ).toBeVisible();
  await op.screenshot({ path: out + "/landing.png" });
  await op
    .getByRole("link", { name: "My Communities", exact: true })
    .first()
    .click();
  await expect(
    op.getByRole("heading", { name: "Your creator village" }),
  ).toBeVisible();
  await expect(op.getByText("Follow discovery not connected")).toBeVisible();
  await op.screenshot({
    path: out + "/communities.png",
    mask: [op.locator("[data-private]")],
  });
  await op.goto(origin + "/playtest?world=" + fixture.worldId);
  await op
    .getByRole("button", {
      name: "Village settings and management",
      exact: true,
    })
    .click();
  await op
    .getByRole("button", { name: "Enable private participation", exact: true })
    .click();
  await expect(op.locator('[data-render-state="ready"]')).toBeVisible({
    timeout: 30000,
  });
  await op.screenshot({
    path: out + "/fixture-before.png",
    mask: [op.locator("[data-private]")],
    maskColor: "#ddd8cb",
  });
  await op
    .getByRole("button", { name: "Community and admission", exact: true })
    .click();
  await op
    .getByRole("button", { name: "Create one-use, 24-hour request link" })
    .click();
  const input = op.getByLabel("Share this privately");
  await expect(input).not.toHaveValue("");
  const link = await input.inputValue();
  await mp.goto(link);
  await expect(
    mp.getByRole("button", { name: "Request creator approval" }),
  ).toBeVisible();
  await mp.getByRole("button", { name: "Request creator approval" }).click();
  await expect(
    mp.getByText(
      "Request recorded. A request does not grant village access. Check approval for current status.",
    ),
  ).toBeVisible();
  await op
    .getByRole("button", { name: "Refresh admission", exact: true })
    .click();
  await op.getByRole("button", { name: "Approve", exact: true }).click();
  await mp.getByRole("button", { name: "Check approval" }).click();
  await mp
    .getByRole("link", { name: "Enter approved development village" })
    .click();
  await expect(mp.locator('[data-render-state="ready"]')).toBeVisible({
    timeout: 30000,
  });
  await projects(op);
  await op
    .getByRole("button", { name: "Plan a workshop", exact: true })
    .click();
  await op.getByRole("button", { name: "Preview workshop plan" }).click();
  await op.getByRole("button", { name: "Publish this fixed plan" }).click();
  await projects(op);
  await projects(mp);
  await expect(
    mp.getByRole("button", { name: "Contribute once to this project" }),
  ).toBeVisible({ timeout: 10000 });
  await op.screenshot({
    path: out + "/fixture-project.png",
    mask: [op.locator("[data-private]")],
    maskColor: "#ddd8cb",
  });
  const firstOptIn = op.getByRole("checkbox", {
    name: "Name me on this project and its resulting building (optional)",
  });
  await expect(firstOptIn).not.toBeChecked();
  await firstOptIn.check();
  await expect(
    mp.getByRole("checkbox", {
      name: "Name me on this project and its resulting building (optional)",
    }),
  ).not.toBeChecked();
  await op
    .getByRole("button", { name: "Contribute once to this project" })
    .click();
  await expect(mp.getByText("1/2 contributions · open")).toBeVisible({
    timeout: 10000,
  });
  const thresholdAt = performance.now();
  await mp
    .getByRole("button", { name: "Contribute once to this project" })
    .click();
  await expect(op.getByText("2/2 contributions · completed")).toBeVisible({
    timeout: 10000,
  });
  const visibleMs = performance.now() - thresholdAt;
  await expect(
    op.getByText("With thanks to Fixture owner", { exact: true }),
  ).toBeVisible();
  await op
    .getByRole("button", { name: "Withdraw my named credit", exact: true })
    .click();
  await expect(
    op.getByText("With thanks to Fixture owner", { exact: true }),
  ).toHaveCount(0);
  let releaseOld;
  const oldGate = new Promise((r) => {
    releaseOld = r;
  });
  let captured;
  const capturedGate = new Promise((r) => {
    captured = r;
  });
  let first = true;
  await op.route("**/projects/*/credits", async (route) => {
    if (first) {
      first = false;
      const response = await route.fetch();
      const body = await response.body();
      captured();
      await oldGate;
      await route.fulfill({ response, body });
    } else await route.continue();
  });
  await op
    .getByRole("button", {
      name: "Opt into named credit for this project/building",
    })
    .click();
  await capturedGate;
  await op
    .getByRole("button", { name: "Withdraw my named credit", exact: true })
    .click();
  await op.waitForTimeout(300);
  releaseOld();
  await op.waitForTimeout(350);
  await expect(
    op.getByText("With thanks to Fixture owner", { exact: true }),
  ).toHaveCount(0);
  await op.unroute("**/projects/*/credits");
  await owner.setOffline(true);
  await op.waitForTimeout(2500);
  await expect(op.getByText("2/2 contributions · completed")).toBeVisible();
  await expect(op.getByRole("status").first()).toContainText(/Disconnected/);
  await owner.setOffline(false);
  await expect(op.getByRole("status").first()).toContainText(/Connected/, {
    timeout: 10000,
  });
  await mp.getByRole("button", { name: "Places", exact: true }).click();
  await op.getByRole("button", { name: "Places", exact: true }).click();
  await expect(
    mp.getByRole("button", { name: "Inspect the Mending Shed" }),
  ).toBeVisible();
  await op.getByRole("button", { name: "Inspect the Mending Shed" }).click();
  await op
    .getByRole("button", { name: "Take a closer look", exact: true })
    .click();
  await op.waitForTimeout(700);
  await op.screenshot({
    path: out + "/fixture-focused.png",
    mask: [op.locator("[data-private]")],
    maskColor: "#ddd8cb",
  });
  await op
    .getByRole("button", { name: "Village overview", exact: true })
    .first()
    .click();
  await op.waitForTimeout(600);
  await op.screenshot({
    path: out + "/fixture-completed.png",
    mask: [op.locator("[data-private]")],
    maskColor: "#ddd8cb",
  });
  await mp.route("**/stream?*", (route) => route.abort());
  await mp.reload();
  await projects(mp);
  await projects(op);
  await op
    .getByRole("button", { name: "Plan a workshop", exact: true })
    .click();
  await op.getByLabel("East coordinate").fill("-7");
  await op.getByRole("button", { name: "Preview workshop plan" }).click();
  await op.getByRole("button", { name: "Show this draft on the map" }).click();
  await op.getByRole("button", { name: "Publish this fixed plan" }).click();
  await projects(op);
  await expect(
    op.getByRole("checkbox", {
      name: "Name me on this project and its resulting building (optional)",
    }),
  ).not.toBeChecked();
  await expect(
    mp.getByRole("button", { name: "Contribute once to this project" }),
  ).toBeVisible({ timeout: 10000 });
  await op
    .getByRole("button", { name: "Cancel project and release reservations" })
    .click();
  await expect(mp.getByText("0/2 contributions · cancelled")).toBeVisible({
    timeout: 10000,
  });
  await mp.unroute("**/stream?*");
  await mp.reload();
  await expect(mp.getByText("2/2 contributions · completed")).toBeVisible();
  await expect(mp.locator('[data-render-state="ready"]')).toBeVisible();
  const matrix = [];
  for (const [name, engine, viewport, touch] of [
    ["Firefox desktop", firefox, { width: 1440, height: 1080 }, false],
    ["WebKit desktop", webkit, { width: 1440, height: 1080 }, false],
    ["Chromium touch emulation", chromium, { width: 390, height: 844 }, true],
  ]) {
    const b = await engine.launch({
      headless: true,
      ...(engine === chromium ? { args: ["--enable-unsafe-swiftshader"] } : {}),
    });
    const c = await b.newContext({
      viewport,
      hasTouch: touch,
      ...(touch ? { isMobile: true, deviceScaleFactor: 2 } : {}),
    });
    await c.request.get("http://localhost:3002/__wf2_test/login/owner");
    const p = await c.newPage();
    p.on("pageerror", (e) => errors.push(e.message));
    await p.goto(origin + "/playtest?world=" + fixture.worldId);
    await expect(p.locator('[data-render-state="ready"]')).toBeVisible({
      timeout: 30000,
    });
    await projects(p);
    await expect(p.getByText("2/2 contributions · completed")).toBeVisible();
    await p.getByRole("button", { name: "Close panel", exact: true }).click();
    await p.getByRole("button", { name: "Places", exact: true }).click();
    await p.getByRole("button", { name: "Inspect the Mending Shed" }).click();
    await p
      .getByRole("button", { name: "Take a closer look", exact: true })
      .click();
    await expect(p.locator("canvas")).toHaveCount(1);
    const overflow = await p.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    );
    if (overflow) throw Error(name + " horizontal overflow");
    await p.waitForTimeout(400);
    await p.screenshot({
      path:
        out + "/fixture-" + name.toLowerCase().replaceAll(" ", "-") + ".png",
      mask: [p.locator("[data-private]")],
      maskColor: "#ddd8cb",
    });
    matrix.push({
      name,
      version: b.version(),
      viewport,
      touchEmulation: touch,
      loaded: true,
      focus: true,
    });
    await b.close();
  }
  if (errors.length) throw Error("Browser page errors: " + errors.join("; "));
  const report = {
    date: new Date().toISOString(),
    identity: "Two synthetic fixture identities, NOT real Twitch/human proof",
    chromium: browser.version(),
    viewport: { width: 1440, height: 1080 },
    thresholdClickToOtherClientCompletedMs: Math.round(visibleMs),
    matrix,
    pageErrors: errors,
    verified: [
      "Explicit enable/admission/link confirmation",
      "Two separate cookie contexts contribute once",
      "Other client observes aggregate progress and atomic completion",
      "Project opt-in defaults do not carry to a new project; stale credit HTTP response cannot restore withdrawn label",
      "Offline retains committed state and recovers; HTTP replay works when SSE is blocked",
      "Same-world workshop focus, overview and reload",
      "Firefox/WebKit and touch viewport renderer/focus",
    ],
    limitations: [
      "No physical devices, Safari product, older GPU or real second human tested",
      "Click-to-visible sample includes command/UI latency; not a p95 benchmark",
      "Private live world unmodified; captures are explicitly synthetic fixtures",
      "Art gate remains open",
      "PI1 product review pending; physical-device tests unavailable",
    ],
  };
  await fs.writeFile(
    out + "/browser-flow.json",
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report));
} finally {
  await owner.close();
  await member.close();
  await browser.close();
}
