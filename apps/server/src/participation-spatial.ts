import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { PoolClient } from "pg";
import { decodeChunk } from "@creators-village/world/founding";
import {
  terrainReader,
  halfClaims,
  walkGrid,
  reachable,
  type Rect,
} from "@creators-village/world/spatial";
import type { FoundingWorld } from "@creators-village/contracts";
import { repositoryRoot } from "./database.js";
import { canonical, fail, verifyBaseline } from "./participation-core.js";
type Point = { qx: number; qy: number };
const intersects = (a: Rect, b: Rect) =>
  a.x < b.x + b.width &&
  a.x + a.width > b.x &&
  a.y < b.y + b.depth &&
  a.y + a.depth > b.y;
export async function spatialContext(db: PoolClient, world: string) {
  const w = (
    await db.query(
      "SELECT header,baseline_hash FROM founding_worlds WHERE id=$1",
      [world],
    )
  ).rows[0]!;
  await verifyBaseline(db, world, w);
  const header = w.header as FoundingWorld;
  if (header.id !== world || header.baseline.hash !== w.baseline_hash)
    fail("PLAN_CHANGED");
  // Bound spatial work to active territory plus seam corners, not the whole512 envelope.
  const rows = (
    await db.query(
      "SELECT x,y,bytes,hash FROM founding_chunks WHERE world_id=$1 AND x BETWEEN -2 AND 1 AND y BETWEEN -2 AND 1 ORDER BY y,x",
      [world],
    )
  ).rows;
  const chunks = rows.map((r) => decodeChunk(r.x, r.y, r.bytes, r.hash));
  const structures = (
    await db.query(
      "SELECT * FROM founding_structures WHERE world_id=$1 ORDER BY id",
      [world],
    )
  ).rows;
  const plans = (
    await db.query(
      "SELECT * FROM wf2_projects WHERE world_id=$1 AND state IN('open','ready','blocked') ORDER BY id",
      [world],
    )
  ).rows;
  return {
    header,
    chunks,
    structures,
    plans,
    baselineHash: w.baseline_hash as string,
  };
}
export const footprint = (p: { qx: number; qy: number }) => ({
  x: p.qx / 256 - 3,
  y: p.qy / 256 - 3,
  width: 6,
  depth: 6,
});
export const apron = (p: { qx: number; qy: number }) => ({
  x: p.qx / 256 - 0.75,
  y: p.qy / 256 + 3,
  width: 1.5,
  depth: 1,
});
function pathRects(points: Point[], width = 1.5): Rect[] {
  const out: Rect[] = [];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!,
      b = points[i]!;
    if (a.qx !== b.qx && a.qy !== b.qy) fail("INVALID_INPUT", 400);
    const x = Math.min(a.qx, b.qx) / 256,
      y = Math.min(a.qy, b.qy) / 256;
    out.push(
      a.qx === b.qx
        ? { x: x - width / 2, y, width, depth: Math.abs(a.qy - b.qy) / 256 }
        : {
            x,
            y: y - width / 2,
            width: Math.abs(a.qx - b.qx) / 256,
            depth: width,
          },
    );
    // Square interior join, butt end caps: avoids projecting beyond the entrance.
    if (i < points.length - 1)
      out.push({
        x: b.qx / 256 - width / 2,
        y: b.qy / 256 - width / 2,
        width,
        depth: width,
      });
  }
  return out;
}
export async function planAt(
  db: PoolClient,
  world: string,
  qx: number,
  qy: number,
  original?: Record<string, any>,
) {
  const calibration = JSON.parse(
    await fs.readFile(
      path.join(
        repositoryRoot,
        "docs/testing/evidence/wf2/source-calibration.json",
      ),
      "utf8",
    ),
  );
  const source = await fs.readFile(
    path.join(repositoryRoot, calibration.source),
  );
  if (
    !calibration.fits ||
    createHash("sha256").update(source).digest("hex") !==
      calibration.sourceSha256
  )
    throw Error("Unverified ws1 source envelope");
  const c = await spatialContext(db, world),
    h = c.header;
  const r = footprint({ qx, qy }),
    a = apron({ qx, qy });
  const read = terrainReader(h.baseline, c.chunks);
  const solids: Rect[] = c.structures.map((s) => ({
    x: s.qx / 256,
    y: s.qy / 256,
    width: s.width / 256,
    depth: s.depth / 256,
  }));
  const reservations = c.plans
    .filter((p) => p.id !== original?.id)
    .map(footprint);
  const occupied = [...solids, ...reservations];
  function support(rect: Rect, flat = false) {
    let elevation: number | undefined;
    for (let y = Math.floor(rect.y * 2) / 2; y < rect.y + rect.depth; y += 0.5)
      for (
        let x = Math.floor(rect.x * 2) / 2;
        x < rect.x + rect.width;
        x += 0.5
      ) {
        const x0 = Math.max(x, rect.x),
          y0 = Math.max(y, rect.y),
          x1 = Math.min(x + 0.5, rect.x + rect.width),
          y1 = Math.min(y + 0.5, rect.y + rect.depth);
        if (x1 <= x0 || y1 <= y0) continue;
        if (read.cell((x0 + x1) / 2, (y0 + y1) / 2) & 7) return false;
        for (const [xx, yy] of [
          [x0, y0],
          [x1, y0],
          [x0, y1],
          [x1, y1],
        ]) {
          if (
            (xx! - h.active.centerX) ** 2 + (yy! - h.active.centerY) ** 2 >=
            h.active.radius ** 2
          )
            return false;
          const z = read.height(xx!, yy!);
          if (z === null || !Number.isFinite(z)) return false;
          if (flat) {
            if (!Number.isInteger(z * 16)) return false;
            if (elevation === undefined) elevation = z * 16;
            else if (elevation !== z * 16) return false;
          }
        }
        const corners = read.corners(Math.floor(x0), Math.floor(y0));
        if (!corners || Math.max(...corners) - Math.min(...corners) > 4)
          return false;
      }
    return true;
  }
  const founderPath = pathRects(
    h.path.points.map((p) => ({ qx: p.x * 256, qy: p.y * 256 })),
    h.path.width,
  );
  const protectedAreas = [
    ...founderPath,
    ...c.structures.map((s) => ({
      x: s.entrance_qx / 256 - 0.75,
      y: s.entrance_qy / 256 - 0.5,
      width: 1.5,
      depth: 1,
    })),
    ...c.plans
      .filter((p) => p.id !== original?.id)
      .flatMap((p) => [apron(p), ...pathRects(p.path_points)]),
  ];
  if (
    !support(r, true) ||
    !support(a) ||
    occupied.some((o) => intersects(o, r) || intersects(o, a)) ||
    protectedAreas.some((o) => intersects(o, r))
  )
    fail("INVALID_INPUT", 400);
  const baseHeight = Math.round(read.height(qx / 256, qy / 256)! * 16);
  const end = { qx, qy: qy + 896 },
    start = { qx: 0, qy: 2304 };
  const clear = (rect: Rect) =>
    support(rect) && ![...occupied, r].some((o) => intersects(o, rect));
  const edge = (p: Point, n: Point) => {
    // Only the straight south approach terminates at the protected entrance.
    if (
      n.qx === end.qx &&
      n.qy === end.qy &&
      !(p.qx === end.qx && p.qy > end.qy)
    )
      return false;
    const rects = pathRects([p, n]);
    return (
      rects.every(clear) &&
      ((n.qx === end.qx && n.qy === end.qy) ||
        clear({
          x: n.qx / 256 - 0.75,
          y: n.qy / 256 - 0.75,
          width: 1.5,
          depth: 1.5,
        }))
    );
  };
  let points: Point[];
  if (original) {
    points = original.path_points;
    if (
      original.qx !== qx ||
      original.qy !== qy ||
      original.base_height !== baseHeight ||
      !points.length ||
      points[0]!.qx !== 0 ||
      points[0]!.qy !== 2304 ||
      points.at(-1)!.qx !== end.qx ||
      points.at(-1)!.qy !== end.qy ||
      !pathRects(points).every(clear)
    )
      fail("PLAN_CHANGED");
  } else {
    // Small bounded deterministic A*: f, h, insertion index; N,E,S,W expansion.
    const key = (p: Point) => p.qx + "," + p.qy,
      goal = key(end);
    const open = [
        {
          ...start,
          g: 0,
          h: Math.abs(start.qx - end.qx) + Math.abs(start.qy - end.qy),
          i: 0,
        },
      ],
      cost = new Map([[key(start), 0]]),
      parents = new Map<string, string>();
    let serial = 1,
      found = false;
    while (open.length) {
      open.sort(
        (a, b) => a.g * 128 + a.h - (b.g * 128 + b.h) || a.h - b.h || a.i - b.i,
      );
      const p = open.shift()!,
        pk = key(p);
      if (cost.get(pk) !== p.g) continue;
      if (pk === goal) {
        found = true;
        break;
      }
      for (const [dx, dy] of [
        [0, -128],
        [128, 0],
        [0, 128],
        [-128, 0],
      ]) {
        const n = { qx: p.qx + dx!, qy: p.qy + dy! },
          nk = key(n),
          g = p.g + 1;
        if (g > 256 || (cost.get(nk) ?? Infinity) <= g || !edge(p, n)) continue;
        cost.set(nk, g);
        parents.set(nk, pk);
        open.push({
          ...n,
          g,
          h: Math.abs(n.qx - end.qx) + Math.abs(n.qy - end.qy),
          i: serial++,
        });
      }
    }
    if (!found) fail("INVALID_INPUT", 400);
    const reversed: Point[] = [];
    let k = goal;
    while (true) {
      const [x, y] = k.split(",").map(Number);
      reversed.push({ qx: x!, qy: y! });
      if (k === key(start)) break;
      k = parents.get(k)!;
    }
    points = reversed.reverse();
    points = points.filter(
      (p, i, all) =>
        i === 0 ||
        i === all.length - 1 ||
        p.qx - all[i - 1]!.qx !== all[i + 1]!.qx - p.qx ||
        p.qy - all[i - 1]!.qy !== all[i + 1]!.qy - p.qy,
    );
    if (points.length > 256 || !pathRects(points).every(clear))
      fail("INVALID_INPUT", 400);
  }
  const grid = walkGrid(h.baseline, c.chunks, h.active, [...occupied, r]);
  const goals = c.structures.map((s) => ({
    x: s.entrance_qx / 256,
    y: s.entrance_qy / 256,
  }));
  goals.push(
    { x: end.qx / 256, y: end.qy / 256 },
    { x: -25, y: 0 },
    { x: 0, y: -25 },
  );
  if (!reachable(grid, { x: 0, y: 9 }, goals)) fail("INVALID_INPUT", 400);
  const manifest = await fs.readFile(
    path.join(
      repositoryRoot,
      "assets/generated/hearthside-hero-01/manifest.json",
    ),
  );
  const assetHash = createHash("sha256").update(manifest).digest("hex");
  if (assetHash !== calibration.assetManifestSha256)
    throw Error("Unreviewed asset manifest");
  const descriptor = {
    geometry_schema: "wf2-plan-1",
    world_id: world,
    baseline_hash: c.baselineHash,
    ruleset_id: "cp1-wf2-test-1",
    goal: 2,
    minimum_non_creator: 1,
    template_id: "wf2-workshop-1",
    orientation: 0,
    qx,
    qy,
    base_height: baseHeight,
    width_q: 1536,
    depth_q: 1536,
    entrance_qx: qx,
    entrance_qy: end.qy,
    path_width_q: 384,
    path_points: points,
    appearance: "hearthside-hero-01/workshop",
    asset_manifest_hash: assetHash,
  };
  const planHash = createHash("sha256")
    .update(canonical(descriptor))
    .digest("hex");
  if (original && original.plan_hash !== planHash) fail("PLAN_CHANGED");
  return { ...descriptor, plan_hash: planHash, claims: halfClaims(r), rect: r };
}
export async function lockTopology(db: PoolClient, world: string) {
  await db.query(
    "SELECT world_id FROM wf2_topology_guards WHERE world_id=$1 FOR UPDATE",
    [world],
  );
  await db.query(
    "SELECT x,y FROM founding_chunks WHERE world_id=$1 AND x BETWEEN -2 AND 1 AND y BETWEEN -2 AND 1 ORDER BY y,x FOR UPDATE",
    [world],
  );
}
