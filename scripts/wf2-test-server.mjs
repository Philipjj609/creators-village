// Isolated fake identities only. No real credentials/provider requests or live DB mutations.
import { randomUUID } from "node:crypto";
import { createPool, migrate } from "../apps/server/dist/database.js";
import { buildApp } from "../apps/server/dist/app.js";
import { generateBaseline } from "../packages/world/dist/founding.js";
import { generateWorld } from "../packages/world/dist/index.js";
import { publishFounding } from "../apps/server/dist/founding.js";
import { hash, encrypt, randomToken } from "../apps/server/dist/security.js";
if (process.env.NODE_ENV === "production")
  throw Error(
    "Synthetic identities are forbidden in production; fixture startup refused.",
  );
process.loadEnvFile(".local/runtime.env");
// Separate LW1 fixture keeps an existing PI1/WF2 rehearsal available as fallback.
const lw1 = process.argv.includes("--lw1");
const url = new URL(process.env.DATABASE_URL),
  admin = createPool(url.toString());
if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname))
  throw Error("The synthetic fixture requires a loopback PostgreSQL host.");
url.pathname = lw1
  ? "/creators_village_lw1_browser_test"
  : "/creators_village_wf2_browser_test";
try {
  await admin.query(
    lw1
      ? "CREATE DATABASE creators_village_lw1_browser_test"
      : "CREATE DATABASE creators_village_wf2_browser_test",
  );
} catch (e) {
  if (e.code !== "42P04") throw e;
}
await admin.end();
const pool = createPool(url.toString());
await migrate(pool);
await pool.query("TRUNCATE people CASCADE");
const owner = randomUUID(),
  member = randomUUID(),
  world = randomUUID(),
  config = {
    databaseUrl: url.toString(),
    clientId: "isolated-test",
    clientSecret: "not-real",
    redirectUri: lw1
      ? "http://localhost:3004/auth/twitch/callback"
      : "http://localhost:3002/auth/twitch/callback",
    webOrigin: lw1 ? "http://localhost:5176" : "http://localhost:5174",
    encryptionKey: "e".repeat(64),
    secureCookies: false,
    wf2WorldId: world,
  };
const sessions = {};
for (const [role, person] of [
  ["owner", owner],
  ["member", member],
]) {
  await pool.query(
    "INSERT INTO people(id,twitch_subject,display_name,twitch_login) VALUES($1,$2,$3,$4)",
    [person, "fixture-" + role, "Fixture " + role, "fixture_" + role],
  );
  const raw = randomToken(),
    csrf = randomToken();
  sessions[role] = raw;
  await pool.query(
    "INSERT INTO sessions(session_hash,person_id,csrf_token,encrypted_tokens,token_expires_at,expires_at) VALUES($1,$2,$3,$4,now()+interval '2 hours',now()+interval '1 day')",
    [
      hash(raw),
      person,
      csrf,
      encrypt(
        { access_token: role, refresh_token: role, expires_in: 7200 },
        config.encryptionKey,
      ),
    ],
  );
}
const legacy = generateWorld("fern", {
  id: randomUUID(),
  name: "Fixture legacy",
  createdAt: new Date().toISOString(),
  source: "creator",
});
await pool.query(
  "INSERT INTO worlds(id,creator_id,name,seed,generator_version,asset_version,schema_version,snapshot) VALUES($1,$2,$3,$4,$5,$6,1,$7)",
  [
    legacy.id,
    owner,
    legacy.name,
    legacy.seed,
    legacy.generatorVersion,
    legacy.assetVersion,
    legacy,
  ],
);
const job = randomUUID(),
  lease = new Date(Date.now() + 30000).toISOString();
await pool.query(
  "INSERT INTO founding_jobs(id,creator_id,command_id,request_hash,world_id,name,seed,purpose,status,lease_until) VALUES($1,$2,$3,$4,$5,'Automated fixture clearing','fern','development','working',$6)",
  [job, owner, randomUUID(), hash("browser-fixture"), world, lease],
);
await publishFounding(pool, job, generateBaseline("fern"), lease);
const app = await buildApp(config, pool, {
  exchange: async () => {
    throw Error("No real provider in fixture");
  },
  refresh: async () => {
    throw Error("No refresh in fixture");
  },
  validate: async (token) => ({
    subject: "fixture-" + token,
    displayName: "Fixture " + token,
    login: "fixture_" + token,
  }),
});
app.get("/__wf2_test/login/:role", async (req, reply) => {
  const role = req.params.role;
  if (!sessions[role]) return reply.code(404).send();
  reply.setCookie("cv_session", sessions[role], {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
  });
  return { fixture: true, worldId: world };
});
await app.listen({ host: "127.0.0.1", port: lw1 ? 3004 : 3002 });
console.log(
  `Isolated browser fixture ready on port${lw1 ? 3004 : 3002}; identities are synthetic.`,
);
for (const signal of ["SIGINT", "SIGTERM"])
  process.once(signal, () => {
    void app
      .close()
      .then(() => pool.end())
      .then(() => process.exit(0));
  });
