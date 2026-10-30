import { chromium, firefox, webkit, expect } from "@playwright/test";
import fs from "node:fs/promises";
const root = "docs/testing/evidence/landing-redesign";
const captures = ".local/evidence/landing-redesign";
await fs.mkdir(captures, { recursive: true });
await fs.mkdir(root, { recursive: true });
const results = [];
for (const [name, engine, width, height, mobile] of [
  ["desktop", chromium, 1440, 1000, false],
  ["hero-1366", chromium, 1366, 900, false],
  ["tablet", chromium, 768, 1024, false],
  ["mobile", chromium, 390, 844, true],
  ["small-mobile", chromium, 320, 740, true],
  ["firefox-desktop", firefox, 1440, 1000, false],
  ["webkit-mobile", webkit, 390, 844, true],
]) {
  const b = await engine.launch({ headless: true }),
    c = await b.newContext({
      viewport: { width, height },
      reducedMotion: "reduce",
      ...(mobile
        ? { isMobile: true, hasTouch: true, deviceScaleFactor: 2 }
        : {}),
    }),
    p = await c.newPage();
  const errors = [],
    badImages = [];
  p.on("pageerror", (e) => errors.push(e.message));
  p.on("response", (r) => {
    if (r.url().includes("/landing-art/") && r.status() >= 400)
      badImages.push(r.status());
  });
  try {
    await p.addInitScript(() => {
      window.__landingLcp = [];
      if (
        !PerformanceObserver.supportedEntryTypes.includes(
          "largest-contentful-paint",
        )
      )
        return;
      new PerformanceObserver((l) =>
        window.__landingLcp.push(
          ...l.getEntries().map((e) => ({
            ms: e.startTime,
            size: e.size,
            tag: e.element?.tagName,
          })),
        ),
      ).observe({ type: "largest-contentful-paint", buffered: true });
    });
    await p.goto("http://localhost:5173/");
    await expect(p.getByRole("heading", { level: 1 })).toHaveText(
      "A home for your community.",
    );
    await expect(
      p.getByRole("link", { name: "Join with Twitch", exact: false }).first(),
    ).toHaveAttribute("href", "/auth/twitch");
    await p.locator(".cv-hero-art img").evaluate((i) => i.decode());
    await p.screenshot({
      path: captures + "/" + name + ".png",
      fullPage: true,
    });
    if (name === "hero-1366")
      await p.locator(".cv-header").evaluate(() => scrollTo(0, 0));
    if (name === "hero-1366")
      await p.screenshot({ path: captures + "/hero-viewport.png" });
    const layout = await p.evaluate(() => ({
      overflow: document.documentElement.scrollWidth > innerWidth,
      missing: [...document.images].filter(
        (i) => i.complete && i.naturalWidth === 0,
      ).length,
      resources: performance
        .getEntriesByType("resource")
        .filter((r) => r.name.includes("/landing-art/"))
        .map((r) => ({
          file: r.name.split("/").pop(),
          transferBytes: r.transferSize,
          bodyBytes: r.decodedBodySize,
          durationMs: Math.round(r.duration),
        })),
      lcp: window.__landingLcp,
    }));
    if (layout.overflow || layout.missing || errors.length || badImages.length)
      throw Error(JSON.stringify({ layout, errors, badImages }));
    await p.keyboard.press("Control+Home");
    if (engine === webkit)
      await p.getByRole("link", { name: "Skip to content" }).focus();
    else await p.keyboard.press("Tab");
    await expect(
      p.getByRole("link", { name: "Skip to content" }),
    ).toBeFocused();
    await p.keyboard.press("Enter");
    await expect(p).toHaveURL("http://localhost:5173/");
    if (width > 600) {
      await p.getByRole("link", { name: "How it grows", exact: true }).click();
      await expect(p).toHaveURL("http://localhost:5173/");
      await p.getByRole("link", { name: "The village", exact: true }).click();
      await expect(p).toHaveURL("http://localhost:5173/");
    }
    if (["desktop", "mobile"].includes(name)) {
      await p
        .getByRole("link", { name: "Explore the world", exact: false })
        .click();
      await expect(
        p.getByRole("heading", { name: "Fern Beginning", exact: true }),
      ).toBeVisible();
      await p
        .getByRole("link", { name: "My Communities", exact: true })
        .click();
      await expect(
        p.getByRole("heading", { name: "My Communities", exact: true }),
      ).toBeVisible();
    }
    results.push({
      name,
      browser: b.version(),
      viewport: { width, height },
      touchEmulation: mobile,
      fullVillageReturnFlow: ["desktop", "mobile"].includes(name),
      skipFocusMethod:
        engine === webkit
          ? "programmatic focus + Enter (WebKit link-tab preference)"
          : "Tab + Enter",
      layout,
      errors,
      checked: [
        "semantic heading",
        "Twitch route unchanged",
        "skip link",
        "working section navigation where shown",
        ...(["desktop", "mobile"].includes(name)
          ? ["authentic labeled founding example", "My Communities return"]
          : []),
      ],
    });
  } finally {
    await c.close();
    await b.close();
  }
}
// Authenticated state uses the real app/API with a synthetic fixture identity, never the live person's cookies.
const b = await chromium.launch({ headless: true }),
  c = await b.newContext({ viewport: { width: 1440, height: 1000 } }),
  p = await c.newPage();
try {
  await c.request.get("http://localhost:3002/__wf2_test/login/owner");
  await p.goto("http://localhost:5174/");
  await expect(
    p.getByRole("link", { name: /My Communities/ }).first(),
  ).toBeVisible();
  await expect(p.getByRole("link", { name: /Join with Twitch/ })).toHaveCount(
    0,
  );
  await p.screenshot({ path: captures + "/authenticated.png", fullPage: true });
  await p
    .getByRole("link", { name: /My Communities/ })
    .first()
    .click();
  await expect(
    p.getByRole("heading", { name: "Your creator village" }),
  ).toBeVisible();
  const auth = await c.request.get("http://localhost:3002/auth/twitch", {
    maxRedirects: 0,
  });
  const u = new URL(auth.headers().location);
  expect(u.searchParams.get("scope")).toBe("");
  results.push({
    name: "authenticated CTA",
    identity:
      "isolated synthetic API/PG fixture; not real Twitch end-to-end proof",
    scopeUnchanged: true,
    communitiesNavigation: true,
  });
} finally {
  await c.close();
  await b.close();
}
await fs.writeFile(
  root + "/browser-review.json",
  JSON.stringify(
    {
      date: new Date().toISOString(),
      results,
      screenshotStorage: { directory: captures, gitTracked: false },
      limitations: [
        "Headless desktop browsers and touch emulation; no physical mobile claim",
        "Local load timing is not a hosted performance benchmark",
        "Independent-person Twitch and game-world art gates remain pending",
      ],
    },
    null,
    2,
  ) + "\n",
);
console.log(JSON.stringify({ configurations: results.length, verified: true }));
