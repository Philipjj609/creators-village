// Pipe to `docker run --rm -i --network none IMAGE node --input-type=module`.
// Hash file contents and symlink targets, deliberately excluding filesystem timestamps/OCI attestations.
import fs from "node:fs/promises";
import { createHash } from "node:crypto";
const entries = [];
async function walk(dir) {
  for (const item of await fs.readdir(dir, { withFileTypes: true })) {
    const file = dir + "/" + item.name;
    if (item.isSymbolicLink())
      entries.push([file.slice(5), "link:" + (await fs.readlink(file))]);
    else if (item.isDirectory()) await walk(file);
    else
      entries.push([
        file.slice(5),
        createHash("sha256")
          .update(await fs.readFile(file))
          .digest("hex"),
      ]);
  }
}
await walk("/app");
entries.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
const forbidden = entries.some(
  ([file]) =>
    /^(?:\.env[^/]*|\.local|local|tests|scripts\/wf2-test-server\.mjs)(\/|$)/.test(
      file,
    ) || /node_modules\/(?:@playwright|playwright|vitest)(\/|$)/.test(file),
);
if (forbidden) throw Error("Unexpected development/private file in runtime");
console.log(
  JSON.stringify({
    filesAndLinks: entries.length,
    sha256: createHash("sha256").update(JSON.stringify(entries)).digest("hex"),
    privateOrTestFiles: forbidden,
    node: process.version,
  }),
);
