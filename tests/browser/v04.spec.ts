import { test, expect } from "@playwright/test";
test.setTimeout(90000);
const metrics = async (page: any) =>
  JSON.parse(await page.locator("#metrics").textContent());
test("V04 connected study: exploration, all five detail swaps, stable residency and return", async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/studies/v04.html");
  await page.locator("[data-render-state=ready]").waitFor();
  await expect.poll(async () => (await metrics(page)).running).toBe(false);
  const base = await metrics(page);
  const picked = await page.evaluate(async () => {
    const manifest = await (
      await fetch("/study-assets/v04-neighborhood-study-01/manifest.json")
    ).json();
    const layer = manifest.layers.find((l: any) => l.id === "hall");
    const host = document.querySelector("#world")!.getBoundingClientRect();
    const scale = JSON.parse(
      document.querySelector("#metrics")!.textContent!,
    ).scale;
    return {
      x:
        host.x +
        host.width * 0.5 +
        (layer.left + layer.width * 0.5 - manifest.width * 0.5) * scale,
      y:
        host.y +
        host.height * 0.52 +
        (layer.top + layer.height * 0.4 - manifest.height * 0.53) * scale,
    };
  });
  await page.mouse.click(picked.x, picked.y);
  await expect(page.locator("#building-name")).toHaveText("The Commons Hall");
  await page.locator("#close-inspection").click();
  await expect.poll(async () => (await metrics(page)).running).toBe(false);
  expect(base.residentDecodedBytes).toBeLessThan(32 * 2 ** 20);
  const frames = base.frames;
  await page.waitForTimeout(700);
  expect((await metrics(page)).frames).toBe(frames);
  await page.screenshot({ path: info.outputPath("v04-overview.png") });
  await page.getByRole("button", { name: "Zoom in", exact: true }).click();
  await expect
    .poll(async () => (await metrics(page)).scale)
    .toBeGreaterThan(base.scale);
  const canvas = page.locator("canvas"),
    bounds = (await canvas.boundingBox())!;
  const before = await canvas.screenshot();
  await page.mouse.move(
    bounds.x + bounds.width * 0.5,
    bounds.y + bounds.height * 0.5,
  );
  await page.mouse.down();
  await page.mouse.move(
    bounds.x + bounds.width * 0.6,
    bounds.y + bounds.height * 0.55,
    { steps: 8 },
  );
  await page.mouse.up();
  expect(Buffer.compare(before, await canvas.screenshot())).not.toBe(0);
  await page.getByRole("button", { name: "Fit neighborhood" }).click();
  const ids = ["hearth-home", "garden-home", "lane-home", "workshop", "hall"];
  for (const id of [...ids, ...ids]) {
    await page.locator("#places-toggle").click();
    await page.locator(`[data-building=${id}]`).click();
    await expect(
      page.getByRole("complementary", { name: "Building inspection" }),
    ).toBeVisible();
    await page.locator("#focus").click();
    await expect.poll(async () => (await metrics(page)).focused).toBe(true);
    const focused = await metrics(page);
    expect(focused.selected).toBe(id);
    expect(focused.textureCount).toBe(base.textureCount + 1);
    expect(focused.cachedDetailTextures).toBe(1);
    expect(focused.residentDecodedBytes).toBeLessThan(32 * 2 ** 20);
    if (ids.indexOf(id) >= 3)
      await page.screenshot({ path: info.outputPath(`v04-${id}-focus.png`) });
    await page.locator("#close-inspection").click();
    await page.locator("#return").click();
    await expect
      .poll(async () => (await metrics(page)).detailDecodedBytes)
      .toBe(0);
    expect((await metrics(page)).textureCount).toBe(base.textureCount);
    expect((await metrics(page)).cachedDetailTextures).toBe(0);
  }
  expect(errors).toEqual([]);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
test("V04 emulated touch pinch and reduced motion", async ({ page }, info) => {
  test.skip(
    !info.project.name.includes("touch"),
    "CDP touch-input check is Chromium touch-emulation only",
  );
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/studies/v04.html");
  await page.locator("[data-render-state=ready]").waitFor();
  await expect.poll(async () => (await metrics(page)).running).toBe(false);
  const before = (await metrics(page)).scale;
  const session = await page.context().newCDPSession(page);
  const b = (await page.locator("canvas").boundingBox())!,
    x = b.x + b.width * 0.5,
    y = b.y + b.height * 0.5;
  await session.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [
      { x: x - 35, y, id: 1 },
      { x: x + 35, y, id: 2 },
    ],
  });
  await session.send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: [
      { x: x - 70, y, id: 1 },
      { x: x + 70, y, id: 2 },
    ],
  });
  await session.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  await expect
    .poll(async () => (await metrics(page)).scale)
    .toBeGreaterThan(before * 1.3);
  await expect.poll(async () => (await metrics(page)).running).toBe(false);
});
test("V04 graphics fallback retains keyboard-accessible places", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (
      type: any,
      ...args: any[]
    ) {
      if (String(type).includes("webgl")) return null;
      return (original as any).call(this, type, ...args);
    } as any;
  });
  await page.goto("/studies/v04.html");
  await page.locator("[data-render-state=fallback]").waitFor();
  await page.locator('[data-building="hall"]').focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("#building-name")).toHaveText("The Commons Hall");
  await expect(page.locator("#focus")).toBeDisabled();
});
test("V04 missing near asset preserves base village", async ({ page }) => {
  await page.route("**/hall-detail.png", (r) => r.abort());
  await page.goto("/studies/v04.html");
  await page.locator("[data-render-state=ready]").waitFor();
  await page.locator("#places-toggle").click();
  await page.locator('[data-building="hall"]').click();
  await page.locator("#focus").click();
  await expect(page.locator("#view-status")).toContainText(
    "detail unavailable",
  );
  expect((await metrics(page)).detailDecodedBytes).toBe(0);
  await expect(page.locator("canvas")).toBeVisible();
});
