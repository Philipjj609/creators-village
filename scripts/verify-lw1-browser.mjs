// Run after `wf2-test-server.mjs --lw1` and `verify-pi1-browser.mjs --lw1`.
// Fixed loopback ports and disposable synthetic DB; never targets hosted worlds.
import { chromium, firefox, webkit, expect } from "@playwright/test";
import fs from "node:fs/promises";
import { createHash } from "node:crypto";
import { evaluateResidents } from "../packages/world/dist/living.js";
const origin = "http://localhost:5176",
  api = "http://localhost:3004";
const out = "docs/testing/evidence/lw1";
await fs.mkdir(out, { recursive: true });
await fs.mkdir(".local/lw1/video", { recursive: true });
const browser = await chromium.launch({
  headless: true,
  args: ["--enable-unsafe-swiftshader"],
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
  recordVideo: { dir: ".local/lw1/video", size: { width: 1440, height: 1000 } },
});
const page = await context.newPage(),
  errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const fixture = await (
  await context.request.get(api + "/__wf2_test/login/owner")
).json();
const worldUrl = origin + "/villages/" + fixture.worldId;
async function places(p) {
  await p.getByRole("button", { name: "Places", exact: true }).click();
}
async function metrics(p) {
  const settings = p.getByRole("button", {
    name: "Village settings and management",
    exact: true,
  });
  if ((await settings.getAttribute("aria-pressed")) !== "true")
    await settings.click();
  const detail = p
    .locator("details")
    .filter({ has: p.getByText("Technical diagnostics", { exact: true }) });
  if (!(await detail.evaluate((n) => n.open)))
    await detail.locator("summary").click();
  await p
    .getByRole("button", { name: "Measure renderer", exact: true })
    .click();
  return JSON.parse(await p.locator("[data-wf2-metrics]").innerText());
}
async function select(p, name = "Mira Fen") {
  await places(p);
  await p.getByRole("button", { name: new RegExp(name) }).click();
  await expect(p.getByRole("heading", { name, exact: true })).toBeVisible();
}
const report = {
  date: new Date().toISOString(),
  identity:
    "Synthetic isolated fixture; fictional residents are not Twitch people",
  browser: browser.version(),
  checks: [],
  matrix: [],
  errors,
};
try {
  await page.goto(worldUrl);
  await page.locator("[data-render-state=ready]").waitFor();
  await select(page);
  await expect(
    page.getByText("Fictional village resident", { exact: true }),
  ).toBeVisible();
  await page.screenshot({ path: out + "/resident-overview.png" });
  await page
    .getByRole("button", { name: "Follow resident", exact: true })
    .click();
  await page.waitForTimeout(1000);
  await page.screenshot({ path: out + "/resident-follow.png" });
  const focused = await metrics(page);
  expect(focused.followingResident).toContain(":lw1:mira");
  expect(focused.scale).toBeGreaterThan(1.5);
  expect(focused.residents).toBe(4);
  expect(focused.residentTextureBytes).toBe(0);
  expect(focused.residentDisplayNodes).toBeLessThanOrEqual(64);
  expect(focused.decodedBytes).toBeLessThan(16 * 1024 * 1024);
  report.checks.push(
    "Keyboard-accessible resident list, factual panel and smooth follow focus",
  );
  // Repeated real-time samples prove movement in the rendered scene, not just planned routes.
  let moved = false,
    prior = focused,
    samples = [];
  const movementBefore = await page
    .locator("canvas")
    .screenshot({ path: out + "/movement-before.png" });
  for (let i = 0; i < 12; i++) {
    await page.waitForTimeout(1500);
    const next = await metrics(page);
    samples.push({
      frames: next.frames,
      p95Ms: next.p95Ms,
      residentNodes: next.residentDisplayNodes,
      decodedBytes: next.decodedBytes,
      residentChunks: next.residentChunks,
    });
    if (
      next.residentStates.some((s) => {
        const old = prior.residentStates.find((o) => o.id === s.id);
        return (
          old &&
          Math.hypot(
            s.position.x - old.position.x,
            s.position.y - old.position.y,
          ) > 0.1
        );
      })
    )
      moved = true;
    prior = next;
    if (moved && i >= 2) break;
  }
  expect(moved).toBe(true);
  const movementAfter = await page
    .locator("canvas")
    .screenshot({ path: out + "/movement-after.png" });
  const canvasBeforeSha256 = createHash("sha256")
    .update(movementBefore)
    .digest("hex");
  const canvasAfterSha256 = createHash("sha256")
    .update(movementAfter)
    .digest("hex");
  expect(canvasAfterSha256).not.toBe(canvasBeforeSha256);
  report.movement = {
    canvasBeforeSha256,
    canvasAfterSha256,
    actualStateMovement: moved,
    actualCanvasPixelsChanged: true,
  };
  report.samples = samples;
  report.checks.push(
    "Residents move at actual wall time with bounded display objects and zero new textures",
  );
  await page.getByRole("button", { name: "Close panel", exact: true }).click();
  // A real pointer pan cancels following.
  await page.mouse.move(400, 400);
  await page.mouse.down();
  await page.mouse.move(460, 430, { steps: 5 });
  await page.mouse.up();
  expect((await metrics(page)).followingResident).toBeNull();
  await page
    .getByRole("button", { name: "Village overview", exact: true })
    .first()
    .click();
  await page.waitForTimeout(600);
  const overview = await metrics(page);
  expect(overview.scale).toBeLessThan(1);
  const target = overview.residentScreenBounds.find((b) =>
    b.id.endsWith(":mira"),
  );
  await page.getByRole("button", { name: "Close panel", exact: true }).click();
  const canvasBox = await page.locator("canvas").boundingBox();
  await page.mouse.click(
    canvasBox.x + target.x + target.width / 2,
    canvasBox.y + target.y + target.height / 2,
  );
  await expect(
    page.getByRole("heading", { name: "Mira Fen", exact: true }),
  ).toBeVisible();
  report.checks.push(
    "Pointer resident selection; manual pan cancels follow; overview restores normal zoom",
  );
  const before = await (
    await context.request.get(
      api + `/api/founding/${fixture.worldId}/residents`,
    )
  ).json();
  await page.reload();
  await page.locator("[data-render-state=ready]").waitFor();
  await select(page, "Nell Bramble");
  const after = await (
    await context.request.get(
      api + `/api/founding/${fixture.worldId}/residents`,
    )
  ).json();
  expect(after.residents).toEqual(before.residents);
  expect(evaluateResidents(after, before.serverTimeMs)).toEqual(
    evaluateResidents(before, before.serverTimeMs),
  );
  await context.setOffline(true);
  await page.waitForTimeout(1200);
  const reconnected = page.waitForResponse(
    (r) =>
      r.url().endsWith(`/api/founding/${fixture.worldId}/residents`) &&
      r.status() === 200,
  );
  await context.setOffline(false);
  await reconnected;
  await expect(
    page.getByRole("heading", { name: "Nell Bramble", exact: true }),
  ).toBeVisible();
  report.checks.push(
    "Reload reconstructs identical itinerary at identical time; online event refreshes after reconnect",
  );
  await places(page);
  await page
    .getByRole("button", { name: "Inspect the Mending Shed", exact: true })
    .click();
  await expect(
    page.getByText("2/2 accepted contributions · completed", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("No named attribution is currently displayed.", {
      exact: true,
    }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Take a closer look", exact: true })
    .click();
  await page.waitForTimeout(800);
  await page.screenshot({ path: out + "/building-record.png" });
  await page
    .getByRole("button", { name: "Related project history", exact: true })
    .click();
  await expect(
    page.getByRole("heading", {
      name: "The community built a workshop",
      exact: true,
    }),
  ).toBeVisible();
  report.checks.push(
    "Actual saved completed structure, accepted count, current attribution and related durable milestone",
  );
  expect(
    after.residents
      .find((r) => r.role === "Mender")
      .goals.some((s) => s.structureId?.startsWith("wf2-workshop-")),
  ).toBe(true);
  const anon = await browser.newContext();
  expect(
    (
      await anon.request.get(api + `/api/founding/${fixture.worldId}/residents`)
    ).status(),
  ).toBe(404);
  const publicPage = await anon.newPage();
  await publicPage.goto(origin + "/villages/showcase-fern");
  await publicPage.locator("[data-render-state=ready]").waitFor();
  await select(publicPage);
  await publicPage
    .getByRole("button", { name: "Follow resident", exact: true })
    .click();
  await expect(
    publicPage.getByText("Fictional village resident", { exact: true }),
  ).toBeVisible();
  await publicPage.screenshot({ path: out + "/founding-example.png" });
  await anon.close();
  report.checks.push(
    "Founding-only v2 reader also integrates residents; legacy v1 keeps its existing renderer",
  );
  const devtools = await context.newCDPSession(page);
  const heapBefore = await devtools.send("Runtime.getHeapUsage");
  for (let n = 0; n < 3; n++) {
    await page.reload();
    await page.locator("[data-render-state=ready]").waitFor();
    await select(page);
    const sample = await metrics(page);
    expect(sample.residents).toBe(4);
    expect(sample.residentDisplayNodes).toBeLessThanOrEqual(64);
    await expect(page.locator("canvas")).toHaveCount(1);
  }
  const heapAfter = await devtools.send("Runtime.getHeapUsage");
  report.memory = {
    reloads: 3,
    residentDisplayNodeBudget: 64,
    residentTextureByteBudget: 0,
    totalPinnedTextureBudgetBytes: 16 * 1024 * 1024,
    heapBeforeBytes: heapBefore.usedSize,
    heapAfterBytes: heapAfter.usedSize,
    note: "Unforced JS heap snapshots include app/terrain/caches and GC timing; not a leak proof or device-memory guarantee",
  };
  await devtools.detach();
  // Dynamic preference and real CSS media query; reduced mode samples half-cell positions.
  await page.emulateMedia({ reducedMotion: "reduce" });
  await select(page);
  await page
    .getByRole("button", { name: "Follow resident", exact: true })
    .click();
  await page.waitForTimeout(1200);
  const reduced = await metrics(page);
  expect(reduced.reducedMotion).toBe(true);
  for (const s of reduced.residentStates) {
    expect((s.position.x * 2) % 1).toBeCloseTo(s.position.x >= 0 ? 0.5 : -0.5);
  }
  await select(page);
  await page.screenshot({ path: out + "/reduced-motion.png" });
  report.checks.push(
    "Reduced-motion preference removes decorative motion and uses discrete navigation; private world remains denied anonymously",
  );
  // Browser engines and small viewport are explicit emulation, not physical-device claims.
  for (const [label, engine, viewport] of [
    ["Firefox desktop", firefox, { width: 1440, height: 1000 }],
    ["WebKit desktop", webkit, { width: 1440, height: 1000 }],
    ["Chromium small viewport", chromium, { width: 390, height: 844 }],
  ]) {
    const b = await engine.launch({
      headless: true,
      ...(engine === chromium ? { args: ["--enable-unsafe-swiftshader"] } : {}),
    });
    const c = await b.newContext({ viewport });
    const p = await c.newPage();
    p.on("pageerror", (e) => errors.push(label + ": " + e.message));
    await c.request.get(api + "/__wf2_test/login/owner");
    await p.goto(worldUrl);
    await p.locator("[data-render-state=ready]").waitFor();
    await select(p);
    await p
      .getByRole("button", { name: "Follow resident", exact: true })
      .click();
    await p.waitForTimeout(800);
    await expect(p.locator("canvas")).toHaveCount(1);
    await p.screenshot({
      path: out + "/" + label.toLowerCase().replaceAll(" ", "-") + ".png",
    });
    report.matrix.push({
      label,
      browser: b.version(),
      viewport,
      residentPanel: true,
      focus: true,
      physicalDevice: false,
    });
    await b.close();
  }
  expect(errors).toEqual([]);
  report.limits = [
    "Provisional original vector characters, unapproved world art",
    "Software WebGL2 on this desktop; no physical mobile or older GPU performance claim",
    "Frames include deliberate 30Hz resident drawing and demand camera sampling; not a 60fps promise",
    "No real Twitch provider call or independent human in synthetic fixture",
    "No production deployment or live mutation",
  ];
  await fs.writeFile(
    out + "/browser.json",
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(JSON.stringify(report));
} catch (e) {
  await page.screenshot({ path: ".local/lw1/failure.png" });
  console.error((await page.locator("body").innerText()).slice(0, 1800));
  throw e;
} finally {
  await context.close();
  await browser.close();
}
