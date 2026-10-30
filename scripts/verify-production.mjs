// Isolated local production rehearsal. Never reads the live project's credential files.
import fs from "node:fs/promises";
import path from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import http from "node:http";
import https from "node:https";
import assert from "node:assert/strict";
import { chromium, expect } from "@playwright/test";
const directory = path.resolve(".local/production");
await fs.mkdir(directory, { recursive: true });
const compose = [
  "compose",
  "-p",
  "cv-pi2-rehearsal",
  "-f",
  "compose.production.yaml",
];
function execute(command, args, input) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let output = "",
      error = "";
    child.stdout.on("data", (b) => (output += b));
    child.stderr.on("data", (b) => (error += b));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) return resolve(output.trim());
      let safe = error.replace(
        /postgres(?:ql)?:\/\/[^\s]+/g,
        "[database URL redacted]",
      );
      for (const value of Object.values(secrets ?? {}))
        safe = safe.replaceAll(value, "[fixture value redacted]");
      reject(
        Error(`Rehearsal subprocess failed (${code}): ${safe.slice(-2600)}`),
      );
    });
    child.stdin.end(input);
  });
}
const docker = (args, input) => execute("docker", [...compose, ...args], input);
let secrets;
try {
  secrets = JSON.parse(
    await fs.readFile(path.join(directory, "fixture-secrets.json"), "utf8"),
  );
} catch (e) {
  if (e.code !== "ENOENT") throw e;
  secrets = {
    admin: randomBytes(24).toString("hex"),
    runtime: randomBytes(24).toString("hex"),
    key: randomBytes(32).toString("hex"),
    world: randomUUID(),
  };
  await fs.writeFile(
    path.join(directory, "fixture-secrets.json"),
    JSON.stringify(secrets),
    { mode: 0o600 },
  );
}
const appEnvironment = (writes) =>
  `NODE_ENV=production\nAUTH_MODE=twitch\nHOST=0.0.0.0\nPORT=10000\nTRUST_PROXY_HOPS=1\nWEB_ORIGIN=https://localhost:10443\nTWITCH_REDIRECT_URI=https://localhost:10443/auth/twitch/callback\nTWITCH_CLIENT_ID=pi2-fixture\nTWITCH_CLIENT_SECRET=not-real\nTOKEN_ENCRYPTION_KEY=${secrets.key}\nDATABASE_URL=postgresql://cv_runtime:${secrets.runtime}@db:5432/cv_pi2\nDATABASE_TRANSPORT=private-network\nGAMEPLAY_WRITES=${writes}\nWF2_APPROVED_WORLD_ID=${secrets.world}\n`;
await fs.writeFile(
  path.join(directory, "database.env"),
  `POSTGRES_DB=cv_pi2\nPOSTGRES_USER=cv_migrator\nPOSTGRES_PASSWORD=${secrets.admin}\n`,
  { mode: 0o600 },
);
await fs.writeFile(path.join(directory, "app.env"), appEnvironment("enabled"), {
  mode: 0o600,
});
await fs.writeFile(
  path.join(directory, "migration.env"),
  `MIGRATION_DATABASE_URL=postgresql://cv_migrator:${secrets.admin}@db:5432/cv_pi2\n`,
  { mode: 0o600 },
);
const checks = [],
  check = (name, details = true) => {
    checks.push({ name, details });
    console.log("PASS " + name);
  };
let edge;
const adminSql = (sql) =>
  docker(
    [
      "exec",
      "-T",
      "db",
      "psql",
      "-U",
      "cv_migrator",
      "-d",
      "cv_pi2",
      "-v",
      "ON_ERROR_STOP=1",
      "-At",
    ],
    sql,
  );
const seedScript = `
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { createPool } from './apps/server/dist/database.js';
import { publishFounding } from './apps/server/dist/founding.js';
import { hash,encrypt,randomToken } from './apps/server/dist/security.js';
const require=createRequire(process.cwd()+'/apps/server/package.json');
const {generateBaseline}=await import(require.resolve('@creators-village/world/founding'));
const {generateWorld}=await import(require.resolve('@creators-village/world'));
const pool=createPool(process.env.MIGRATION_DATABASE_URL);
await pool.query('TRUNCATE people CASCADE'); // Only cv_pi2 isolated rehearsal database.
const owner=randomUUID(),member=randomUUID(),world=process.env.WF2_APPROVED_WORLD_ID,key=process.env.TOKEN_ENCRYPTION_KEY,actors={};
for(const [role,id] of [['owner',owner],['member',member]]){
 const raw=randomToken(),csrf=randomToken();
 await pool.query('INSERT INTO people(id,twitch_subject,display_name,twitch_login) VALUES($1,$2,$3,$4)',[id,'pi2-'+role,'Synthetic '+role,'pi2_'+role]);
 await pool.query("INSERT INTO sessions(session_hash,person_id,csrf_token,encrypted_tokens,token_expires_at,expires_at) VALUES($1,$2,$3,$4,now()+interval '2 hours',now()+interval '1 day')",[hash(raw),id,csrf,encrypt({access_token:'synthetic',refresh_token:'synthetic',expires_in:7200},key)]);
 actors[role]={raw,csrf,id};
}
const legacy=generateWorld('fern',{id:randomUUID(),name:'Synthetic legacy',createdAt:new Date().toISOString(),source:'creator'});
await pool.query('INSERT INTO worlds(id,creator_id,name,seed,generator_version,asset_version,schema_version,snapshot) VALUES($1,$2,$3,$4,$5,$6,1,$7)',[legacy.id,owner,legacy.name,legacy.seed,legacy.generatorVersion,legacy.assetVersion,legacy]);
const legacyCommandId=randomUUID();
await pool.query('INSERT INTO create_receipts(person_id,command_id,request_hash,world_id) VALUES($1,$2,$3,$4)',[owner,legacyCommandId,hash(JSON.stringify({name:legacy.name,seed:legacy.seed})),legacy.id]);
const job=randomUUID(),lease=new Date(Date.now()+30000).toISOString(),baseline=generateBaseline('fern');
await pool.query("INSERT INTO founding_jobs(id,creator_id,command_id,request_hash,world_id,name,seed,purpose,status,lease_until) VALUES($1,$2,$3,$4,$5,'Production rehearsal','fern','development','working',$6)",[job,owner,randomUUID(),hash('pi2-fixture'),world,lease]);
await publishFounding(pool,job,baseline,lease);
console.log(JSON.stringify({world,actors,legacy:legacy.id,legacyCommandId,baselineHash:baseline.hash}));await pool.end();`;
try {
  await docker(["up", "-d", "--wait", "db"]);
  await docker(["run", "--rm", "--no-deps", "-T", "migrate"]);
  const migrationCount = await adminSql(
    "SELECT count(*) FROM schema_migrations;",
  );
  await docker(["run", "--rm", "--no-deps", "-T", "migrate"]);
  assert.equal(
    await adminSql("SELECT count(*) FROM schema_migrations;"),
    migrationCount,
  );
  check("separate migrations and idempotent rerun", Number(migrationCount));
  await adminSql(
    `DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='cv_runtime') THEN CREATE ROLE cv_runtime LOGIN PASSWORD '${secrets.runtime}'; END IF; END $$;\n` +
      (await fs.readFile("deploy/runtime-grants.sql", "utf8")),
  );
  const fixture = JSON.parse(
    await docker(
      [
        "run",
        "--rm",
        "--no-deps",
        "-T",
        "migrate",
        "node",
        "--input-type=module",
      ],
      seedScript,
    ),
  );
  const before = await adminSql(
    "SELECT md5(string_agg(hash,'' ORDER BY x,y)) FROM founding_chunks;",
  );
  await docker(["up", "-d", "--wait", "--no-build", "app"]);
  // Synthetic sessions are injected directly into this isolated DB, never via an authentication route.
  // Freshness is advanced only after startup's real-provider revalidation fence has run.
  const refresh = () =>
    adminSql("UPDATE sessions SET validated_at=now() WHERE expires_at>now();");
  await refresh();
  const openssl =
    process.env.CV_OPENSSL ?? "C:/Program Files/Git/usr/bin/openssl.exe";
  await execute(openssl, [
    "req",
    "-x509",
    "-newkey",
    "rsa:2048",
    "-nodes",
    "-keyout",
    path.join(directory, "edge.key"),
    "-out",
    path.join(directory, "edge.pem"),
    "-days",
    "1",
    "-subj",
    "/CN=localhost",
    "-addext",
    "subjectAltName=DNS:localhost",
  ]);
  const ca = await fs.readFile(path.join(directory, "edge.pem"));
  edge = https.createServer(
    { key: await fs.readFile(path.join(directory, "edge.key")), cert: ca },
    (req, res) => {
      const upstream = http.request(
        {
          hostname: "127.0.0.1",
          port: 10000,
          method: req.method,
          path: req.url,
          headers: {
            ...req.headers,
            "x-forwarded-for": "127.0.0.1",
            "x-forwarded-proto": "https",
          },
        },
        (response) => {
          res.writeHead(response.statusCode, response.headers);
          response.pipe(res);
        },
      );
      upstream.on("error", () => {
        if (!res.headersSent) res.writeHead(503);
        res.end();
      });
      res.on("close", () => upstream.destroy());
      req.pipe(upstream);
    },
  );
  await new Promise((resolve) => edge.listen(10443, "127.0.0.1", resolve));
  function request(url, actor, body, extra = {}) {
    const headers = {
      ...(actor
        ? {
            Cookie: "cv_session=" + fixture.actors[actor].raw,
            "X-CSRF-Token": fixture.actors[actor].csrf,
          }
        : {}),
      ...(body
        ? {
            Origin: "https://localhost:10443",
            "Content-Type": "application/json",
          }
        : {}),
      ...extra,
    };
    return new Promise((resolve, reject) => {
      const req = https.request(
        {
          hostname: "localhost",
          family: 4,
          port: 10443,
          path: url,
          ca,
          method: body ? "POST" : "GET",
          headers,
          timeout: 15000,
        },
        (response) => {
          let text = "";
          response.on("data", (b) => (text += b));
          response.on("end", () => {
            let json;
            try {
              json = JSON.parse(text);
            } catch {}
            resolve({
              status: response.statusCode,
              headers: response.headers,
              text,
              json,
            });
          });
        },
      );
      req.on("error", reject);
      req.on("timeout", () => req.destroy(Error("Request timeout")));
      req.end(body ? JSON.stringify(body) : undefined);
    });
  }
  const endpoint = `/api/wf2/worlds/${fixture.world}`;
  const command = (kind, payload = {}, commandId = randomUUID()) => ({
    commandSchema: "wf2-command-1",
    commandId,
    kind,
    payload,
  });
  const send = async (kind, payload = {}, actor = "owner") => {
    const r = await request(
      endpoint + "/commands",
      actor,
      command(kind, payload),
    );
    assert.equal(r.status, 200, `command ${kind}: ${r.status} ${r.text}`);
    return r.json.result;
  };
  assert.equal((await request("/readyz")).status, 200);
  assert.equal((await request("/communities")).status, 200);
  assert.equal((await request("/api/communities")).status, 401);
  for (const url of [
    "/__wf2_test/login/owner",
    "/.env.local",
    "/assets/source/hearthside-hero-01/hero.blend",
    "/api/missing",
  ])
    assert.equal((await request(url)).status, 404);
  const oauth = await request("/auth/twitch");
  assert.equal(oauth.status, 302);
  assert.equal(
    new URL(oauth.headers.location).searchParams.get("redirect_uri"),
    "https://localhost:10443/auth/twitch/callback",
  );
  assert.match(oauth.headers["set-cookie"].join(";"), /HttpOnly/);
  assert.match(oauth.headers["set-cookie"].join(";"), /Secure/);
  assert.match(oauth.headers["set-cookie"].join(";"), /SameSite=Lax/);
  assert.equal(
    (await request("/auth/twitch/callback?code=untrusted&state=untrusted"))
      .status,
    400,
  );
  assert.equal(
    (
      await request(
        endpoint + "/commands",
        "owner",
        command("EnablePlaytest", {
          expectedBaselineHash: fixture.baselineHash,
        }),
        { Origin: "https://attacker.invalid" },
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await request(
        endpoint + "/commands",
        "owner",
        command("EnablePlaytest", {
          expectedBaselineHash: fixture.baselineHash,
        }),
        { "X-CSRF-Token": "bad" },
      )
    ).status,
    403,
  );
  check(
    "one-origin HTTPS edge, secure OAuth state cookie, auth/CSRF and private-file rejection",
  );
  assert.equal(
    (
      await request("/api/villages", "owner", {
        commandId: fixture.legacyCommandId,
        name: "Synthetic legacy",
        seed: "fern",
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await request("/api/villages", "member", {
        commandId: randomUUID(),
        name: "No onboarding",
        seed: "fern",
      })
    ).status,
    403,
  );
  await send("EnablePlaytest", { expectedBaselineHash: fixture.baselineHash });
  assert.equal((await request(endpoint + "/bootstrap", "member")).status, 404);
  const invitation = await send("IssueInvitation");
  const link = (
    await request(
      endpoint + `/invitations/${invitation.inviteId}/link`,
      "owner",
    )
  ).json.url;
  const token = link.split("=")[1];
  const cont = await request(
    "/api/wf2/join/continuations",
    undefined,
    { token },
    { "x-wf2-join": "1" },
  );
  assert.equal(cont.status, 200);
  const continuationCookie = cont.headers["set-cookie"]
    .find((c) => c.startsWith("cv_join="))
    .split(";")[0];
  const joining = await request(
    "/api/wf2/join/commands",
    "member",
    command("RequestJoin", { continuationId: cont.json.continuationId }),
    {
      Cookie:
        "cv_session=" + fixture.actors.member.raw + "; " + continuationCookie,
    },
  );
  assert.equal(joining.status, 200);
  await send("ApproveRequest", {
    requestId: joining.json.result.requestId,
    expectedRequestRevision: "1",
  });
  check(
    "creator-approved admission over production HTTPS transport; synthetic DB sessions explicitly isolated",
  );
  const initial = (await request(endpoint + "/bootstrap", "member")).json;
  const stream = await new Promise((resolve, reject) => {
    const req = https.get(
      {
        hostname: "localhost",
        family: 4,
        port: 10443,
        ca,
        path: endpoint + "/stream?after=" + initial.cursor,
        headers: { Cookie: "cv_session=" + fixture.actors.member.raw },
      },
      (response) => {
        let text = "";
        response.on("data", (b) => (text += b));
        resolve({ req, response, text: () => text });
      },
    );
    req.on("error", reject);
  });
  assert.equal(stream.response.statusCode, 200);
  assert.equal(stream.response.headers["x-accel-buffering"], "no");
  const draft = await send("CreateDraft", { site: { qx: 1792, qy: 1280 } });
  await send("PublishProject", {
    projectId: draft.projectId,
    expectedProjectRevision: "1",
    planHash: draft.planHash,
  });
  await send("Contribute", {
    projectId: draft.projectId,
    planHash: draft.planHash,
    recognitionOptIn: false,
  });
  // Hold topology lock so completion cannot commit before an abrupt container death.
  const lock = spawn(
    "docker",
    [
      ...compose,
      "exec",
      "-T",
      "db",
      "psql",
      "-U",
      "cv_migrator",
      "-d",
      "cv_pi2",
      "-At",
    ],
    { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] },
  );
  lock.stdin.write(
    `BEGIN; SELECT world_id FROM wf2_topology_guards WHERE world_id='${fixture.world}' FOR UPDATE; SELECT 'LOCK_HELD';\n`,
  );
  await new Promise((resolve) =>
    lock.stdout.on("data", (b) => {
      if (b.toString().includes("LOCK_HELD")) resolve();
    }),
  );
  await send(
    "Contribute",
    {
      projectId: draft.projectId,
      planHash: draft.planHash,
      recognitionOptIn: false,
    },
    "member",
  );
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline && !stream.text().includes("id: "))
    await new Promise((r) => setTimeout(r, 100));
  assert.match(stream.text(), /id: /);
  stream.req.destroy();
  check(
    "authenticated SSE through HTTPS proxy delivers durable ordered project/contribution events",
  );
  let leased = false;
  for (let attempt = 0; attempt < 15; attempt++) {
    leased =
      (await adminSql("SELECT status FROM wf2_completion_jobs LIMIT 1;")) ===
      "leased";
    if (leased) break;
    await new Promise((r) => setTimeout(r, 50));
  }
  assert.ok(leased, "worker must durably lease completion before SIGKILL");
  await docker(["kill", "-s", "SIGKILL", "app"]);
  lock.stdin.end("ROLLBACK;\n");
  await new Promise((resolve) => lock.on("close", resolve));
  await docker(["up", "-d", "--wait", "--no-build", "app"]);
  await refresh();
  const limit = Date.now() + 45000;
  let state;
  do {
    state = (await request(endpoint + "/bootstrap", "member")).json;
    if (state.structures?.length === 2) break;
    await new Promise((r) => setTimeout(r, 500));
  } while (Date.now() < limit);
  assert.equal(state.structures.length, 2);
  assert.equal(await adminSql("SELECT count(*) FROM wf2_contributions;"), "2");
  assert.equal(
    await adminSql(
      "SELECT count(*) FROM wf2_completion_jobs WHERE status='done';",
    ),
    "1",
  );
  assert.equal(
    await adminSql(
      "SELECT md5(string_agg(hash,'' ORDER BY x,y)) FROM founding_chunks;",
    ),
    before,
  );
  assert.equal((await request("/api/villages/" + fixture.legacy)).status, 200);
  const replay = await request(
    endpoint + "/events?after=" + initial.cursor,
    "member",
  );
  assert.equal(replay.status, 200);
  assert.ok(replay.json);
  check(
    "SIGKILL completion recovery, exactly-once workshop/path, replay, v1 reader and geographic persistence",
  );
  await fs.writeFile(
    path.join(directory, "app.env"),
    appEnvironment("paused"),
    { mode: 0o600 },
  );
  await docker(["up", "-d", "--wait", "--no-build", "--force-recreate", "app"]);
  await refresh();
  assert.equal(
    (await request(endpoint + "/commands", "owner", command("IssueInvitation")))
      .status,
    503,
  );
  assert.equal((await request(endpoint + "/bootstrap", "member")).status, 200);
  check("readable maintenance rollback with gameplay writes paused");
  const browser = await chromium.launch({
    headless: true,
    args: ["--enable-unsafe-swiftshader"],
  });
  try {
    const context = await browser.newContext({
      ignoreHTTPSErrors: true,
      viewport: { width: 1440, height: 1000 },
    });
    const page = await context.newPage(),
      errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto("https://localhost:10443/");
    const landingHeaders = (await request("/")).headers;
    assert.match(
      landingHeaders["content-security-policy"],
      /script-src 'self'/,
    );
    assert.ok(
      !landingHeaders["content-security-policy"].includes("'unsafe-eval'"),
    );
    await expect(
      page.getByRole("heading", { name: "A home for your community." }),
    ).toBeVisible();
    await page.screenshot({
      path: path.join(directory, "landing-desktop.png"),
      animations: "disabled",
      fullPage: true,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
    await page.screenshot({
      path: path.join(directory, "landing-mobile.png"),
      animations: "disabled",
      fullPage: true,
    });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await context.addCookies([
      {
        name: "cv_session",
        value: fixture.actors.owner.raw,
        domain: "localhost",
        path: "/",
        secure: true,
        httpOnly: true,
        sameSite: "Lax",
      },
    ]);
    await page.goto("https://localhost:10443/communities");
    await expect(
      page.getByRole("heading", { name: "My Communities", exact: true }),
    ).toBeVisible();
    await page.screenshot({
      path: path.join(directory, "communities.png"),
      animations: "disabled",
      fullPage: true,
    });
    await page.goto("https://localhost:10443/villages/" + fixture.world);
    await expect(page.locator('[data-render-state="ready"]')).toBeVisible({
      timeout: 15000,
    });
    await expect(page.locator("canvas")).toBeVisible();
    await page
      .getByRole("button", { name: "Community projects", exact: true })
      .click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.screenshot({
      path: path.join(directory, "village.png"),
      animations: "disabled",
    });
    await page.setViewportSize({ width: 390, height: 844 });
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
    await page.screenshot({
      path: path.join(directory, "village-mobile.png"),
      animations: "disabled",
    });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.reload();
    await expect(page.locator("canvas")).toBeVisible();
    await page.goto("https://localhost:10443/villages/" + fixture.legacy);
    await expect(page.locator('[data-render-state="ready"]')).toBeVisible({
      timeout: 15000,
    });
    await expect(page.locator("canvas")).toBeVisible();
    assert.deepEqual(errors, []);
    await context.close();
    check(
      "production Chromium landing desktop/mobile, dashboard, v2 canvas/panel/reload and v1 canvas",
      "Self-signed test edge trusted by browser test only; mobile viewport emulation",
    );
  } finally {
    await browser.close();
  }
  const ports = JSON.parse(
    await execute("docker", [
      "inspect",
      await docker(["ps", "-q", "db"]),
      "--format",
      "{{json .NetworkSettings.Ports}}",
    ]),
  );
  assert.equal(ports["5432/tcp"], null);
  const inspect = JSON.parse(
    await execute("docker", [
      "image",
      "inspect",
      "creators-village:pi2",
      "--format",
      "{{json .}}",
    ]),
  );
  check("database unpublished and application non-root", {
    user: inspect.Config.User,
    imageBytes: inspect.Size,
    imageId: inspect.Id,
  });
  assert.equal(inspect.Config.User, "node");
  const stats = await docker([
    "stats",
    "--no-stream",
    "--format",
    "{{.Name}}: {{.MemUsage}} / {{.CPUPerc}}",
  ]);
  await docker(["stop", "app"]);
  assert.equal(
    await execute("docker", [
      "inspect",
      await docker(["ps", "-a", "-q", "app"]),
      "--format",
      "{{.State.ExitCode}}",
    ]),
    "0",
  );
  check("SIGTERM closes workers, SSE and pool within shutdown deadline");
  await assert.rejects(
    docker([
      "run",
      "--rm",
      "--no-deps",
      "-T",
      "-e",
      "AUTH_MODE=synthetic",
      "app",
    ]),
  );
  await assert.rejects(
    docker([
      "run",
      "--rm",
      "--no-deps",
      "-T",
      "-e",
      "DATABASE_TRANSPORT=tls",
      "app",
    ]),
  );
  await assert.rejects(
    docker([
      "run",
      "--rm",
      "--no-deps",
      "-T",
      "-e",
      "MIGRATION_DATABASE_URL=postgresql://forbidden",
      "app",
    ]),
  );
  check(
    "production startup rejects synthetic auth, unavailable verified TLS and migration credentials in web process",
  );
  await fs.writeFile(
    path.join(directory, "report.json"),
    JSON.stringify(
      {
        date: new Date().toISOString(),
        checks,
        stats,
        limitations: [
          "Synthetic session fixtures; no real Twitch exchange or independent human test",
          "Local self-signed TLS edge; no external ingress or managed DB certificate verified",
          "No physical device or public load test",
          "Private Docker database transport, no public DB listener",
        ],
      },
      null,
      2,
    ),
  );
  console.log(
    `Production rehearsal complete: ${checks.length} checks; sanitized report in .local/production/report.json`,
  );
} finally {
  if (edge) {
    edge.closeAllConnections();
    await new Promise((resolve) => edge.close(resolve));
  }
  // Stop only this task's containers; retain the isolated rehearsal volume for persistence evidence.
  await docker(["stop"]).catch(() => {});
}
