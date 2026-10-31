// Local synthetic LW1.1 verification. No clock overrides or staged behavior in visual captures.
import { chromium, firefox, webkit, expect } from "@playwright/test";
import fs from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { evaluateResidents } from "../packages/world/dist/living.js";
const origin = "http://localhost:5176",
  api = "http://localhost:3004",
  out = "docs/testing/evidence/lw11",
  clipDir = ".local/lw11/clips";
await fs.mkdir(out, { recursive: true });
await fs.mkdir(clipDir, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  args: ["--enable-unsafe-swiftshader"],
});
const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  }),
  page = await context.newPage(),
  errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const fixture = await (
    await context.request.get(api + "/__wf2_test/login/owner")
  ).json(),
  url = origin + "/villages/" + fixture.worldId;
async function select(p, name = "Mira Fen") {
  await p.getByRole("button", { name: "Places", exact: true }).click();
  await p.getByRole("button", { name: new RegExp(name) }).click();
  await expect(p.getByRole("heading", { name, exact: true })).toBeVisible();
}
async function metrics() {
  const settings = page.getByRole("button", {
    name: "Village settings and management",
    exact: true,
  });
  if ((await settings.getAttribute("aria-pressed")) !== "true")
    await settings.click();
  const d = page
    .locator("details")
    .filter({ has: page.getByText("Technical diagnostics", { exact: true }) });
  if (!(await d.evaluate((n) => n.open))) await d.locator("summary").click();
  await page
    .getByRole("button", { name: "Measure renderer", exact: true })
    .click();
  return JSON.parse(await page.locator("[data-wf2-metrics]").innerText());
}
const report = {
  date: new Date().toISOString(),
  fixture: "isolated synthetic world, never real Twitch activity",
  browser: browser.version(),
  checks: [],
  matrix: [],
  clips: [],
  errors,
};
try {
  const plan = await (
    await context.request.get(
      api + `/api/founding/${fixture.worldId}/residents`,
    )
  ).json();
  expect(plan.rules).toBe("lw1-goals-1");
  expect(JSON.stringify(plan).length).toBeLessThan(128 * 1024);
  report.planBytes = Buffer.byteLength(JSON.stringify(plan));
  await page.goto(url);
  await page.locator("[data-render-state=ready]").waitFor();
  await page.getByRole("button", { name: "Zoom in", exact: true }).click();
  await page.waitForTimeout(800);
  await page.mouse.move(400, 400);
  await page.mouse.down();
  await page.mouse.move(500, 440, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(1100);
  const previous = await metrics();
  await select(page);
  await page
    .getByRole("button", { name: "Follow resident", exact: true })
    .click();
  await page.waitForTimeout(1000);
  await page.screenshot({ path: out + "/follow.png" });
  const focused = await metrics();
  expect(focused.followingResident).toContain(":mira");
  expect(focused.scale).toBeGreaterThan(1.5);
  expect(focused.residentDisplayNodes).toBeLessThanOrEqual(64);
  expect(focused.savedOverview.scale).toBeCloseTo(previous.target.scale, 6);
  report.camera = {
    previous: previous.target,
    focused: { scale: focused.scale, deadZone: [36, 26] },
    nodeCount: focused.residentDisplayNodes,
    residentTextureBytes: focused.residentTextureBytes,
  };
  await page.getByRole("button", { name: "Close panel", exact: true }).click();
  await page.mouse.move(400, 400);
  await page.mouse.wheel(0, 50);
  expect((await metrics()).followingResident).toBeNull();
  await page
    .getByRole("button", { name: "Village overview", exact: true })
    .first()
    .click();
  await page.waitForTimeout(1200);
  const restored = await metrics();
  expect(restored.target.scale).toBeCloseTo(previous.target.scale, 6);
  expect(restored.target.x).toBeCloseTo(previous.target.x, 3);
  expect(restored.target.y).toBeCloseTo(previous.target.y, 3);
  report.checks.push(
    "Actual prior panned/zoomed overview restored; pointer-wheel releases follow; spring focus and zoom operate in the real renderer",
  );
  await page.emulateMedia({ reducedMotion: "reduce" });
  await select(page);
  await page
    .getByRole("button", { name: "Follow resident", exact: true })
    .click();
  await page.waitForTimeout(1200);
  const reduced = await metrics();
  expect(reduced.reducedMotion).toBe(true);
  expect(reduced.cameraVelocity).toEqual({ x: 0, y: 0, zoom: 0 });
  await page.getByRole("button", { name: "Close panel", exact: true }).click();
  await page.locator("canvas").focus();
  await page.keyboard.press("ArrowRight");
  expect((await metrics()).followingResident).toBeNull();
  report.checks.push(
    "Reduced motion snaps camera and suppresses decorative motion; keyboard exploration releases follow",
  );
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await select(page, "Nell Bramble");
  const rendered = await page.locator("body").innerText();
  expect(rendered).not.toMatch(
    /scenery|art in development|Existing geometry|does not.*contribut/i,
  );
  await page.getByRole("button", { name: "Places", exact: true }).click();
  await page
    .getByRole("button", { name: "Inspect the Mending Shed", exact: true })
    .click();
  await expect(
    page.getByText("2/2 accepted contributions · completed", { exact: true }),
  ).toBeVisible();
  await page.screenshot({ path: out + "/building-record.png" });
  await page.reload();
  await page.locator("[data-render-state=ready]").waitFor();
  const again = await (
    await context.request.get(
      api + `/api/founding/${fixture.worldId}/residents`,
    )
  ).json();
  expect(evaluateResidents(plan, plan.serverTimeMs)).toEqual(
    evaluateResidents(again, plan.serverTimeMs),
  );
  await context.setOffline(true);
  await page.waitForTimeout(1000);
  const refresh = page.waitForResponse(
    (r) => r.url().endsWith("/residents") && r.status() === 200,
  );
  await context.setOffline(false);
  await refresh;
  report.checks.push(
    "Reload same-time goal/action reconstruction; resident refresh after reconnect; factual WF2 structure status and player-facing copy",
  );
  for (const [label, engine, viewport] of [
    ["Firefox", firefox, { width: 1440, height: 1000 }],
    ["WebKit", webkit, { width: 1440, height: 1000 }],
    ["Chromium small viewport", chromium, { width: 390, height: 844 }],
  ]) {
    const b = await engine.launch({
        headless: true,
        ...(engine === chromium
          ? { args: ["--enable-unsafe-swiftshader"] }
          : {}),
      }),
      c = await b.newContext({ viewport }),
      p = await c.newPage();
    p.on("pageerror", (e) => errors.push(label + ":" + e.message));
    await p.goto(origin + "/villages/showcase-fern");
    await p.locator("[data-render-state=ready]").waitFor();
    await select(p);
    await p
      .getByRole("button", { name: "Follow resident", exact: true })
      .click();
    await p.waitForTimeout(1000);
    await p.screenshot({
      path: out + "/" + label.toLowerCase().replaceAll(" ", "-") + ".png",
    });
    report.matrix.push({
      label,
      browser: b.version(),
      viewport,
      physicalDevice: false,
    });
    await b.close();
  }
  // Observe real wall time until all four behaviors occur. Only the observer/camera changes.
  const publicPlan = await (
      await context.request.get(api + "/api/founding/showcase-fern/residents")
    ).json(),
    received = performance.now(),
    pending = new Set(["work", "rest", "gather", "travel"]),
    deadline = received + 240000;
  while (pending.size && performance.now() < deadline) {
    const now = publicPlan.serverTimeMs + performance.now() - received,
      states = evaluateResidents(publicPlan, now);
    const state = states.find(
      (s) =>
        pending.has(s.activity) &&
        (s.actionPhase === "performing" || s.actionPhase === "travel") &&
        (s.phaseProgress ?? 1) < 0.6,
    );
    if (!state) {
      await new Promise((r) => setTimeout(r, 1000));
      continue;
    }
    const kind = state.activity,
      r = publicPlan.residents.find((r) => r.id === state.id),
      c = await browser.newContext({
        viewport: { width: 1440, height: 1000 },
        recordVideo: { dir: clipDir, size: { width: 1440, height: 1000 } },
      }),
      p = await c.newPage();
    p.on("pageerror", (e) => errors.push(e.message));
    await p.goto(origin + "/villages/showcase-fern");
    await p.locator("[data-render-state=ready]").waitFor();
    await select(p, r.name);
    await p
      .getByRole("button", { name: "Follow resident", exact: true })
      .click();
    await p.waitForTimeout(1000);
    const clipState = evaluateResidents(
      publicPlan,
      publicPlan.serverTimeMs + performance.now() - received,
    ).find((s) => s.id === state.id);
    if (clipState.activity !== kind) {
      await c.close();
      continue;
    }
    await p.screenshot({ path: out + "/" + kind + ".png" });
    await p.waitForTimeout(6500);
    const video = p.video();
    await c.close();
    await fs.rename(await video.path(), clipDir + "/" + kind + ".webm");
    report.clips.push({
      activity: kind,
      resident: r.name,
      actualAction: clipState.actionLabel,
      phase: clipState.actionPhase,
      serverTimeMs: publicPlan.serverTimeMs + performance.now() - received,
      clockOverride: false,
      path: clipDir + "/" + kind + ".webm",
    });
    pending.delete(kind);
    console.log("Observed actual " + kind + " behavior for " + r.name);
  }
  expect([...pending]).toEqual([]);
  expect(errors).toEqual([]);
  report.checks.push(
    "Short real-wall-time recordings of working, resting, coordinated conversation and travel, using the actual integrated village",
  );
  report.limits = [
    "Finite utility/action planner with reserved meetings, not open-ended autonomous reasoning",
    "Four-minute reconstruction shifts close at rest points; no persistence or historic memory across shifts",
    "Provisional puppets and simple two-dimensional facing; physical-device/GPU performance unverified",
    "No hosted mutation/deploy/judging publication or real independent human/provider test",
  ];
  await fs.writeFile(
    out + "/browser.json",
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(JSON.stringify(report));
} catch (e) {
  await page.screenshot({ path: ".local/lw11/failure.png" });
  console.error((await page.locator("body").innerText()).slice(0, 1600));
  throw e;
} finally {
  await context.close();
  await browser.close();
}
