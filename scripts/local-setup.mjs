import fs from "node:fs";
import crypto from "node:crypto";
fs.mkdirSync(".local", { recursive: true });
if (
  !fs.existsSync(".local/database.env") &&
  !fs.existsSync(".local/runtime.env")
) {
  const password = crypto.randomBytes(32).toString("hex");
  fs.writeFileSync(
    ".local/database.env",
    "POSTGRES_USER=cvillage\nPOSTGRES_DB=creators_village\nPOSTGRES_PASSWORD=" +
      password +
      "\n",
    { flag: "wx" },
  );
  fs.writeFileSync(
    ".local/runtime.env",
    "DATABASE_URL=postgres://cvillage:" +
      password +
      "@127.0.0.1:55432/creators_village\nTOKEN_ENCRYPTION_KEY=" +
      crypto.randomBytes(32).toString("hex") +
      "\n",
    { flag: "wx" },
  );
  console.log(
    "Created ignored local database and encryption configuration; no secret values logged.",
  );
} else if (
  !fs.existsSync(".local/database.env") ||
  !fs.existsSync(".local/runtime.env")
) {
  throw new Error(
    "Partial local configuration: repair explicitly without overwriting credentials.",
  );
} else console.log("Reusing existing local configuration without changes.");
