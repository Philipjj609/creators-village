import { loadConfig } from "./config.js";
import { createPool, migrate } from "./database.js";
import { buildApp } from "./app.js";
import { twitchGateway } from "./twitch.js";
import { revalidateSessions } from "./session-startup.js";
if (process.env.NODE_ENV === "production")
  throw Error(
    "Use scripts/production.mjs; the local launcher must not migrate production",
  );
const config = loadConfig(),
  pool = createPool(config.databaseUrl);
await migrate(pool);
await revalidateSessions(pool, twitchGateway(config), config.encryptionKey);
const app = await buildApp(config, pool, twitchGateway(config));
await app.listen({ host: "127.0.0.1", port: 3000 });
console.log("Creator’s Village API listening at http://localhost:3000");
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.once(signal, () => {
    void app
      .close()
      .then(() => pool.end())
      .then(() => process.exit(0));
  });
