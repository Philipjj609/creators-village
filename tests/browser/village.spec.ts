import { test, expect } from "@playwright/test";
test("PI1 landing, truthful auth state, routes and graceful failure", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page).toHaveTitle(/Creator’s Village/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "A home for your community.",
  );
  await expect(
    page.getByRole("link", { name: /Join with Twitch/ }).first(),
  ).toHaveAttribute("href", "/auth/twitch");
  await expect(page.locator("canvas")).toHaveCount(0);
  await page.goto("/communities");
  await expect(
    page.getByRole("heading", { name: "Bring your Twitch identity" }),
  ).toBeVisible();
  await page.goto("/?auth=declined");
  await expect(page.getByRole("alert")).toContainText("declined");
  await page.goto("/villages/00000000-0000-4000-8000-000000000000");
  await expect(
    page.getByRole("heading", { name: "Village unavailable" }),
  ).toBeVisible();
  await page.goto("/not-a-route");
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    "doesn’t lead",
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
test("PI1 village camera, keyboard inspection, panel history, stable renderer and reduced motion", async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/villages/showcase-fern");
  await page.locator("[data-render-state=ready]").waitFor();
  const canvas = await page.locator("canvas").elementHandle();
  const before = await page.locator("canvas").screenshot();
  await page.locator("canvas").focus();
  await page.keyboard.press("ArrowRight");
  await expect
    .poll(async () =>
      Buffer.compare(before, await page.locator("canvas").screenshot()),
    )
    .not.toBe(0);
  await page
    .getByRole("button", { name: "Village overview", exact: true })
    .click();
  await page.getByRole("button", { name: "Places", exact: true }).click();
  await expect(page.getByRole("button", { name: "Close panel" })).toBeFocused();
  await expect.poll(() => canvas!.evaluate((n) => n.isConnected)).toBe(true);
  await page.getByRole("button", { name: /The Gathering Shelter/ }).click();
  await page
    .getByRole("button", { name: "Take a closer look", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toContainText("The Gathering Shelter");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("button", { name: "Places", exact: true }).click();
  await page.goBack();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.goForward();
  await expect(page.getByRole("dialog")).toHaveAttribute(
    "aria-label",
    "Places",
  );
  expect(await canvas!.evaluate((n) => n.isConnected)).toBe(true);
  await page.screenshot({ path: info.outputPath("pi1-navigation.png") });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
});
test("PI1 GPU failure retains keyboard-readable places", async ({ page }) => {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (
      ...args: Parameters<typeof original>
    ) {
      if (String(args[0]).includes("webgl")) return null;
      return original.apply(this, args);
    } as typeof original;
  });
  await page.goto("/villages/showcase-fern");
  await expect(page.getByRole("alert")).toContainText(
    "graphics view could not load",
  );
  await page
    .getByRole("button", { name: "Explore places", exact: true })
    .click();
  await page.getByRole("button", { name: /The Gathering Shelter/ }).click();
  await expect(page.getByRole("dialog")).toContainText("first gathering place");
  await expect(
    page.getByRole("button", { name: "Take a closer look", exact: true }),
  ).toBeDisabled();
});
