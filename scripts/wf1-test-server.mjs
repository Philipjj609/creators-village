// Isolated retained browser/HTTP harness. Never points at the live village DB.
import { createPool, migrate } from "../apps/server/dist/database.js";
import { buildApp } from "../apps/server/dist/app.js";
process.loadEnvFile(".local/runtime.env");
const url = new URL(process.env.DATABASE_URL);
url.pathname = "/creators_village_wf1_browser";
const admin = createPool(process.env.DATABASE_URL);
try {
  await admin.query("CREATE DATABASE creators_village_wf1_browser");
} catch (e) {
  if (e.code !== "42P04") throw e;
} finally {
  await admin.end();
}
const pool = createPool(url.toString());
await migrate(pool);
const token = { access_token: "test", refresh_token: "test", expires_in: 7200 };
const app = await buildApp(
  {
    databaseUrl: url.toString(),
    clientId: "isolated-browser-test",
    clientSecret: "test-only",
    redirectUri: "http://localhost:3301/auth/twitch/callback",
    webOrigin: "http://localhost:5173",
    encryptionKey: "c".repeat(64),
    secureCookies: false,
  },
  pool,
  {
    exchange: async (code) => ({ ...token, access_token: "fixture:" + code }),
    refresh: async () => token,
    validate: async (access) => ({
      subject: access,
      displayName: "WF1 test creator",
    }),
  },
);
await app.listen({ host: "127.0.0.1", port: 3301 });
console.log(
  "Isolated WF1 test API on loopback3301; fake provider, separate database",
);
for (const signal of ["SIGINT", "SIGTERM"])
  process.once(
    signal,
    () =>
      void app
        .close()
        .then(() => pool.end())
        .then(() => process.exit(0)),
  );
