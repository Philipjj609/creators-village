import { Graphics } from "pixi.js";
import { constructionView } from "@creators-village/contracts";
import { terrainProject } from "./founding-projection.js";

/** Original provisional timber/stone geometry. No timer advances saved work. */
export function drawConstructionSite(
  view: ReturnType<typeof constructionView>,
) {
  const g = new Graphics();
  const point = (x: number, y: number, lift = 0) =>
    terrainProject(
      view.center.qx / 256 + x,
      view.center.qy / 256 + y,
      view.height / 16 + lift,
    );
  const w = view.footprint.widthQ / 512,
    d = view.footprint.depthQ / 512;
  const corners = [
    [-w, -d],
    [w, -d],
    [w, d],
    [-w, d],
  ] as const;
  g.poly(
    corners.flatMap(([x, y]) => {
      const p = point(x, y);
      return [p.x, p.y];
    }),
  )
    .fill({ color: 0xb4a38a, alpha: 0.85 })
    .stroke({ color: 0x695a44, width: 2 });
  const line = (
    a: ReturnType<typeof point>,
    b: ReturnType<typeof point>,
    color: number,
    width: number,
  ) =>
    g.moveTo(a.x, a.y).lineTo(b.x, b.y).stroke({ color, width, cap: "round" });
  // Low foundation courses remain within the identical permanent footprint.
  for (const [x, y] of corners) {
    const p = point(x, y),
      top = point(x, y, view.phase === "building" ? 1.8 : 0.35);
    line(p, top, view.phase === "building" ? 0x796044 : 0x8c8574, 6);
  }
  for (let i = 0; i < corners.length; i++) {
    const [x, y] = corners[i]!,
      [xx, yy] = corners[(i + 1) % 4]!;
    line(point(x, y, 0.2), point(xx, yy, 0.2), 0xc5baa0, 5);
    if (view.phase === "building") {
      line(point(x, y, 1.5), point(xx, yy, 1.5), 0x9b7a4d, 4);
      if (i % 2 === 0) line(point(x, y, 0.3), point(xx, yy, 1.5), 0x9b7a4d, 3);
    }
  }
  // Stored work count controls stacked materials; zero work has no timber stack.
  if (view.accepted > 0)
    for (let i = 0; i < Math.min(3, view.accepted + 1); i++)
      line(
        point(-w + 0.8, -d + 1 + i * 0.35, 0.15),
        point(w - 0.8, -d + 1 + i * 0.35, 0.15),
        0xb18c58,
        5,
      );
  g.label = "project:" + view.projectId;
  return g;
}
