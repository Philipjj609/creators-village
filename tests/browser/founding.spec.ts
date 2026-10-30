import { test, expect } from "@playwright/test";
test("WF1 compatibility alias loads same persisted baseline through new village experience", async ({
  page,
}) => {
  let baseline = "";
  page.on("response", async (r) => {
    if (r.url().includes("/api/founding/showcase-fern/chunks?")) {
      const b = await r.json();
      baseline = b.baselineHash;
    }
  });
  await page.goto("/?founding=fern");
  await page.locator("[data-render-state=ready]").waitFor();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Fern Beginning",
  );
  await expect.poll(() => baseline).not.toBe("");
  const first = baseline;
  await page.reload();
  await page.locator("[data-render-state=ready]").waitFor();
  expect(baseline).toBe(first);
  await page.goto("/?world=00000000-0000-4000-8000-000000000000");
  await expect(page.getByRole("alert")).toContainText("unavailable");
});
test("geographic mismatch preserves saved-data boundary and accessible inspection", async ({
  page,
}) => {
  await page.route("**/api/founding/showcase-fern/chunks?**", (route) =>
    route.fulfill({ json: { baselineHash: "wrong", chunks: [] } }),
  );
  await page.goto("/?founding=fern");
  await expect(page.getByRole("alert")).toContainText(
    "graphics view could not load",
  );
  await page
    .getByRole("button", { name: "Explore places", exact: true })
    .click();
  await page.getByRole("button", { name: /The Gathering Shelter/ }).click();
  await expect(page.getByRole("dialog")).toContainText("The Gathering Shelter");
});
