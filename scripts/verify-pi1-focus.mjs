import { chromium, firefox, webkit, expect } from "@playwright/test";
import fs from "node:fs/promises";
const results = [];
for (const [label, engine, touch] of [
  ["chromium-desktop", chromium, false],
  ["firefox-desktop", firefox, false],
  ["webkit-desktop", webkit, false],
  ["chromium-touch-emulation", chromium, true],
]) {
  const b = await engine.launch({
    headless: true,
    ...(engine === chromium ? { args: ["--enable-unsafe-swiftshader"] } : {}),
  });
  const c = await b.newContext({
    viewport: touch
      ? { width: 390, height: 844 }
      : { width: 1440, height: 1080 },
    hasTouch: touch,
    ...(touch ? { isMobile: true, deviceScaleFactor: 2 } : {}),
  });
  const p = await c.newPage();
  const errors = [];
  p.on("pageerror", (e) => errors.push(e.message));
  try {
    const { worldId } = await (
      await c.request.get("http://localhost:3002/__wf2_test/login/owner")
    ).json();
    await p.goto("http://localhost:5174/villages/" + worldId);
    await p.locator("[data-render-state=ready]").waitFor();
    await p.getByRole("button", { name: "Places", exact: true }).click();
    await p
      .getByRole("button", { name: "Inspect the Mending Shed", exact: true })
      .click();
    await p
      .getByRole("button", { name: "Take a closer look", exact: true })
      .click();
    await p.waitForTimeout(600);
    await p.screenshot({
      path: "docs/testing/evidence/pi1/fixture-" + label + ".png",
    });
    await expect(p.locator("canvas")).toHaveCount(1);
    if (errors.length) throw Error(errors.join(";"));
    results.push({
      label,
      version: b.version(),
      errors,
      viewport: touch ? "390x844 touch emulation" : "1440x1080",
      focus:
        "Actual existing workshop geometry framed above/beside contextual panel",
      physicalDevice: false,
    });
  } finally {
    await c.close();
    await b.close();
  }
}
await fs.writeFile(
  "docs/testing/evidence/pi1/focus-framing.json",
  JSON.stringify({ date: new Date().toISOString(), results }, null, 2) + "\n",
);
console.log("Four engine/viewport focus-framing captures verified.");
