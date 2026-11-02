import { Container, Graphics, Sprite } from "pixi.js";
import type { ArtLibrary } from "./art.js";
import { ART, ASSET_SCALE } from "./art.js";
import { terrainProject } from "./founding-projection.js";
export type PlacementPreview = {
  qx: number;
  qy: number;
  status: "checking" | "valid" | "invalid";
  baseHeight?: number;
  path?: { points: { qx: number; qy: number }[]; widthQ: number };
  extension?: { points: { qx: number; qy: number }[]; widthQ: number };
} | null;
/** Cosmetic preview only; no local approval, claims, identity or project progress. */
export function createPlacementPreview(
  art: ArtLibrary,
  objects: Container,
  floor: Graphics,
  heightAt: (x: number, y: number) => number | null,
  invalidate: () => void,
) {
  const node = new Container();
  node.label = "placement-preview";
  objects.addChild(node);
  let current: PlacementPreview = null,
    body: Sprite | null = null,
    loading = false,
    disposed = false;
  function draw() {
    floor.clear();
    node.visible = !!current;
    if (!current) {
      invalidate();
      return;
    }
    const x = current.qx / 256,
      y = current.qy / 256,
      z =
        current.baseHeight === undefined
          ? (heightAt(x, y) ?? 0)
          : current.baseHeight / 16;
    const color =
      current.status === "valid"
        ? 0x477c59
        : current.status === "invalid"
          ? 0xb45242
          : 0xb69952;
    const corners = [
      [-3, -3],
      [3, -3],
      [3, 3],
      [-3, 3],
    ].map(([dx, dy]) => terrainProject(x + dx!, y + dy!, z));
    floor
      .poly(corners.flatMap((p) => [p.x, p.y]))
      .fill({ color, alpha: 0.22 })
      .stroke({ color, width: 2 });
    for (let d = -3; d <= 3; d += 0.5) {
      for (const points of [
        [
          [x + d, y - 3],
          [x + d, y + 3],
        ],
        [
          [x - 3, y + d],
          [x + 3, y + d],
        ],
      ]) {
        const a = terrainProject(points[0]![0]!, points[0]![1]!, z),
          b = terrainProject(points[1]![0]!, points[1]![1]!, z);
        floor
          .moveTo(a.x, a.y)
          .lineTo(b.x, b.y)
          .stroke({ color, width: 0.6, alpha: 0.45 });
      }
    }
    for (const path of [current.path, current.extension])
      if (path)
        for (let i = 1; i < path.points.length; i++) {
          const a = path.points[i - 1]!,
            b = path.points[i]!,
            w = path.widthQ / 512,
            ax = a.qx / 256,
            ay = a.qy / 256,
            bx = b.qx / 256,
            by = b.qy / 256;
          const vertices =
            ax === bx
              ? [
                  [ax - w, ay],
                  [ax + w, ay],
                  [bx + w, by],
                  [bx - w, by],
                ]
              : [
                  [ax, ay - w],
                  [ax, ay + w],
                  [bx, by + w],
                  [bx, by - w],
                ];
          floor
            .poly(
              vertices.flatMap(([xx, yy]) => {
                const p = terrainProject(xx!, yy!, heightAt(xx!, yy!) ?? z);
                return [p.x, p.y];
              }),
            )
            .fill({ color, alpha: 0.28 });
        }
    const p = terrainProject(x, y, z);
    node.position.set(p.x, p.y);
    node.zIndex = x + y;
    if (body) body.alpha = current.status === "invalid" ? 0.16 : 0.32;
    invalidate();
  }
  return {
    node,
    set(value: PlacementPreview) {
      current = value;
      draw();
      if (value && !body && !loading) {
        loading = true;
        const model = art.bundle(ART.workshop).buildings![0]!,
          layer = art
            .bundle(ART.workshop)
            .layers!.find((l) => l.url === "workshop.png")!;
        void art
          .texture(ART.workshop, layer.url)
          .then((texture) => {
            if (disposed) return;
            body = new Sprite(texture);
            body.position.set(
              (layer.left - model.screenAnchor[0]!) * ASSET_SCALE,
              (layer.top - model.screenAnchor[1]!) * ASSET_SCALE,
            );
            body.scale.set(layer.scale * ASSET_SCALE);
            node.addChild(body);
            draw();
          })
          .catch(() => {
            /* Ground grid remains an honest usable preview if optional body loading fails. */
          })
          .finally(() => {
            loading = false;
          });
      }
    },
    destroy() {
      disposed = true;
      node.destroy({ children: true });
      floor.clear();
    },
  };
}
