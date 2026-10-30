import { chromium, expect } from "@playwright/test";
import fs from "node:fs/promises";
const b = await chromium.launch({
  headless: true,
  args: ["--enable-unsafe-swiftshader"],
});
const c = await b.newContext({ viewport: { width: 1440, height: 1080 } });
const p = await c.newPage();
const errors = [];
p.on("pageerror", (e) => errors.push(e.message));
try {
  const { worldId } = await (
    await c.request.get("http://localhost:3002/__wf2_test/login/owner")
  ).json();
  await p.goto("http://localhost:5174/communities");
  const cards = p.getByRole("link", { name: /Original village · v1/ });
  await cards.click();
  await p.locator("[data-render-state=ready]").waitFor();
  await p.getByRole("button", { name: "Places", exact: true }).click();
  await p.locator(".pi-place-row").first().click();
  await expect(p.getByRole("dialog")).toContainText("original building");
  await p
    .getByRole("button", { name: "Take a closer look", exact: true })
    .click();
  await expect(p.locator("canvas")).toHaveCount(1);
  await expect(p.locator(".pi-legacy-detail")).toBeVisible();
  await p.screenshot({
    path: "docs/testing/evidence/pi1/legacy-world.png",
    mask: [p.locator("[data-private]")],
  });
  const cycles = [];
  for (let i = 0; i < 3; i++) {
    await p.getByRole("link", { name: "My Communities", exact: true }).click();
    await p.getByRole("link", { name: /Private development world/ }).click();
    await p.locator("[data-render-state=ready]").waitFor();
    await p
      .getByRole("button", {
        name: "Village settings and management",
        exact: true,
      })
      .click();
    await p.getByText("Technical diagnostics", { exact: true }).click();
    await p
      .getByRole("button", { name: "Measure renderer", exact: true })
      .click();
    const stats = JSON.parse(await p.locator("[data-wf2-metrics]").innerText());
    await p.getByRole("button", { name: "Close panel", exact: true }).click();
    cycles.push({
      ...stats,
      jsHeap: await p.evaluate(
        () => performance.memory?.usedJSHeapSize ?? null,
      ),
      canvasCount: await p.locator("canvas").count(),
    });
  }
  await fs.writeFile(
    "docs/testing/evidence/pi1/renderer-navigation.json",
    JSON.stringify(
      {
        date: new Date().toISOString(),
        browser: b.version(),
        viewport: { width: 1440, height: 1080 },
        mode: "Windows/headless software WebGL2, synthetic fixture; no physical device",
        cycles,
        errors,
        legacyWorldReader: true,
        limitations: [
          "3 warm route cycles only; no long-duration leak proof",
          "JS heap samples are not GPU memory or forced-GC measurements",
          "No performance acceptance threshold or physical-device claim",
        ],
      },
      null,
      2,
    ) + "\n",
  );
  if (errors.length) throw Error(errors.join(";"));
  console.log(
    "Legacy source reader/focus and three route/renderer cycles verified.",
  );
} finally {
  await c.close();
  await b.close();
}
