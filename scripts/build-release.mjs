// Release packaging only: consume immutable existing assets, never regenerate them on another platform.
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
const root = process.cwd(),
  files = {};
const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".png": "image/png",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};
async function add(source, url, immutable) {
  const type = types[path.extname(source)];
  if (!type) return;
  const bytes = await fs.readFile(path.join(root, source));
  files[url] = {
    source: source.replaceAll("\\", "/"),
    sha256: createHash("sha256").update(bytes).digest("hex"),
    type,
    immutable,
  };
}
async function walk(dir) {
  for (const item of await fs.readdir(dir, { withFileTypes: true })) {
    const name = path.join(dir, item.name);
    if (item.isDirectory()) await walk(name);
    else
      await add(
        name,
        "/" + path.relative("apps/web/dist", name).replaceAll("\\", "/"),
        name.replaceAll("\\", "/").startsWith("apps/web/dist/assets/"),
      );
  }
}
await walk("apps/web/dist");
for (const family of ["woodland-vector-1", "hearthside-hero-01"]) {
  const dir = `assets/generated/${family}`;
  // Reviewed runtime formats only. Authoring/provenance files never become public by directory traversal.
  for (const name of await fs.readdir(dir))
    if (name.endsWith(".png") || name === "manifest.json")
      await add(`${dir}/${name}`, `/assets/${family}/${name}`, true);
}
// UI-5 uses an explicit hash-pinned list: no source manifests or arbitrary files exposed.
const artCatalogPath = "assets/generated/cv-ap4-01/catalog.json";
const artCatalog = JSON.parse(await fs.readFile(artCatalogPath, "utf8"));
for (const file of artCatalog.files) {
  if (
    !/^assets\/generated\/cv-artlab-[a-z0-9-]+\/[a-z0-9-]+\.(png|json)$/.test(
      file.source,
    ) ||
    file.url !== "/assets/" + file.source.slice("assets/generated/".length)
  )
    throw Error("Invalid art allowlist path");
  const bytes = await fs.readFile(file.source);
  if (createHash("sha256").update(bytes).digest("hex") !== file.sha256)
    throw Error("Art release hash mismatch: " + file.source);
  await add(file.source, file.url, true);
}
await add(artCatalogPath, "/assets/cv-ap4-01/catalog.json", true);
await fs.writeFile(
  "release-manifest.json",
  JSON.stringify({ format: 1, files }, null, 2) + "\n",
);
console.log(`Release allowlist: ${Object.keys(files).length} files`);
