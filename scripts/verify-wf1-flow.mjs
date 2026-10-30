import { chromium } from "@playwright/test";
import fs from "node:fs/promises";
const browser = await chromium.launch(),
  context = await browser.newContext({
    viewport: { width: 1440, height: 1080 },
  });
const backend = "http://localhost:3301";
try {
  const start = await context.request.get(backend + "/auth/twitch", {
      maxRedirects: 0,
    }),
    state = new URL(start.headers().location).searchParams.get("state");
  await context.request.get(
    backend +
      "/auth/twitch/callback?" +
      new URLSearchParams({ state, code: "wf1-flow-" + Date.now() }),
    { maxRedirects: 0 },
  );
  const me = (await (await context.request.get(backend + "/api/me")).json())
    .person;
  const headers = {
    origin: "http://localhost:5173",
    "x-csrf-token": me.csrfToken,
  };
  const legacy = await context.request.post(backend + "/api/villages", {
    headers,
    data: {
      commandId: crypto.randomUUID(),
      name: "Retained Test Grove",
      seed: "legacy-flow",
    },
  });
  if (legacy.status() !== 200) throw Error("Legacy setup failed");
  const legacyBody = await legacy.text(),
    legacyId = JSON.parse(legacyBody).id;
  const page = await context.newPage();
  await page.route(/\/(?:api|assets)\//, async (route) => {
    const u = new URL(route.request().url());
    const r = await route.fetch({ url: backend + u.pathname + u.search });
    await route.fulfill({ response: r });
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("http://localhost:5173/?founding=new");
  await page
    .getByRole("heading", { name: "Create a development world", exact: true })
    .waitFor();
  await page
    .getByLabel("Village name", { exact: true })
    .fill("A Saved Development Clearing");
  await page
    .getByLabel("A word to grow from", { exact: true })
    .fill("wf1-real-flow");
  const health = [];
  let keep = true;
  const monitor = (async () => {
    while (keep) {
      const t = performance.now();
      const r = await context.request.get(backend + "/health");
      health.push({ ms: performance.now() - t, status: r.status() });
      await new Promise((r) => setTimeout(r, 20));
    }
  })();
  const began = performance.now();
  await page
    .getByRole("button", { name: "Create saved founding world", exact: true })
    .click();
  await page.waitForURL(/\?world=/);
  await page.locator("[data-render-state=ready]").waitFor();
  keep = false;
  await monitor;
  const readyMs = performance.now() - began,
    id = new URL(page.url()).searchParams.get("world");
  await page.screenshot({
    path: "docs/testing/evidence/wf1/05-persisted-development.png",
    fullPage: true,
  });
  const header = await (
    await context.request.get(backend + "/api/founding/" + id)
  ).json();
  const second = await context.newPage();
  await second.route(/\/(?:api|assets)\//, async (route) => {
    const u = new URL(route.request().url());
    const r = await route.fetch({ url: backend + u.pathname + u.search });
    await route.fulfill({ response: r });
  });
  await second.goto(page.url());
  await second.locator("[data-render-state=ready]").waitFor();
  await page.reload();
  await page.locator("[data-render-state=ready]").waitFor();
  const legacyUnchanged =
    (await (
      await context.request.get(backend + "/api/villages/" + legacyId)
    ).text()) === legacyBody;
  const anonymous = await browser.newContext();
  const privateDenied =
    (await anonymous.request.get(backend + "/api/founding/" + id)).status() ===
    404;
  await anonymous.close();
  const sorted = health.map((h) => h.ms).sort((a, b) => a - b);
  const result = {
    date: new Date().toISOString(),
    provider:
      "isolated fake Twitch gateway; real existing confidential OAuth adapter preserved, no fresh live authorization claimed",
    uiToPostgres: true,
    worldId: id,
    purpose: header.purpose,
    baselineHash: header.baseline.hash,
    readyMs,
    health: {
      samples: health.length,
      p95Ms: sorted[Math.floor(sorted.length * 0.95)],
      maxMs: sorted.at(-1),
      statuses: [...new Set(health.map((h) => h.status))],
    },
    legacyUnchanged,
    privateDenied,
    twoClientsReadSameWorld:
      (await second.locator("h1").textContent()) === header.name,
    reloadSameWorld: (await page.locator("h1").textContent()) === header.name,
    errors,
  };
  await fs.writeFile(
    "docs/testing/evidence/wf1/integrated-flow.json",
    JSON.stringify(result, null, 2),
  );
  console.log(result);
  if (!legacyUnchanged || !privateDenied || errors.length) process.exitCode = 1;
} finally {
  await context.close();
  await browser.close();
}
