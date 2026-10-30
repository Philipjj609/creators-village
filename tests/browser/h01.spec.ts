import { test, expect } from "@playwright/test";
test.setTimeout(90000);
const stats = async (page: any) =>
  JSON.parse(await page.locator("#metrics").textContent());
test("H01 matched hero views, three places, pan/zoom and released detail residency", async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/studies/h01.html");
  await page.locator("[data-render-state=ready]").waitFor();
  await expect.poll(async () => (await stats(page)).running).toBe(false);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "The Long Table",
  );
  const base = await stats(page);
  expect(base.residentDecodedBytes).toBeLessThan(32 * 2 ** 20);
  await page.getByRole("button", { name: "Zoom in", exact: true }).click();
  await expect
    .poll(async () => (await stats(page)).scale)
    .toBeGreaterThan(base.scale);
  await page.locator("#fit").click();
  for (const id of ["home", "workshop", "commons"]) {
    await page.locator("#places-toggle").click();
    await page.locator(`[data-building=${id}]`).click();
    await page.locator("#focus").click();
    await expect.poll(async () => (await stats(page)).focused).toBe(true);
    const focused = await stats(page);
    expect(focused.selected).toBe(id);
    expect(focused.cachedDetailTextures).toBe(1);
    expect(focused.residentDecodedBytes).toBeLessThan(32 * 2 ** 20);
    await page.locator("#close-inspection").click();
    await page.screenshot({ path: info.outputPath(`h01-${id}.png`) });
    await page.locator("#return").click();
    await expect
      .poll(async () => (await stats(page)).detailDecodedBytes)
      .toBe(0);
    expect((await stats(page)).cachedDetailTextures).toBe(0);
  }
  const box = (await page.locator("canvas").boundingBox())!,
    before = await page.locator("canvas").screenshot();
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.6, {
    steps: 8,
  });
  await page.mouse.up();
  expect(
    Buffer.compare(before, await page.locator("canvas").screenshot()),
  ).not.toBe(0);
  expect(errors).toEqual([]);
});
test("H01 fallback and keyboard places preserve readable building purpose", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (
      type: any,
      ...args: any[]
    ) {
      return String(type).includes("webgl")
        ? null
        : (original as any).call(this, type, ...args);
    } as any;
  });
  await page.goto("/studies/h01.html");
  await page.locator("[data-render-state=fallback]").waitFor();
  await page.locator("[data-building=workshop]").focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("#building-name")).toHaveText("The Mending Shed");
  await expect(page.locator("#focus")).toBeDisabled();
});
