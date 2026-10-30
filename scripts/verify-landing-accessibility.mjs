import { chromium, expect } from "@playwright/test";
import fs from "node:fs/promises";
await fs.mkdir(".local/evidence/landing-redesign", { recursive: true });
const b = await chromium.launch({ headless: true });
const c = await b.newContext({
    viewport: { width: 1366, height: 900 },
    reducedMotion: "reduce",
  }),
  p = await c.newPage();
try {
  await p.goto("http://localhost:5173/");
  await p
    .getByRole("link", { name: /Join with Twitch/ })
    .first()
    .waitFor();
  await p.keyboard.press("Tab");
  const colors = await p.evaluate(() => {
    const style = (s) => getComputedStyle(document.querySelector(s));
    return {
      cream: style(".cv-landing").backgroundColor,
      navy: style(".cv-hero-description").color,
      muted: style(".cv-connection-note").color,
      eyebrow: style(".cv-hero .cv-eyebrow").color,
      largeAccent: style(".cv-hero em").color,
      actionBackground: style(".cv-primary").backgroundColor,
      actionText: style(".cv-primary").color,
      focus: style(".cv-skip").outlineColor,
      interactiveBorder: style(".cv-secondary").borderColor,
      closingBackground: style(".cv-closing").backgroundColor,
      closingText: style(".cv-closing h2").color,
      closingSmall: style(".cv-closing-actions>span").color,
      reducedMotion: style(".cv-primary").transitionDuration,
    };
  });
  const rgb = (s) =>
      s
        .match(/[\d.]+/g)
        .slice(0, 3)
        .map(Number),
    lum = (s) => {
      const c = rgb(s)
        .map((v) => v / 255)
        .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
      return c[0] * 0.2126 + c[1] * 0.7152 + c[2] * 0.0722;
    },
    contrast = (a, b) => {
      const l = [lum(a), lum(b)].sort((a, b) => b - a);
      return (l[0] + 0.05) / (l[1] + 0.05);
    };
  const cases = [
    ["Body", "navy", "cream", 4.5],
    ["Small text", "muted", "cream", 4.5],
    ["Eyebrow", "eyebrow", "cream", 4.5],
    ["Large accent headline", "largeAccent", "cream", 3],
    ["CTA", "actionText", "actionBackground", 4.5],
    ["Keyboard focus", "focus", "cream", 3],
    ["Secondary control border", "interactiveBorder", "cream", 3],
    ["Closing headline", "closingText", "closingBackground", 3],
    ["Closing small text", "closingSmall", "closingBackground", 4.5],
  ].map(([name, fg, bg, min]) => ({
    name,
    foreground: colors[fg],
    background: colors[bg],
    ratio: +contrast(colors[fg], colors[bg]).toFixed(2),
    required: min,
  }));
  for (const r of cases) expect(r.ratio).toBeGreaterThanOrEqual(r.required);
  expect(colors.reducedMotion).toBe("0s");
  await p.route("**/landing-art/village-plaza-*.webp", (r) => r.abort());
  await p.reload();
  await expect(
    p.getByText("The illustration couldn’t load.", { exact: false }),
  ).toBeVisible();
  await expect(
    p.getByRole("link", { name: /Explore the world/ }).first(),
  ).toHaveAttribute("href", "/villages/showcase-fern");
  await p.screenshot({
    path: ".local/evidence/landing-redesign/image-fallback.png",
  });
  await p.unroute("**/landing-art/village-plaza-*.webp");
  await p.route("**/api/me", (r) =>
    r.fulfill({ status: 503, json: { error: "Unavailable" } }),
  );
  await p.reload();
  await expect(p.getByRole("alert")).toContainText(
    "Account status is unavailable",
  );
  await expect(
    p.getByRole("button", { name: "Retry", exact: true }),
  ).toBeVisible();
  await p.unroute("**/api/me");
  await p.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(p.getByRole("alert")).toHaveCount(0);
  await p.setViewportSize({ width: 390, height: 844 });
  await p.reload();
  await p.locator(".cv-hero-art img").evaluate((i) => i.decode());
  expect(
    await p.locator(".cv-hero-art img").evaluate((i) => i.currentSrc),
  ).toContain("-400.webp");
  await p.screenshot({
    path: ".local/evidence/landing-redesign/mobile-viewport.png",
  });
  await fs.writeFile(
    "docs/testing/evidence/landing-redesign/contrast-and-fallback.json",
    JSON.stringify(
      {
        date: new Date().toISOString(),
        colors,
        cases,
        heroFailureFallback: true,
        accountFailureRetry: true,
        mobile1xSelects400Variant: true,
        reducedMotion: true,
        scope:
          "Computed solid UI colors; not a formal complete accessibility audit or every pixel of concept art",
      },
      null,
      2,
    ) + "\n",
  );
  console.log(
    JSON.stringify({
      contrastChecks: cases.length,
      allPass: true,
      imageAndAccountFailureRecovery: true,
    }),
  );
} finally {
  await c.close();
  await b.close();
}
