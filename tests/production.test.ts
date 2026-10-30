import { afterEach, expect, it, vi } from "vitest";
import { createRequire } from "node:module";
const Fastify = createRequire(
  new URL("../apps/server/package.json", import.meta.url),
)(
  "fastify",
) as typeof import("../apps/server/node_modules/fastify/fastify.js").default;
import { loadConfig } from "../apps/server/src/config.js";
import { registerProductionWeb } from "../apps/server/src/production-web.js";
afterEach(() => vi.unstubAllEnvs());
function environment() {
  for (const [key, value] of Object.entries({
    NODE_ENV: "production",
    DATABASE_URL: "postgres://unused",
    TOKEN_ENCRYPTION_KEY: "f".repeat(64),
    TWITCH_CLIENT_ID: "fixture",
    TWITCH_CLIENT_SECRET: "fixture",
    WEB_ORIGIN: "https://village.invalid",
    TWITCH_REDIRECT_URI: "https://village.invalid/auth/twitch/callback",
    AUTH_MODE: "twitch",
    GAMEPLAY_WRITES: "paused",
  }))
    vi.stubEnv(key, value);
}
it("PI2 production configuration requires exact HTTPS callback, credentials and real auth", () => {
  environment();
  expect(loadConfig()).toMatchObject({
    production: true,
    secureCookies: true,
    writesPaused: true,
  });
  for (const [key, value] of [
    ["WEB_ORIGIN", "http://village.invalid"],
    ["WEB_ORIGIN", "https://village.invalid/"],
    ["TWITCH_REDIRECT_URI", "https://other.invalid/auth/twitch/callback"],
    ["TWITCH_CLIENT_SECRET", ""],
    ["AUTH_MODE", "synthetic"],
    ["TRUST_PROXY_HOPS", "true"],
  ]) {
    const old = process.env[key!];
    vi.stubEnv(key!, value!);
    expect(() => loadConfig()).toThrow();
    vi.stubEnv(key!, old);
  }
  vi.stubEnv("CV_TEST_LOGIN", "enabled");
  expect(() => loadConfig()).toThrow("Test authentication");
});
it("PI2 production web allowlist supports product deep links without exposing authoring, source maps or private paths", async () => {
  const app = Fastify();
  await registerProductionWeb(app);
  try {
    for (const url of [
      "/",
      "/communities",
      "/create",
      "/playtest",
      "/join",
      "/settings",
      "/villages/showcase-fern",
    ]) {
      const response = await app.inject(url);
      expect(response.statusCode).toBe(200);
      expect(response.headers["content-type"]).toContain("text/html");
      expect(response.headers["cache-control"]).toBe("no-store");
    }
    for (const url of [
      "/api/missing",
      "/auth/missing",
      "/__wf2_test/login/owner",
      "/studies/h01.html",
      "/assets/source/hearthside-hero-01/hero.blend",
      "/assets/hearthside-hero-01/source-manifest.json",
      "/.env.local",
      "/docs/testing/evidence/wf2/source-calibration.json",
      "/unknown",
      "/assets/not-there.js",
      "/assets/index.js.map",
    ])
      expect((await app.inject(url)).statusCode).toBe(404);
    const art = await app.inject("/assets/hearthside-hero-01/commons.png");
    expect(art.statusCode).toBe(200);
    expect(art.headers["cache-control"]).toContain("immutable");
    expect(art.headers["content-type"]).toBe("image/png");
  } finally {
    await app.close();
  }
});
