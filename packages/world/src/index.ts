import {
  ASSET_VERSION,
  GENERATOR_VERSION,
  type Building,
  type WorldSnapshot,
} from "@creators-village/contracts";
import { project, quantize, seededRandom } from "@creators-village/domain";
export {
  project,
  unproject,
  chunkOf,
  quantize,
  UNITS_PER_TILE,
} from "@creators-village/domain";

export function generateWorld(
  seed: string,
  identity: {
    id: string;
    name: string;
    createdAt: string;
    source: "creator" | "showcase";
  },
): WorldSnapshot {
  const geography = seededRandom(seed + ":geography");
  const layout = geography() > 0.5 ? 1 : -1;
  const pond = {
    x: layout > 0 ? -490 : 510,
    y: 90 + geography() * 110,
    rx: 142 + geography() * 40,
    ry: 66 + geography() * 20,
  };
  const parcels = [
    [-7, -3],
    [-3, -7],
    [3, -6],
    [7, -2],
    [7, 3],
    [3, 7],
    [-3, 7],
    [-7, 3],
    [-9, -7],
    [-5, -10],
    [1, -10],
    [8, -7],
    [11, 0],
    [9, 8],
    [0, 11],
    [-8, 9],
  ];
  const names = [
    "Fern Cottage",
    "The Copper Kettle",
    "Moss & Morning",
    "Bramble House",
    "The Little Lantern",
    "Honeycomb House",
    "Wren House",
    "Clover Cottage",
    "The Storykeeper",
    "Rosemary House",
    "Acorn Studio",
    "Foxglove House",
    "Willow Nook",
    "The Quiet Corner",
    "The Green Door",
    "Wildflower House",
  ];
  const shapes = ["cottage", "gable", "tower"] as const;
  const buildings: Building[] = parcels.map((p, i) => {
    const r = seededRandom(seed + ":house:" + i);
    const x = p[0]! * layout + Math.round(r() * 2 - 1) * 0.5,
      y = p[1]! + Math.round(r() * 2 - 1) * 0.5;
    return {
      id: `house-${i}`,
      name: names[i]!,
      kind: "home",
      position: { x: quantize(x), y: quantize(y), elevation: 0 },
      footprint: { width: 512, depth: 512 },
      recipe: {
        shape: shapes[i % 3]!,
        palette: Math.floor(r() * 3),
        version: ASSET_VERSION,
      },
    };
  });
  buildings.push({
    id: "community-hall",
    name: "The Gathering Hall",
    kind: "hall",
    position: { x: 0, y: 0, elevation: 0 },
    footprint: { width: 768, depth: 768 },
    recipe: { shape: "hall", palette: 1, version: ASSET_VERSION },
  });
  buildings.push({
    id: "hill-windmill",
    name: "Wishing Windmill",
    kind: "windmill",
    position: { x: quantize(-11 * layout), y: quantize(-1), elevation: 1 },
    footprint: { width: 512, depth: 512 },
    recipe: { shape: "mill", palette: 0, version: ASSET_VERSION },
  });
  const trees: WorldSnapshot["terrain"]["trees"] = [];
  for (let i = 0; i < 150; i++) {
    const r = seededRandom(seed + ":tree:" + i),
      tx = r() * 36 - 18,
      ty = r() * 36 - 18,
      p = project(tx, ty);
    if (
      buildings.some(
        (b) =>
          Math.hypot(tx - b.position.x / 256, ty - b.position.y / 256) < 2.6,
      ) ||
      Math.hypot(p.x - pond.x, (p.y - pond.y) * 1.8) < pond.rx + 55 ||
      Math.abs(p.y) < 38 ||
      Math.abs(p.x) < 46
    )
      continue;
    trees.push({
      x: p.x,
      y: p.y,
      size: 0.65 + r() * 0.6,
      variant: Math.floor(r() * 3),
    });
  }
  const paths = [
    [
      { x: -800, y: 0 },
      { x: 0, y: 0 },
      { x: 800, y: 0 },
    ],
    [
      { x: 0, y: -400 },
      { x: 0, y: 0 },
      { x: 0, y: 460 },
    ],
  ];
  for (const b of buildings) {
    const p = project(b.position.x / 256, b.position.y / 256);
    paths.push([
      { x: p.x, y: p.y + 10 },
      { x: p.x * 0.58, y: p.y * 0.58 },
      { x: 0, y: 0 },
    ]);
  }
  return {
    schemaVersion: 1,
    ...identity,
    seed,
    generatorVersion: GENERATOR_VERSION,
    assetVersion: ASSET_VERSION,
    revision: 1,
    terrain: { biome: "woodland", pond, trees, paths },
    buildings,
  };
}
export function readCompatibleWorld(value: unknown): WorldSnapshot {
  const w = value as WorldSnapshot;
  if (
    w?.schemaVersion !== 1 ||
    w.generatorVersion !== GENERATOR_VERSION ||
    w.assetVersion !== ASSET_VERSION
  )
    throw new Error("Unsupported world version; explicit migration required");
  return w;
}
