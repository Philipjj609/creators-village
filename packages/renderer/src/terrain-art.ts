/** Typed adaptation of the approved AP4 Pixi reference. Reads authoritative facts only. */
import { Graphics, MeshSimple, Container, Matrix, type Texture } from "pixi.js";
export type Point = { x: number; y: number };
export type CellWindow = { x0: number; x1: number; y0: number; y1: number };
export type TerrainRead = {
  cell(x: number, y: number): number;
  height(x: number, y: number): number | null;
};
export type TerrainTextures = Record<string, Texture>;
export type TerrainPath = { width: number; points: Point[] };
export type Exclusion = { x: number; y: number; width: number; depth: number };
export type DecorItem = Point & { id: string };
export type DecorPlan = {
  dry: DecorItem[];
  rock: DecorItem[];
  water: DecorItem[];
  patch: DecorItem[];
  glint: (Point & { phase: number })[];
};
export function woodlandOverlay(
  read: TerrainRead,
  tex: TerrainTextures,
  win: CellWindow,
) {
  const batch = quads(tex["woodland-fringe"]!);
  const P = (x: number, y: number) => project(x, y, read.height(x, y) ?? 0);
  const wood = (x: number, y: number) => {
    const f = read.cell(x, y);
    return f !== 255 && !(f & 1) && !!(f & 10);
  };
  for (let y = win.y0; y < win.y1; y++)
    for (let x = win.x0; x < win.x1; x++) {
      const f = read.cell(x, y);
      if (f === 255 || f & 11) continue;
      for (const [dx, dy] of [
        [0, -1],
        [1, 0],
        [0, 1],
        [-1, 0],
      ] as const) {
        if (!wood(x + dx, y + dy)) continue;
        const a =
          dx === 0
            ? { x, y: y + (dy > 0 ? 1 : 0) }
            : { x: x + (dx > 0 ? 1 : 0), y };
        const b = dx === 0 ? { x: x + 1, y: a.y } : { x: a.x, y: y + 1 };
        const c = { x: b.x - dx * 0.6, y: b.y - dy * 0.6 },
          d = { x: a.x - dx * 0.6, y: a.y - dy * 0.6 };
        const u = (dx === 0 ? x : y) / 4;
        batch.add(
          [P(a.x, a.y), P(b.x, b.y), P(c.x, c.y), P(d.x, d.y)],
          [
            [u, 0],
            [u + 0.25, 0],
            [u + 0.25, 1],
            [u, 1],
          ],
        );
      }
    }
  return batch.mesh();
}
const K = 32 * Math.sqrt(1.5);
const WATER = 1,
  TREE = 2,
  ROCK = 4,
  WOOD = 8,
  MISSING = 255,
  WATER_Z = 0.5;
const project = (x: number, y: number, z: number) => ({
  x: (x - y) * 32,
  y: (x + y) * 16 - z * K,
});
export const decorHash = (x: number, y: number, salt: number) =>
  (Math.imul(x, 73856093) ^
    Math.imul(y, 19349663) ^
    Math.imul(salt, 83492791)) >>>
  0;

/** materials.mapping: one global matrix; 2x tiles cover 512x256 runtime px, 1x tiles likewise. */
export function tileFill(texture: Texture, tint: number) {
  const density = texture.width / 512;
  return {
    texture,
    textureSpace: "global" as const,
    matrix: new Matrix().scale(1 / density, 1 / density),
    color: tint,
  };
}
export function material(flags: number) {
  if (flags & WATER) return "water";
  if (flags & (WOOD | TREE)) return "woodland";
  return "grass";
}
export function shade(x: number, y: number, slope: number) {
  const variation = Math.round(
    (Math.sin(x * 0.19 + Math.sin(y * 0.13)) + Math.sin(y * 0.23)) * 1.5,
  );
  const s = Math.max(-8, Math.min(9, Math.round(slope * 9) + variation));
  const v = 236 + 2 * s;
  return (v << 16) | (v << 8) | v;
}

/** Quad batch for edge pieces: one MeshSimple per texture. */
function quads(texture: Texture) {
  const v: number[] = [],
    uv: number[] = [],
    idx: number[] = [];
  return {
    add(p: Point[], t: number[][]) {
      // p: 4 projected points, t: 4 [u,v]
      const n = v.length / 2;
      for (let i = 0; i < 4; i++) {
        v.push(p[i]!.x, p[i]!.y);
        uv.push(t[i]![0]!, t[i]![1]!);
      }
      idx.push(n, n + 1, n + 2, n, n + 2, n + 3);
    },
    mesh() {
      if (!v.length) return null;
      const mesh = new MeshSimple({
        texture,
        vertices: new Float32Array(v),
        uvs: new Float32Array(uv),
        indices: new Uint32Array(idx),
      });
      // These world-space vertices are immutable until a rebuild. MeshSimple otherwise
      // reuploads them every frame and does not own/dispose its geometry on destroy.
      mesh.autoUpdate = false;
      const geometry = mesh.geometry;
      mesh.once("destroyed", () => geometry.destroy(true));
      return mesh;
    },
    get count() {
      return v.length / 8;
    },
  };
}

function coastEdges(read: TerrainRead, x: number, y: number) {
  const c = read.cell(x, y);
  if (c === MISSING || c & WATER) return [];
  return [
    {
      n: [x, y - 1],
      corners: [
        [0, 0],
        [1, 0],
      ],
    },
    {
      n: [x + 1, y],
      corners: [
        [1, 0],
        [1, 1],
      ],
    },
    {
      n: [x, y + 1],
      corners: [
        [1, 1],
        [0, 1],
      ],
    },
    {
      n: [x - 1, y],
      corners: [
        [0, 1],
        [0, 0],
      ],
    },
  ].filter((e) => {
    const f = read.cell(e.n[0]!, e.n[1]!);
    return f !== MISSING && !!(f & WATER);
  });
}

/** edges.shore: strips from every land edge 0.5 into the water, quarter pieces at convex land corners. */
export function shoreOverlay(
  read: TerrainRead,
  tex: TerrainTextures,
  win: CellWindow,
) {
  const strip = quads(tex["shore-strip"]!),
    corner = quads(tex["shore-corner"]!);
  const isWater = (x: number, y: number) => {
    const f = read.cell(x, y);
    return f !== MISSING && !!(f & WATER);
  };
  const isLand = (x: number, y: number) => {
    const f = read.cell(x, y);
    return f !== MISSING && !(f & WATER);
  };
  const P = (x: number, y: number) => project(x, y, WATER_Z);
  for (let y = win.y0; y < win.y1; y++)
    for (let x = win.x0; x < win.x1; x++) {
      if (!isWater(x, y)) continue;
      // land on side: N (y-1), E (x+1), S (y+1), W (x-1). Edge runs along the shared side; v points into this cell.
      const D = 0.5;
      if (isLand(x, y - 1))
        strip.add(
          [P(x, y), P(x + 1, y), P(x + 1, y + D), P(x, y + D)],
          [
            [x / 2, 0],
            [(x + 1) / 2, 0],
            [(x + 1) / 2, 1],
            [x / 2, 1],
          ],
        );
      if (isLand(x, y + 1))
        strip.add(
          [P(x, y + 1), P(x + 1, y + 1), P(x + 1, y + 1 - D), P(x, y + 1 - D)],
          [
            [x / 2, 0],
            [(x + 1) / 2, 0],
            [(x + 1) / 2, 1],
            [x / 2, 1],
          ],
        );
      if (isLand(x - 1, y))
        strip.add(
          [P(x, y), P(x, y + 1), P(x + D, y + 1), P(x + D, y)],
          [
            [y / 2, 0],
            [(y + 1) / 2, 0],
            [(y + 1) / 2, 1],
            [y / 2, 1],
          ],
        );
      if (isLand(x + 1, y))
        strip.add(
          [P(x + 1, y), P(x + 1, y + 1), P(x + 1 - D, y + 1), P(x + 1 - D, y)],
          [
            [y / 2, 0],
            [(y + 1) / 2, 0],
            [(y + 1) / 2, 1],
            [y / 2, 1],
          ],
        );
      for (const [sx, sy] of [
        [-1, -1],
        [1, -1],
        [1, 1],
        [-1, 1],
      ] as const) {
        if (
          !isLand(x + sx, y + sy) ||
          !isWater(x + sx, y) ||
          !isWater(x, y + sy)
        )
          continue;
        const cx = x + (sx > 0 ? 1 : 0),
          cy = y + (sy > 0 ? 1 : 0); // the land corner
        const ux = -sx * D,
          vy = -sy * D; // into this cell
        corner.add(
          [P(cx, cy), P(cx + ux, cy), P(cx + ux, cy + vy), P(cx, cy + vy)],
          [
            [0, 0],
            [1, 0],
            [1, 1],
            [0, 1],
          ],
        );
      }
    }
  return {
    meshes: [strip.mesh(), corner.mesh()].filter(Boolean),
    strips: strip.count,
    corners: corner.count,
  };
}

/** edges.path: joints + fringes (soft, under) then global-mapped cores (opaque, over). */
export function drawPaths(
  read: TerrainRead,
  tex: TerrainTextures,
  paths: TerrainPath[],
  opts: { provisional: boolean },
) {
  const layer = new Container();
  const hz = (x: number, y: number) => read.height(x, y) ?? 1;
  const P = (x: number, y: number) => project(x, y, hz(x, y));
  if (opts.provisional) {
    const g = new Graphics();
    for (const r of paths)
      for (let i = 0; i < r.points.length - 1; i++) {
        const p = P(r.points[i]!.x, r.points[i]!.y),
          q = P(r.points[i + 1]!.x, r.points[i + 1]!.y);
        g.moveTo(p.x, p.y)
          .lineTo(q.x, q.y)
          .stroke({
            width: r.width * 24,
            color: 0xc4b28d,
            cap: "round",
            join: "round",
          });
      }
    layer.addChild(g);
    return layer;
  }
  const joint = quads(tex["path-joint"]!),
    fringe = quads(tex["path-fringe"]!),
    core = new Graphics();
  const coreFill = tileFill(tex["path-dirt"]!, 0xffffff);
  for (const r of paths) {
    const w = r.width,
      half = w / 2,
      inner = half - 0.15,
      outer = half + 0.42,
      J = 1.17 * (w / 1.5);
    for (const v of r.points)
      joint.add(
        [
          P(v.x - J, v.y - J),
          P(v.x + J, v.y - J),
          P(v.x + J, v.y + J),
          P(v.x - J, v.y + J),
        ],
        [
          [0, 0],
          [1, 0],
          [1, 1],
          [0, 1],
        ],
      );
    for (const v of r.points) {
      const c = [
        P(v.x - inner, v.y - inner),
        P(v.x + inner, v.y - inner),
        P(v.x + inner, v.y + inner),
        P(v.x - inner, v.y + inner),
      ];
      core.poly(c.flatMap((p) => [p.x, p.y])).fill(coreFill);
    }
    for (let i = 0; i < r.points.length - 1; i++) {
      const a = r.points[i]!,
        b = r.points[i + 1]!;
      if (a.x === b.x && a.y === b.y) continue;
      const L = Math.hypot(b.x - a.x, b.y - a.y),
        dx = (b.x - a.x) / L,
        dy = (b.y - a.y) / L,
        nx = -dy,
        ny = dx;
      const n = Math.max(1, Math.ceil(L));
      for (let k = 0; k < n; k++) {
        const t0 = (k / n) * L,
          t1 = ((k + 1) / n) * L;
        const at = (t: number, o: number) => ({
          x: a.x + dx * t + nx * o,
          y: a.y + dy * t + ny * o,
        });
        const q = [
          at(t0, -inner),
          at(t1, -inner),
          at(t1, inner),
          at(t0, inner),
        ];
        core
          .poly(
            q.flatMap((p) => {
              const s = P(p.x, p.y);
              return [s.x, s.y];
            }),
          )
          .fill(coreFill);
        for (const side of [-1, 1]) {
          const pts = [
            at(t0, side * inner),
            at(t1, side * inner),
            at(t1, side * outer),
            at(t0, side * outer),
          ].map((p) => P(p.x, p.y));
          fringe.add(pts, [
            [t0 / 4, 0],
            [t1 / 4, 0],
            [t1 / 4, 1],
            [t0 / 4, 1],
          ]);
        }
      }
    }
  }
  for (const m of [joint.mesh(), fringe.mesh()]) if (m) layer.addChild(m);
  layer.addChild(core);
  return layer;
}

/** placement: deterministic, eligibility from flags and exclusion rects only. */
export function placeDecor(
  read: TerrainRead,
  win: CellWindow,
  exclusions: Exclusion[],
  caps: { decor: number; patches: number; glints: number },
  visible: (x: number, y: number) => boolean = () => true,
) {
  const out: DecorPlan = { dry: [], rock: [], patch: [], water: [], glint: [] };
  const blocked = (x: number, y: number) =>
    exclusions.some(
      (r) =>
        x + 1 > r.x && x < r.x + r.width && y + 1 > r.y && y < r.y + r.depth,
    );
  const off = (h: number): [number, number] => [
    0.2 + (0.6 * ((h >>> 12) & 255)) / 255,
    0.2 + (0.6 * ((h >>> 20) & 255)) / 255,
  ];
  for (let y = win.y0; y < win.y1; y++)
    for (let x = win.x0; x < win.x1; x++) {
      const f = read.cell(x, y);
      if (f === MISSING || blocked(x, y) || !visible(x + 0.5, y + 0.5))
        continue;
      const wood = !!(f & (WOOD | TREE));
      if (f & ROCK) {
        out.rock.push({
          x: x + 0.5,
          y: y + 0.5,
          id: decorHash(x, y, 2) % 2 ? "rock-b" : "rock-a",
        });
        continue;
      }
      if (!(f & 7)) {
        const h = decorHash(x, y, 1),
          r = h % 100,
          [ox, oy] = off(h);
        let id = null;
        if (r < 7) id = ["tuft-a", "tuft-b", "tuft-c"][(h >>> 8) % 3];
        else if (r < 12)
          id = wood
            ? "flowers-violet"
            : ["flowers-daisy", "flowers-butter", "flowers-clover"][
                (h >>> 8) % 3
              ];
        else if (r < 14) id = ["pebbles-a", "pebbles-b"][(h >>> 8) % 2];
        if (id) out.dry.push({ x: x + ox, y: y + oy, id });
        const hp = decorHash(x, y, 3);
        if (hp % 997 < 12 && out.patch.length < caps.patches) {
          const k = (hp >>> 10) % 4;
          out.patch.push({
            x: x + 0.5,
            y: y + 0.5,
            id: (wood
              ? ["patch-moss", "patch-worn"][k % 2]
              : ["patch-clover", "patch-dry", "patch-moss", "patch-worn"][k])!,
          });
        }
      }
      if (f & WATER) {
        const n4 = [
          [0, -1],
          [1, 0],
          [0, 1],
          [-1, 0],
        ].map(([dx, dy]) => read.cell(x + dx!, y + dy!));
        if (n4.some((v) => v === MISSING)) continue;
        const landSide = n4.findIndex((v) => !(v & WATER));
        const h = decorHash(x, y, 4),
          r = h % 100;
        if (landSide >= 0) {
          const id =
            r < 22
              ? ["reeds-a", "reeds-b"][(h >>> 8) % 2]
              : r < 28
                ? "shore-stones"
                : null;
          const pos = [
            [0.5, 0.3],
            [0.7, 0.5],
            [0.5, 0.7],
            [0.3, 0.5],
          ][landSide]!;
          if (id) out.water.push({ x: x + pos[0]!, y: y + pos[1]!, id });
        } else {
          let open = true;
          for (let dy = -1; dy <= 1; dy++)
            for (let dx = -1; dx <= 1; dx++) {
              const v = read.cell(x + dx, y + dy);
              if (v === MISSING || !(v & WATER)) open = false;
            }
          if (!open) continue;
          const [ox, oy] = off(h);
          const id =
            r < 3
              ? ["lilypads-a", "lilypads-b"][(h >>> 8) % 2]
              : r < 4
                ? ["waterlily-a", "waterlily-b"][(h >>> 8) % 2]
                : null;
          if (id) out.water.push({ x: x + ox, y: y + oy, id });
          const hg = decorHash(x, y, 5);
          if (hg % 61 === 0 && out.glint.length < caps.glints)
            out.glint.push({ x: x + ox, y: y + oy, phase: hg % 18 });
        }
      }
    }
  const selected = [...out.rock, ...out.dry, ...out.water]
    .sort(
      (a, b) =>
        Math.hypot(a.x - (win.x0 + win.x1) / 2, a.y - (win.y0 + win.y1) / 2) -
        Math.hypot(b.x - (win.x0 + win.x1) / 2, b.y - (win.y0 + win.y1) / 2),
    )
    .slice(0, caps.decor);
  const chosen = new Set(selected);
  out.rock = out.rock.filter((v) => chosen.has(v));
  out.dry = out.dry.filter((v) => chosen.has(v));
  out.water = out.water.filter((v) => chosen.has(v));
  return out;
}
