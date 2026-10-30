// Copy the installed production dependency closure. Never resolve/download a second lockfile.
import fs from "node:fs/promises";
import path from "node:path";
const root = await fs.realpath(process.cwd());
const output = path.resolve(process.argv[2] ?? "/release");
if (output === root || output.startsWith(root + path.sep))
  throw Error("Use a separate fresh packaging directory");
await fs.mkdir(output); // Fail on reuse; never delete an arbitrary destination.
const copied = new Set();
async function visit(input) {
  const source = await fs.realpath(input),
    relative = path.relative(root, source);
  if (relative.startsWith("..") || path.isAbsolute(relative))
    throw Error("Dependency outside build tree");
  const target = path.join(output, relative);
  if (copied.has(source)) return target;
  copied.add(source);
  const pkg = JSON.parse(
    await fs.readFile(path.join(source, "package.json"), "utf8"),
  );
  const workspace =
    relative.startsWith("apps" + path.sep) ||
    relative.startsWith("packages" + path.sep);
  await fs.mkdir(path.dirname(target), { recursive: true });
  if (workspace) {
    await fs.mkdir(target, { recursive: true });
    await fs.copyFile(
      path.join(source, "package.json"),
      path.join(target, "package.json"),
    );
    await fs.cp(path.join(source, "dist"), path.join(target, "dist"), {
      recursive: true,
    });
  } else
    await fs.cp(source, target, {
      recursive: true,
      filter: (p) => path.basename(p) !== "node_modules",
    });
  for (const name of Object.keys({
    ...pkg.dependencies,
    ...pkg.optionalDependencies,
  }).sort()) {
    let directory = source,
      found;
    while (directory.startsWith(root)) {
      const candidate = path.join(directory, "node_modules", name);
      try {
        await fs.access(path.join(candidate, "package.json"));
        found = candidate;
        break;
      } catch {}
      const parent = path.dirname(directory);
      if (parent === directory) break;
      directory = parent;
    }
    if (!found) {
      if (pkg.optionalDependencies?.[name]) continue;
      throw Error(`Installed production dependency missing: ${name}`);
    }
    const dependency = await visit(found),
      link = path.join(target, "node_modules", name);
    await fs.mkdir(path.dirname(link), { recursive: true });
    await fs.symlink(path.relative(path.dirname(link), dependency), link);
  }
  return target;
}
await visit(path.join(root, "apps/server"));
for (const source of [
  "scripts/production.mjs",
  "scripts/server-runtime.mjs",
  "release-manifest.json",
  "db/migrations",
  "deploy/runtime-grants.sql",
  "docs/testing/evidence/wf2/source-calibration.json",
  "assets/source/hearthside-hero-01/hero.blend",
]) {
  const target = path.join(output, source);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.cp(path.join(root, source), target, { recursive: true });
}
const manifest = JSON.parse(await fs.readFile("release-manifest.json", "utf8"));
for (const file of Object.values(manifest.files)) {
  const target = path.join(output, file.source);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.copyFile(file.source, target);
}
console.log(
  `Packaged ${copied.size} installed production packages; no dev dependency resolver`,
);
