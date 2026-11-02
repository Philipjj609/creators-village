export type QPoint = { qx: number; qy: number };
/** Multi-source bounded grid search: choose a reachable valid road approach, not nearest by distance alone. */
export function connectRoad(
  sources: QPoint[],
  end: QPoint,
  edge: (a: QPoint, b: QPoint) => boolean,
): QPoint[] | null {
  const key = (p: QPoint) => p.qx + "," + p.qy,
    goal = key(end),
    parents = new Map<string, string | null>(),
    queue: QPoint[] = [];
  for (const p of sources) {
    const k = key(p);
    if (!parents.has(k)) {
      parents.set(k, null);
      queue.push(p);
    }
  }
  for (let i = 0; i < queue.length && i < 20000; i++) {
    const p = queue[i]!,
      k = key(p);
    if (k === goal) {
      const result: QPoint[] = [];
      let cursor: string | null = k;
      while (cursor !== null) {
        const [qx, qy] = cursor.split(",").map(Number);
        result.push({ qx: qx!, qy: qy! });
        cursor = parents.get(cursor)!;
      }
      return result
        .reverse()
        .filter(
          (p, i, a) =>
            i === 0 ||
            i === a.length - 1 ||
            p.qx - a[i - 1]!.qx !== a[i + 1]!.qx - p.qx ||
            p.qy - a[i - 1]!.qy !== a[i + 1]!.qy - p.qy,
        );
    }
    for (const [dx, dy] of [
      [0, -128],
      [128, 0],
      [0, 128],
      [-128, 0],
    ]) {
      const n = { qx: p.qx + dx!, qy: p.qy + dy! },
        nk = key(n);
      if (!parents.has(nk) && edge(p, n)) {
        parents.set(nk, k);
        queue.push(n);
      }
    }
  }
  return null;
}
export function connectedMask(
  g: { grid: Uint8Array; n: number; min: number },
  start: QPoint,
) {
  const index = (p: QPoint) => {
    const x = Math.floor(p.qx / 128) - g.min,
      y = Math.floor(p.qy / 128) - g.min;
    return x < 0 || y < 0 || x >= g.n || y >= g.n ? -1 : y * g.n + x;
  };
  const seen = new Uint8Array(g.grid.length),
    queue: number[] = [],
    s = index(start);
  if (s >= 0 && g.grid[s]) {
    queue.push(s);
    seen[s] = 1;
  }
  for (let a = 0; a < queue.length; a++) {
    const i = queue[a]!,
      x = i % g.n;
    for (const j of [
      x > 0 ? i - 1 : -1,
      x < g.n - 1 ? i + 1 : -1,
      i - g.n,
      i + g.n,
    ])
      if (j >= 0 && j < seen.length && g.grid[j] && !seen[j]) {
        seen[j] = 1;
        queue.push(j);
      }
  }
  return (p: QPoint) => {
    const i = index(p);
    return i >= 0 && !!seen[i];
  };
}
export function roadPoints(
  roads: {
    width: number;
    geometry: ({ qx: number; qy: number } | { x: number; y: number })[];
  }[],
) {
  const out = new Map<string, QPoint>();
  for (const road of roads) {
    if (road.width < 384) continue;
    const ps = road.geometry.map((p) =>
      "qx" in p ? p : { qx: p.x * 256, qy: p.y * 256 },
    );
    for (let i = 1; i < ps.length; i++) {
      const a = ps[i - 1]!,
        b = ps[i]!,
        steps = Math.max(Math.abs(a.qx - b.qx), Math.abs(a.qy - b.qy)) / 128;
      if (
        !Number.isInteger(steps) ||
        steps > 512 ||
        (a.qx !== b.qx && a.qy !== b.qy)
      )
        continue;
      for (let n = 0; n <= steps; n++) {
        const p = {
          qx: a.qx + Math.sign(b.qx - a.qx) * n * 128,
          qy: a.qy + Math.sign(b.qy - a.qy) * n * 128,
        };
        out.set(p.qx + "," + p.qy, p);
      }
    }
  }
  return [...out.values()].sort((a, b) => a.qy - b.qy || a.qx - b.qx);
}
