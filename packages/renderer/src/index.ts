import { registerPick, pickVisible } from "./picking.js";
import {
  ART,
  createArtLibrary,
  artSprite,
  setArtFrame,
  visualFit,
} from "./art.js";
import { readAtmosphere } from "./ambient.js";
import type { WorldSelection } from "./selection.js";
export type { WorldSelection } from "./selection.js";
import { Container, Graphics, Sprite, Text } from "pixi.js";
import type { WorldSnapshot } from "@creators-village/contracts";
import { project } from "@creators-village/world";
import { createSurface } from "./surface.js";
import { attachCamera } from "./camera.js";

export type VillageView = {
  destroy(): void;
  reset(): void;
  zoom(factor: number): void;
  select(id: string): void;
  setSelection(ref: WorldSelection | null): void;
  focusSelection(ref: WorldSelection, mode?: "frame" | "nudge"): void;
  focusPond?(): void;
  focus(id: string): void;
  stats(): { frameMs: number; frames: number; renderer: string };
};
export async function mountVillage(
  host: HTMLElement,
  snapshot: WorldSnapshot,
  selected: (id: string) => void,
  viewport?: () => { x: number; y: number; width: number; height: number },
): Promise<VillageView> {
  const { app, software, renderStats } = await createSurface(host);
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
  const art = await createArtLibrary();
  const [homes, civic, trees, mill] = await Promise.all([
    art.sheet(ART.structures),
    art.sheet(ART.civic),
    art.sheet(ART.trees),
    art.sheet(ART.windmill),
  ]);
  const shadows = new Container();
  scene.addChild(shadows);
  const renderables: { node: Container; y: number; id: string }[] = [];
  const rotors: { node: Sprite; shadow: Sprite }[] = [];
  const bindings: { id: string; art: string; fit: number }[] = [];
  for (const b of snapshot.buildings) {
    const pos = project(
      b.position.x / 256,
      b.position.y / 256,
      b.position.elevation,
    );
    const id =
      b.kind === "hall"
        ? "hall"
        : b.kind === "windmill"
          ? "windmill"
          : "cottage";
    const bundle =
      id === "hall"
        ? ART.civic
        : id === "windmill"
          ? ART.windmill
          : ART.structures;
    const sheet = id === "hall" ? civic : id === "windmill" ? mill : homes;
    const model = art.bundle(bundle).assets!.find((a) => a.id === id)!;
    const fit = visualFit(
      b.footprint.width / 256,
      b.footprint.depth / 256,
      model.footprint!.envelope.width,
      model.footprint!.envelope.depth,
    );
    const node = new Container();
    node.position.set(pos.x, pos.y);
    node.addChild(artSprite(sheet.textures[id]!, model.renderScale, fit));
    const shadow = artSprite(
      sheet.textures[model.shadowFrame]!,
      model.shadowRenderScale,
      fit,
    );
    shadow.alpha = 0.45;
    shadow.position.set(pos.x, pos.y);
    shadows.addChild(shadow);
    if (id === "windmill") {
      const rotor = artSprite(mill.textures["windmill-rotor-0"]!, 2, fit),
        rotorShadow = artSprite(
          mill.textures["windmill-rotor-0-shadow"]!,
          4,
          fit,
        );
      node.addChild(rotor);
      rotorShadow.alpha = 0.45;
      rotorShadow.position.set(pos.x, pos.y);
      shadows.addChild(rotorShadow);
      rotors.push({ node: rotor, shadow: rotorShadow });
    }
    bindings.push({ id: b.id, art: bundle + "/" + id, fit });
    renderables.push({ node, y: pos.y, id: b.id });
  }
  for (let i = 0; i < snapshot.terrain.trees.length; i++) {
    const t = snapshot.terrain.trees[i]!,
      id = ["oak-round", "oak-tall", "oak-wide"][t.variant % 3]!;
    const node = artSprite(trees.textures[id]!, 2, t.size * 0.65),
      shadow = artSprite(trees.textures[id + "-shadow"]!, 4, t.size * 0.65);
    node.position.set(t.x, t.y);
    shadow.alpha = 0.45;
    shadow.position.set(t.x, t.y);
    shadows.addChild(shadow);
    renderables.push({ node, y: t.y, id: "tree-" + i });
  }
  // One depth order across chunks; supported S1 forms have no interpenetrating footprints.
  renderables.sort((a, b) => a.y - b.y || a.id.localeCompare(b.id));
  for (const r of renderables) {
    registerPick(r.node, r.id.startsWith("tree-") ? null : r.id);
    scene.addChild(r.node);
  }
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
    selection.clear();
    if (id === "landmark:pond") {
      const p = snapshot.terrain.pond;
      selection
        .ellipse(p.x, p.y, p.rx, p.ry)
        .stroke({ color: 0xf7e0a3, width: 3 });
      camera.invalidate();
      return;
    }
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
    camera.invalidate();
  };
  const camera = attachCamera(app, scene, host, {
    bounds: { x: -1000, y: -550, width: 2000, height: 1100 },
    fitWidth: 1750,
    fitHeight: 1020,
    center: { x: 0, y: 0 },
    onTap(p) {
      const hit = pickVisible(scene, p);
      if (hit) {
        select(hit.id ?? "");
        selected(hit.id ?? "");
        return;
      }
      const local = scene.toLocal(p),
        pond = snapshot.terrain.pond;
      if (
        ((local.x - pond.x) / pond.rx) ** 2 +
          ((local.y - pond.y) / pond.ry) ** 2 <=
        1
      ) {
        select("landmark:pond");
        selected("landmark:pond");
        return;
      }
      select("");
      selected("");
    },
  });
  let atmosphere = readAtmosphere(),
    rotorFrame = -1;
  const atmosphereChanged = (event?: Event) => {
    const detail = (
      event as CustomEvent<{ lighting: string; animate: boolean }> | undefined
    )?.detail;
    atmosphere =
      detail &&
      ["day", "evening"].includes(detail.lighting) &&
      typeof detail.animate === "boolean"
        ? { evening: detail.lighting === "evening", animate: detail.animate }
        : readAtmosphere();
    scene.tint = atmosphere.evening ? 0xded4e8 : 0xffffff;
    camera.invalidate();
  };
  window.addEventListener("cv-atmosphere", atmosphereChanged);
  atmosphereChanged();
  const motion = matchMedia("(prefers-reduced-motion: reduce)");
  const rotorTimer = setInterval(() => {
    if (document.hidden || !rotors.length) return;
    const frame =
      motion.matches || !atmosphere.animate
        ? 0
        : Math.floor((performance.now() / 1000) * 6) % 6;
    if (frame === rotorFrame) return;
    rotorFrame = frame;
    for (const r of rotors) {
      setArtFrame(r.node, mill.textures["windmill-rotor-" + frame]!);
      setArtFrame(
        r.shadow,
        mill.textures["windmill-rotor-" + frame + "-shadow"]!,
      );
    }
    camera.invalidate();
  }, 1000 / 6);
  return {
    setSelection(ref: WorldSelection | null) {
      select(
        !ref ? "" : ref.kind === "landmark" ? "landmark:" + ref.id : ref.id,
      );
      host.dataset.selectedObject = ref ? ref.kind + ":" + ref.id : "";
    },
    focusSelection(ref: WorldSelection, mode: "frame" | "nudge" = "frame") {
      const b = snapshot.buildings.find((v) => v.id === ref.id);
      const p =
        ref.kind === "landmark"
          ? snapshot.terrain.pond
          : b
            ? project(
                b.position.x / 256,
                b.position.y / 256,
                b.position.elevation,
              )
            : null;
      const node = renderables.find((r) => r.id === ref.id)?.node,
        bounds = node?.getBounds();
      if (p)
        camera.locate(
          bounds
            ? scene.toLocal({
                x: bounds.x + bounds.width / 2,
                y: bounds.y + bounds.height / 2,
              })
            : { x: p.x, y: p.y - 30 },
          viewport?.() ?? {
            x: 16,
            y: 16,
            width: host.clientWidth - 32,
            height: host.clientHeight - 32,
          },
          mode,
          1.4,
          bounds
            ? {
                width: bounds.width / scene.scale.x,
                height: bounds.height / scene.scale.x,
              }
            : { width: 60, height: 70 },
        );
    },
    reset: camera.reset,
    focusPond() {
      const pond = snapshot.terrain.pond;
      selection
        .clear()
        .ellipse(pond.x, pond.y, pond.rx, pond.ry)
        .stroke({ color: 0xf7e0a3, width: 3 });
      camera.focus({ x: pond.x, y: pond.y }, 1.4);
    },
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
      ...renderStats(),
      ...art.stats(),
      artBindings: bindings,
      windmillRotors: rotors.length,
      renderer: software ? "WebGL2 software, resolution 0.75" : "WebGL2",
    }),
    destroy() {
      clearInterval(rotorTimer);
      window.removeEventListener("cv-atmosphere", atmosphereChanged);
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
