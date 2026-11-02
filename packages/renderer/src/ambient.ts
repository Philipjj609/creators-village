import { Container, Sprite, type Application, type Spritesheet } from "pixi.js";
import { ART, ASSET_SCALE, setArtFrame, type ArtLibrary } from "./art.js";
import { terrainProject } from "./founding-projection.js";

export type ArtTree = {
  x: number;
  y: number;
  height: number;
  canopy: number;
  blossom: boolean;
};
export type ArtBuilding = {
  id: string;
  asset: string;
  x: number;
  y: number;
  height: number;
  fit: number;
};
export function ambientBudget(
  lanterns: number,
  chimneys: number,
  trees: number,
  blossoms: number,
  evening: boolean,
  reduced: boolean,
  scale: number,
) {
  const lantern = evening ? Math.min(12, lanterns) : 0;
  const firefly = evening && scale >= 0.45 ? Math.min(24, trees * 2) : 0;
  const smoke = !reduced && scale >= 0.45 ? Math.min(chimneys * 2, 12) : 0;
  const leaf = !reduced && scale >= 0.45 ? Math.min(trees, 12) : 0;
  const butterfly =
    !evening && !reduced && scale >= 0.45 ? Math.min(blossoms * 2, 6) : 0;
  return {
    lantern,
    firefly,
    smoke,
    leaf,
    butterfly,
    total: lantern + firefly + smoke + leaf + butterfly,
  };
}
export function readAtmosphere() {
  try {
    return {
      evening: localStorage.getItem("cv-lighting") === "evening",
      animate: localStorage.getItem("cv-ambient-animation") !== "off",
    };
  } catch {
    return { evening: false, animate: true };
  }
}
/** Bounded presentation pool, actual asset emitters and persisted tree placements only.
 * No presence, world time, resources, placement or simulation state is created. */
export function attachAmbient(
  app: Application,
  scene: Container,
  objects: Container,
  host: HTMLElement,
  art: ArtLibrary,
  trees: ArtTree[],
  buildings: ArtBuilding[],
  invalidate: () => void,
) {
  const lights = new Container();
  scene.addChild(lights);
  const motion = matchMedia("(prefers-reduced-motion: reduce)");
  let disposed = false,
    pages: [Spritesheet, Spritesheet] | null = null,
    last = -Infinity;
  let atmosphere = readAtmosphere(),
    visible = 0,
    counts = ambientBudget(0, 0, 0, 0, false, false, 1);
  const pool: Sprite[] = [];
  const begin = performance.now();
  let loadMs = 0;
  void Promise.all([art.sheet(ART.ambient), art.sheet(ART.effects)])
    .then((sheets) => {
      if (disposed) return;
      pages = sheets;
      loadMs = performance.now() - begin;
      for (let i = 0; i < 60; i++) {
        const n = new Sprite();
        n.label = "ui5-effect-" + i;
        n.visible = false;
        pool.push(n);
        lights.addChild(n);
      }
      update(true);
    })
    .catch(() => {
      if (!disposed) host.dataset.ambientError = "unavailable";
    });
  function update(force = false) {
    const now = performance.now(),
      reduced = motion.matches || !atmosphere.animate;
    if (
      disposed ||
      document.hidden ||
      !pages ||
      (!force && now - last < (reduced ? 1000 : 1000 / 30))
    )
      return;
    last = now;
    const t = now / 1000;
    let used = 0;
    const onScreen = (x: number, y: number, z: number) => {
      const p = scene.toGlobal(terrainProject(x, y, z));
      return (
        p.x >= -80 &&
        p.x <= app.screen.width + 80 &&
        p.y >= -160 &&
        p.y <= app.screen.height + 160
      );
    };
    const visibleTrees = trees.filter((p) => onScreen(p.x, p.y, p.height));
    const emitters = (kind: string) =>
      buildings.flatMap((b) => {
        const offsets = art.bundle(
          b.asset === "workshop"
            ? ART.workshop
            : b.asset === "shelter"
              ? ART.shelter
              : ART.structures,
        );
        // Workshop-03 and lodge emitter positions are pinned in their manifests.
        const e =
          b.asset === "workshop" || b.asset === "shelter"
            ? offsets.buildings?.[0]?.emitters?.[kind]
            : offsets.assets?.find((a) => a.id === b.asset)?.emitters?.[kind];
        return (e ?? [])
          .map((v) => ({
            x: b.x + v[0]! * b.fit,
            y: b.y + v[1]! * b.fit,
            z: b.height + v[2]! * b.fit,
            depth: b.x + b.y,
            phase:
              ([...b.id].reduce((n, c) => n + c.charCodeAt(0), 0) % 31) / 5,
          }))
          .filter((p) => onScreen(p.x, p.y, p.z));
      });
    const lanterns = emitters("lantern"),
      chimneys = emitters("chimney"),
      blossoms = visibleTrees.filter((p) => p.blossom);
    counts = ambientBudget(
      lanterns.length,
      chimneys.length,
      visibleTrees.length,
      blossoms.length,
      atmosphere.evening,
      reduced,
      scene.scale.x,
    );
    function put(
      sheet: Spritesheet,
      frame: string,
      x: number,
      y: number,
      z: number,
      scale: number,
      alpha: number,
      add = false,
      depth?: number,
      rotation = 0,
    ) {
      if (used >= 60) return;
      const n = pool[used++]!;
      const parent = depth === undefined ? lights : objects;
      if (n.parent !== parent) parent.addChild(n);
      setArtFrame(n, sheet.textures[frame]!);
      const p = terrainProject(x, y, z);
      n.position.set(p.x, p.y);
      n.scale.set(ASSET_SCALE * scale);
      n.alpha = alpha;
      n.blendMode = add ? "add" : "normal";
      n.rotation = rotation;
      n.zIndex = depth ?? 0;
      n.visible = true;
    }
    for (let i = 0; i < counts.lantern; i++) {
      const p = lanterns[i]!;
      put(
        pages[0],
        "glow-warm",
        p.x,
        p.y,
        p.z,
        2.4,
        reduced
          ? 0.6
          : 0.55 +
              0.1 * Math.sin(7.3 * t + p.phase) +
              0.06 * Math.sin(13.1 * t + 2 * p.phase),
        true,
      );
    }
    for (let i = 0; i < counts.smoke; i++) {
      const p = chimneys[Math.floor(i / 2)]!,
        period = 1.6 + (p.phase % 0.8),
        age = (t + p.phase + (i % 2) * period) % (period * 2);
      if (age > 3.5) continue;
      put(
        pages[0],
        "smoke-" + (i % 3),
        p.x + 0.12 * age,
        p.y - 0.12 * age,
        p.z + 0.35 * age,
        0.6 + age / 3.5,
        0.55 * (1 - age / 3.5),
        false,
        p.depth + 0.01,
      );
    }
    for (let i = 0; i < counts.leaf; i++) {
      const p = visibleTrees[i]!,
        age = (t + i * 1.73) % 8;
      if (age > 6.8) continue;
      put(
        pages[0],
        p.blossom ? "petal-0" : "leaf-" + (i % 2),
        p.x + 0.3 * Math.sin(0.8 * t + i),
        p.y,
        p.height + Math.max(0, p.canopy - age * 0.25),
        1,
        Math.min(1, (6.8 - age) * 0.6),
        false,
        undefined,
        t * 1.5 + i,
      );
    }
    for (let i = 0; i < counts.butterfly; i++) {
      const p = blossoms[Math.floor(i / 2)]!,
        phase = i * 2.1;
      put(
        pages[1],
        `butterfly-${i % 2 ? "sky" : "amber"}-${Math.floor(t * 12) % 4}`,
        p.x + 0.8 * Math.sin(0.5 * t + phase),
        p.y + 0.8 * Math.sin(0.4 * t + phase),
        p.height + 0.7 + 0.25 * Math.sin(0.7 * t),
        1,
        1,
        false,
        p.x + p.y + 0.5,
      );
    }
    for (let i = 0; i < counts.firefly; i++) {
      const p = visibleTrees[Math.floor(i / 2)]!,
        phase = i * 2.4;
      put(
        pages[1],
        "firefly",
        p.x + (reduced ? 0 : 0.6 * Math.sin(0.5 * t + phase)),
        p.y + (reduced ? 0 : 0.6 * Math.sin(0.7 * t + phase)),
        p.height + 0.4 + (reduced ? 0 : 0.3 * Math.sin(0.7 * t + phase)),
        2,
        reduced
          ? 0.6
          : 0.15 + 0.85 * Math.max(0, Math.sin(1.1 * t + phase)) ** 2,
        true,
      );
    }
    for (let i = used; i < pool.length; i++) pool[i]!.visible = false;
    visible = used;
    host.dataset.ambientSprites = String(visible);
    host.dataset.ambientMotion = reduced ? "reduced" : "animated";
    host.dataset.villageLighting = atmosphere.evening ? "evening" : "day";
    invalidate();
  }
  const changed = (event?: Event) => {
    const detail = (
      event as CustomEvent<{ lighting?: string; animate?: boolean }> | undefined
    )?.detail;
    atmosphere =
      detail &&
      ["day", "evening"].includes(detail.lighting ?? "") &&
      typeof detail.animate === "boolean"
        ? { evening: detail.lighting === "evening", animate: detail.animate }
        : readAtmosphere();
    // A visual light treatment; never server time or a gameplay day/night cycle.
    scene.tint = atmosphere.evening ? 0xded4e8 : 0xffffff;
    last = -Infinity;
    update(true);
  };
  scene.tint = atmosphere.evening ? 0xded4e8 : 0xffffff;
  window.addEventListener("cv-atmosphere", changed);
  motion.addEventListener("change", changed);
  const timer = setInterval(update, 1000 / 30);
  return {
    nodes: () => pool.filter((n) => n.parent === objects),
    refresh: () => update(true),
    stats: () => ({
      ambientSprites: visible,
      ambientPool: pool.length,
      ambientBudget: counts,
      ambientLoadMs: loadMs,
      ambientLighting: atmosphere.evening ? "evening" : "day",
      ambientReducedMotion: motion.matches || !atmosphere.animate,
    }),
    destroy() {
      disposed = true;
      clearInterval(timer);
      window.removeEventListener("cv-atmosphere", changed);
      motion.removeEventListener("change", changed);
      for (const n of pool) n.destroy();
      lights.destroy();
    },
  };
}
