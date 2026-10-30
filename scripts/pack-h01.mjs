import fs from "node:fs/promises";
import crypto from "node:crypto";
import sharp from "sharp";
const input = process.argv[2] ?? ".local/h01-render-01";
const output = "assets/generated/hearthside-hero-01";
const source = JSON.parse(
  await fs.readFile(`${input}/source-manifest.json`, "utf8"),
);
await fs.mkdir(output, { recursive: true });
if (await fs.stat(`${output}/manifest.json`).catch(() => null))
  throw Error("Published study exists; use a new version, not an overwrite.");
const W = source.camera.width,
  H = source.camera.height;
const hashes = [];
async function sprite(id, file, depth, kind, region) {
  let image = sharp(`${input}/${file}`);
  // Materialize patch before trim: libvips otherwise schedules trim before extract.
  if (region) image = sharp(await image.extract(region).png().toBuffer());
  const { data, info } = await image
    .trim({ threshold: 1 })
    .png()
    .toBuffer({ resolveWithObject: true });
  const original = await sharp(`${input}/${file}`).metadata();
  const ratio = original.width / W;
  const mask = await sharp(data)
    .extractChannel("alpha")
    .resize(32, 32, { fit: "fill", kernel: "nearest" })
    .raw()
    .toBuffer();
  const name = id + ".png";
  await fs.writeFile(`${output}/${name}`, data);
  const layer = {
    id,
    url: `/study-assets/hearthside-hero-01/${name}`,
    left: ((region?.left ?? 0) - (info.trimOffsetLeft ?? 0)) / ratio,
    top: ((region?.top ?? 0) - (info.trimOffsetTop ?? 0)) / ratio,
    width: info.width,
    height: info.height,
    scale: 1 / ratio,
    depth,
    kind,
    decodedBytes: info.width * info.height * 4,
    mask: Array.from({ length: 32 }, (_, j) =>
      [...mask.slice(j * 32, j * 32 + 32)]
        .map((n) => (n > 40 ? "1" : "0"))
        .join(""),
    ),
  };
  hashes.push({
    file: name,
    bytes: data.length,
    sha256: crypto.createHash("sha256").update(data).digest("hex"),
    width: info.width,
    height: info.height,
  });
  return layer;
}
const layers = [];
for (let row = 0; row < 2; row++)
  for (let col = 0; col < 2; col++)
    layers.push(
      await sprite(`ground-${row}-${col}`, "ground.png", -1000, "ground", {
        left: (col * W) / 2,
        top: (row * H) / 2,
        width: W / 2,
        height: H / 2,
      }),
    );
for (const layer of source.layers.filter((l) => l.id !== "ground"))
  layers.push(
    await sprite(
      layer.id,
      layer.id + ".png",
      layer.depth,
      source.buildings.some((b) => b.id === layer.id)
        ? "building"
        : "foreground",
    ),
  );
const buildings = [];
for (const building of source.buildings)
  buildings.push({
    ...building,
    detail: await sprite(
      building.id + "-detail",
      building.id + "-detail.png",
      building.position[0] + building.position[1],
      "building",
    ),
  });
const manifest = {
  version: source.version,
  studyOnly: true,
  width: W,
  height: H,
  layers,
  buildings,
  roads: source.roads,
  baseDecodedBytes: layers.reduce((sum, l) => sum + l.decodedBytes, 0),
  sourceHashes: {
    build: source.sourceSha256,
    kit: source.kitSha256,
    recipe: source.recipeSha256,
  },
  provenance: source.provenance,
  render: source.render,
  outputs: hashes,
};
await fs.writeFile(
  `${output}/manifest.json`,
  JSON.stringify(manifest, null, 2) + "\n",
);
await fs.copyFile(
  `${input}/source-manifest.json`,
  `${output}/source-manifest.json`,
);
await fs.copyFile(
  `${input}/hero.blend`,
  "assets/source/hearthside-hero-01/hero.blend",
);
console.log(
  JSON.stringify({
    layers: layers.length,
    baseMiB: manifest.baseDecodedBytes / 2 ** 20,
    maxFocusedMiB:
      (manifest.baseDecodedBytes +
        Math.max(...buildings.map((b) => b.detail.decodedBytes))) /
      2 ** 20,
    compressedBytes: hashes.reduce((s, h) => s + h.bytes, 0),
  }),
);
