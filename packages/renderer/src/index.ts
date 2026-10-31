import { Container, Graphics, Sprite, Text } from "pixi.js";
import type { WorldSnapshot } from "@creators-village/contracts";
import { project } from "@creators-village/world";
import { createSurface, loadTextures } from "./surface.js";
import { attachCamera } from "./camera.js";

export type VillageView = {
  destroy(): void;
  reset(): void;
  zoom(factor: number): void;
  select(id: string): void;
  focus(id: string): void;
  stats(): { frameMs: number; frames: number; renderer: string };
};
export async function mountVillage(
  host: HTMLElement,
  snapshot: WorldSnapshot,
  selected: (id: string) => void,
): Promise<VillageView> {
  const { app, software } = await createSurface(host);
  const scene = new Container();
  app.stage.addChild(scene);
  const ground = new Graphics();
  scene.addChild(ground);
  ground.ellipse(0, 70, 1080, 510).fill({ color: 0x3d5e42, alpha: 0.09 });
  ground.ellipse(0, 38, 1030, 485).fill(0x8ca974);
  ground.ellipse(0, 5, 1020, 470).fill(0xa6b983);
  ground.ellipse(-50, -35, 900, 380).fill({ color: 0xb3c18c, alpha: 0.65 });
  // Decorative, deterministic marks; never simulation/resource state.
  for (let i = 0; i < 170; i++) {
    const x = Math.sin(i * 98.23) * 960,
      y = Math.cos(i * 41.37) * 425;
    if ((x * x) / (990 * 990) + (y * y) / (450 * 450) > 1) continue;
    ground
      .ellipse(x, y, 10 + (i % 13), 4 + (i % 4))
      .fill({ color: i % 2 ? 0xc2cd95 : 0x7f9f6e, alpha: 0.25 });
  }
  const paths = new Graphics();
  scene.addChild(paths);
  for (const path of snapshot.terrain.paths) {
    if (!path[0]) continue;
    paths.moveTo(path[0].x, path[0].y);
    for (const point of path.slice(1)) paths.lineTo(point.x, point.y);
    paths.stroke({
      color: 0x8f9e6b,
      width: 29,
      alpha: 0.38,
      cap: "round",
      join: "round",
    });
    paths.moveTo(path[0].x, path[0].y);
    for (const p of path.slice(1)) paths.lineTo(p.x, p.y);
    paths.stroke({ color: 0xded2ac, width: 21, cap: "round", join: "round" });
  }
  paths
    .ellipse(0, 28, 132, 61)
    .fill(0xded2ac)
    .ellipse(0, 28, 100, 44)
    .stroke({ color: 0xc2b68f, width: 2 });
  const p = snapshot.terrain.pond,
    water = new Graphics();
  scene.addChild(water);
  water
    .ellipse(p.x, p.y + 9, p.rx + 13, p.ry + 11)
    .fill(0x769367)
    .ellipse(p.x, p.y, p.rx, p.ry)
    .fill(0x77aaa0)
    .ellipse(p.x - 9, p.y - 9, p.rx - 17, p.ry - 11)
    .fill(0x91b9a9);
  for (let i = 0; i < 8; i++) {
    water
      .ellipse(
        p.x + Math.sin(i * 1.7) * p.rx * 0.65,
        p.y + Math.cos(i * 2) * p.ry * 0.6,
        12 + (i % 3) * 6,
        2,
      )
      .fill({ color: 0xc5ddd0, alpha: 0.6 });
  }
  const base = "/assets/woodland-vector-1/";
  const urls = [
    ...new Set(
      snapshot.buildings.map(
        (b) => `${base}${b.recipe.shape}-${b.recipe.palette}-iso.png`,
      ),
    ),
    ...Array.from({ length: 3 }, (_, i) => `${base}tree-${i}.png`),
  ];
  const textures = await loadTextures(urls);
  const renderables: { node: Sprite; y: number; id: string }[] = [];
  for (const b of snapshot.buildings) {
    const pos = project(
      b.position.x / 256,
      b.position.y / 256,
      b.position.elevation,
    );
    const url = `${base}${b.recipe.shape}-${b.recipe.palette}-iso.png`;
    const node = new Sprite(textures[url]);
    node.anchor.set(0.5, 226 / 256);
    node.position.set(pos.x, pos.y);
    node.scale.set(b.kind === "hall" ? 0.97 : 0.8);
    renderables.push({ node, y: pos.y, id: b.id });
  }
  for (let i = 0; i < snapshot.terrain.trees.length; i++) {
    const t = snapshot.terrain.trees[i]!;
    const node = new Sprite(textures[`${base}tree-${t.variant}.png`]);
    node.anchor.set(0.5, 230 / 256);
    node.position.set(t.x, t.y);
    node.scale.set(t.size * 0.68);
    renderables.push({ node, y: t.y, id: `tree-${i}` });
  }
  // One depth order across chunks; supported S1 forms have no interpenetrating footprints.
  renderables.sort((a, b) => a.y - b.y || a.id.localeCompare(b.id));
  for (const r of renderables) scene.addChild(r.node);
  const selection = new Graphics();
  scene.addChild(selection);
  const placeName = new Text({
    text: snapshot.name,
    style: {
      fontFamily: "Georgia",
      fontSize: 18,
      fill: 0x51674d,
      letterSpacing: 2,
    },
  });
  placeName.anchor.set(0.5);
  placeName.position.set(0, 435);
  scene.addChild(placeName);
  const select = (id: string) => {
    const b = snapshot.buildings.find((b) => b.id === id);
    if (!b) return;
    const p = project(
      b.position.x / 256,
      b.position.y / 256,
      b.position.elevation,
    );
    selection
      .clear()
      .ellipse(p.x, p.y + 3, 64, 29)
      .stroke({ color: 0xf7e0a3, width: 3, alpha: 0.95 });
    selected(id);
    camera.invalidate();
  };
  const camera = attachCamera(app, scene, host, {
    bounds: { x: -1000, y: -550, width: 2000, height: 1100 },
    fitWidth: 1750,
    fitHeight: 1020,
    center: { x: 0, y: 0 },
    onTap(p) {
      for (const r of [...renderables].reverse()) {
        if (r.id.startsWith("tree")) continue;
        const box = r.node.getBounds();
        if (
          p.x >= box.x + 20 &&
          p.x <= box.x + box.width - 20 &&
          p.y >= box.y + 15 &&
          p.y <= box.y + box.height - 6
        ) {
          select(r.id);
          break;
        }
      }
    },
  });
  return {
    reset: camera.reset,
    zoom: camera.zoom,
    select,
    focus(id: string) {
      const b = snapshot.buildings.find((b) => b.id === id);
      if (!b) return;
      const p = project(
        b.position.x / 256,
        b.position.y / 256,
        b.position.elevation,
      );
      camera.focus({ x: p.x, y: p.y - 50 }, 2.1);
    },
    stats: () => ({
      ...camera.stats(),
      renderer: software ? "WebGL2 software, resolution 0.75" : "WebGL2",
    }),
    destroy() {
      camera.destroy();
      app.destroy(true, {
        children: true,
        texture: false,
        textureSource: false,
      });
    },
  };
}

export { mountFounding } from "./founding.js";
export type { LivingViewState } from "./living.js";
