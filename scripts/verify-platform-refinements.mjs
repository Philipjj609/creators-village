import { chromium, firefox, webkit, expect } from "@playwright/test";
import fs from "node:fs/promises";
const captures = ".local/evidence/platform-consistency";
await fs.mkdir(captures, { recursive: true });
const results = [];
function contrast(a, b) {
  const lum = (s) => {
    const c = s
      .match(/[0-9.]+/g)
      .slice(0, 3)
      .map(Number)
      .map((v) => v / 255)
      .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return c[0] * 0.2126 + c[1] * 0.7152 + c[2] * 0.0722;
  };
  const l = [lum(a), lum(b)].sort((a, b) => b - a);
  return (l[0] + 0.05) / (l[1] + 0.05);
}
for (const [name, engine, width, height, reduced] of [
  ["desktop", chromium, 1440, 1000, false],
  ["tablet", chromium, 768, 1024, true],
  ["mobile", chromium, 390, 844, true],
  ["firefox", firefox, 1440, 1000, false],
  ["webkit-mobile", webkit, 390, 844, true],
]) {
  const browser = await engine.launch({
    headless: true,
    ...(engine === chromium ? { args: ["--enable-unsafe-swiftshader"] } : {}),
  });
  const c = await browser.newContext({
    viewport: { width, height },
    reducedMotion: reduced ? "reduce" : "no-preference",
    ...(width === 390 ? { isMobile: true, hasTouch: true } : {}),
  });
  const p = await c.newPage(),
    errors = [];
  p.on("pageerror", (e) => errors.push(e.message));
  try {
    await p.addInitScript(() => {
      window.__sectionScrolls = [];
      const original = window.scrollTo;
      window.scrollTo = function (...args) {
        window.__sectionScrolls.push(args[0]);
        return original.apply(this, args);
      };
    });
    await p.goto("http://localhost:5173/");
    await expect(p.getByRole("heading", { level: 1 })).toHaveText(
      "A home for your community.",
    );
    await expect(p.locator(".cv-hero-description")).toHaveText(
      "A living world where creators and their communities come together, build, and grow something that lasts beyond the stream.",
    );
    await p.locator(".cv-hero-art img").evaluate((i) => i.decode());
    const href = p.url(),
      historySize = await p.evaluate(() => history.length);
    if (width > 600) {
      await p.getByRole("link", { name: "How it grows", exact: true }).click();
      await expect(p.locator("#how-it-grows")).toBeFocused();
      await expect
        .poll(() =>
          p
            .locator("#how-it-grows")
            .evaluate((e) => e.getBoundingClientRect().top),
        )
        .toBeLessThan(130);
      await expect(p).toHaveURL(href);
      await p.getByRole("link", { name: "The village", exact: true }).focus();
      await p.keyboard.press("Enter");
      await expect(p.locator("#the-village")).toBeFocused();
      await expect(p).toHaveURL(href);
      expect(await p.evaluate(() => history.length)).toBe(historySize);
      const calls = await p.evaluate(() => window.__sectionScrolls);
      expect(calls.at(-1).behavior).toBe(reduced ? "auto" : "smooth");
      const visible = await p.evaluate(
        () =>
          document.getElementById("the-village").getBoundingClientRect().top >=
          document.querySelector(".cv-header").getBoundingClientRect().bottom -
            1,
      );
      expect(visible).toBe(true);
    }
    await p.getByRole("link", { name: "Skip to content" }).focus();
    await p.keyboard.press("Enter");
    expect(p.url()).toBe(href);
    expect(await p.evaluate(() => history.length)).toBe(historySize);
    await expect(p.locator("main")).toBeFocused();
    await p.evaluate(() => scrollTo({ top: 0, behavior: "instant" }));
    if (width >= 1024)
      expect(
        await p
          .locator(".cv-header .cv-wordmark")
          .evaluate(
            (e) =>
              Math.abs(
                e.getBoundingClientRect().top -
                  e.querySelector("span").getBoundingClientRect().top,
              ) < 3,
          ),
      ).toBe(true);
    await p.mouse.move(width - 2, height - 2);
    await p.screenshot({
      path: captures + "/landing-" + name + ".png",
      fullPage: true,
    });
    // Ordinary route navigation still creates one usable history entry; section links create none.
    if (name === "desktop") {
      await p.getByRole("link", { name: /Explore the world/ }).click();
      await expect(
        p.getByRole("heading", { name: "Fern Beginning", exact: true }),
      ).toBeVisible();
      await p.goBack();
      await expect(p.getByRole("heading", { level: 1 })).toHaveText(
        "A home for your community.",
      );
      expect(p.url()).toBe(href);
    }
    const login = await c.request.get(
      "http://localhost:3002/__wf2_test/login/owner",
    );
    expect(login.ok()).toBe(true);
    const { worldId } = await login.json();
    await p.goto("http://localhost:5174/communities");
    await expect(
      p.getByRole("heading", { name: "Your creator village" }),
    ).toBeVisible();
    const palette = await p.locator(".pi-site").evaluate((e) => ({
      background: getComputedStyle(e).backgroundColor,
      color: getComputedStyle(e).color,
      font: getComputedStyle(e).fontFamily,
    }));
    expect(palette.background).toBe("rgb(247, 235, 221)");
    expect(palette.color).toBe("rgb(25, 34, 58)");
    const primary = await p
      .locator(".pi-header .pi-button.primary")
      .evaluate((e) => ({
        foreground: getComputedStyle(e).color,
        background: getComputedStyle(e).backgroundColor,
      }));
    const primaryContrast = contrast(primary.foreground, primary.background);
    expect(primaryContrast).toBeGreaterThanOrEqual(4.5);
    await p.screenshot({
      path: captures + "/communities-" + name + ".png",
      fullPage: true,
      mask: [p.locator("[data-private]")],
      maskColor: "#d8c6b3",
      animations: "disabled",
    });
    await p.getByRole("link", { name: /Private development world/ }).click();
    await p.locator("[data-render-state=ready]").waitFor({ timeout: 30000 });
    await p.waitForTimeout(150);
    await p.screenshot({
      path: captures + "/village-" + name + ".png",
      mask: [p.locator("[data-private]")],
      maskColor: "#d8c6b3",
      animations: "disabled",
    });
    const canvas = await p.locator("canvas").elementHandle();
    const stage = await p.locator(".pi-world-stage").boundingBox();
    expect(stage.height).toBeGreaterThan(height - 100);
    await expect(p.getByRole("dialog")).toHaveCount(0);
    await p
      .getByRole("button", { name: "Community projects", exact: true })
      .click();
    await expect(p.getByRole("dialog")).toHaveAccessibleName(
      "Community projects",
    );
    expect(await canvas.evaluate((n) => n.isConnected)).toBe(true);
    expect(
      await p
        .locator(".pi-panel")
        .evaluate((e) => getComputedStyle(e).backgroundColor),
    ).toBe("rgb(255, 248, 239)");
    await p.screenshot({
      path: captures + "/projects-" + name + ".png",
      mask: [p.locator("[data-private]")],
      maskColor: "#d8c6b3",
      animations: "disabled",
    });
    await p
      .getByRole("button", { name: "Community and admission", exact: true })
      .click();
    await expect(
      p.getByRole("button", { name: "Create one-use, 24-hour request link" }),
    ).toBeVisible();
    await p
      .getByRole("button", {
        name: "Village settings and management",
        exact: true,
      })
      .click();
    await p
      .getByRole("button", { name: "Receipts and recognition", exact: true })
      .click();
    await expect(p.getByRole("dialog")).toHaveAccessibleName(
      "Receipts and recognition",
    );
    await p.getByRole("button", { name: "Close panel", exact: true }).click();
    expect(await canvas.evaluate((n) => n.isConnected)).toBe(true);
    await expect(p.locator("canvas")).toHaveCount(1);
    expect(
      await p.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    if (errors.length) throw Error(errors.join(";"));
    results.push({
      name,
      browser: browser.version(),
      viewport: { width, height },
      reducedMotion: reduced,
      landingURLUnchanged: true,
      historyUnaffected: true,
      desktopWordmarkSingleLine:
        width >= 1024 ? "verified" : "responsive compact",
      palette,
      primaryContrast: +primaryContrast.toFixed(2),
      actualApiBackedVillage: true,
      panelsAndPrivacy: true,
      canvasRetained: true,
      errors,
    });
  } finally {
    await c.close();
    await browser.close();
  }
}
await fs.mkdir("docs/testing/evidence/platform-consistency", {
  recursive: true,
});
await fs.writeFile(
  "docs/testing/evidence/platform-consistency/browser-review.json",
  JSON.stringify(
    {
      date: new Date().toISOString(),
      results,
      screenshots: { directory: captures, gitTracked: false },
      identity:
        "Existing isolated synthetic sessions; no real-person identity or live gameplay mutation",
      limitations: [
        "Headless browsers and touch emulation, not physical devices",
        "Independent-person Twitch verification pending",
        "World-art acceptance remains open",
      ],
    },
    null,
    2,
  ) + "\n",
);
console.log(JSON.stringify({ configurations: results.length, verified: true }));
