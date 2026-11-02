import {
  Container,
  Sprite,
  Texture,
  Rectangle,
  type Application,
} from "pixi.js";
import { ART, artSprite, type ArtLibrary } from "./art.js";
import { readAtmosphere } from "./ambient.js";
import { terrainProject } from "./founding-projection.js";
import {
  placeDecor,
  type TerrainRead,
  type CellWindow,
  type Exclusion,
} from "./terrain-art.js";

export const ENVIRONMENT_CAPS = {
  decor: 700,
  patches: 160,
  glints: 24,
} as const;
/** Cosmetic nodes have no interaction registration, collision or authoritative identity. */
export async function createEnvironmentArt(
  art: ArtLibrary,
  app: Application,
  invalidate: () => void,
) {
  const sheet = await art.sheet(ART.terrain);
  const names = [
    "grass",
    "woodland",
    "path-dirt",
    "water",
    "bank",
    "path-fringe",
    "woodland-fringe",
    "path-joint",
    "shore-strip",
    "shore-corner",
    "patch-clover",
    "patch-dry",
    "patch-moss",
    "patch-worn",
    "water-glint",
  ];
  const tex = Object.fromEntries(
    await Promise.all(
      names.map(
        async (n) => [n, await art.texture(ART.terrain, n + ".png")] as const,
      ),
    ),
  );
  for (const n of names) {
    tex[n]!.source.scaleMode = "linear";
    if (
      [
        "grass",
        "woodland",
        "path-dirt",
        "water",
        "bank",
        "path-fringe",
        "woodland-fringe",
        "shore-strip",
      ].includes(n)
    )
      tex[n]!.source.addressMode = "repeat";
    if (["grass", "woodland", "path-dirt", "water", "bank"].includes(n))
      tex[n]!.source.autoGenerateMipmaps = true;
  }
  const ground = new Container(),
    shadows = new Container(),
    bodies = new Container();
  bodies.sortableChildren = true;
  const frames = Array.from(
    { length: 4 },
    (_, i) =>
      new Texture({
        source: tex["water-glint"]!.source,
        frame: new Rectangle(i * 40, 0, 40, 20),
      }),
  );
  let glintPositions: { x: number; y: number; phase: number }[] = [];
  let glints: { node: Sprite; phase: number }[] = [],
    count = { decor: 0, patches: 0, glints: 0 },
    frame = -1;
  const motion = matchMedia("(prefers-reduced-motion: reduce)");
  const tick = () => {
    const active = !motion.matches && readAtmosphere().animate;
    if (!active && glints.length) {
      for (const g of glints) g.node.destroy();
      glints = [];
      count.glints = 0;
      invalidate();
    }
    if (active && !glints.length && glintPositions.length) {
      for (const p of glintPositions) {
        const n = new Sprite(frames[0]!);
        n.anchor.set(0.5);
        n.scale.set(0.5);
        const q = terrainProject(p.x, p.y, 0.5);
        n.position.set(q.x, q.y);
        ground.addChild(n);
        glints.push({ node: n, phase: p.phase });
      }
      count.glints = glints.length;
    }
    const f = active ? Math.floor(performance.now() * 0.006) : -1;
    if (f === frame) return;
    frame = f;
    const sequence = [1, 2, 3, 2, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    for (const g of glints) {
      g.node.visible = active;
      g.node.texture = frames[sequence[(f + g.phase) % 18] ?? 0]!;
    }
    if (glints.length) invalidate();
  };
  // A fixed 6 Hz timer never keeps the Pixi camera ticker running continuously.
  const timer = setInterval(tick, 1000 / 6);
  return {
    tex,
    ground,
    shadows,
    bodies,
    rebuild(
      read: TerrainRead,
      win: CellWindow,
      exclusions: Exclusion[],
      step: number,
      visible: (x: number, y: number) => boolean,
    ) {
      for (const parent of [ground, shadows, bodies])
        for (const c of parent.removeChildren()) c.destroy();
      glints = [];
      const plan = placeDecor(read, win, exclusions, ENVIRONMENT_CAPS, visible);
      for (const p of plan.patch) {
        // Whole patch envelope must be valid dry ground and clear of sites/paths.
        let valid = true;
        for (let y = Math.floor(p.y - 1.4); y <= Math.ceil(p.y + 1.4); y++)
          for (let x = Math.floor(p.x - 1.4); x <= Math.ceil(p.x + 1.4); x++) {
            const f = read.cell(x, y);
            if (
              f === 255 ||
              f & 7 ||
              exclusions.some(
                (r) =>
                  x + 1 > r.x &&
                  x < r.x + r.width &&
                  y + 1 > r.y &&
                  y < r.y + r.depth,
              )
            )
              valid = false;
          }
        if (!valid) continue;
        const n = new Sprite(tex[p.id]!);
        n.anchor.set(0.5);
        n.scale.set(0.5);
        const q = terrainProject(p.x, p.y, read.height(p.x, p.y) ?? 0);
        n.position.set(q.x, q.y);
        ground.addChild(n);
      }
      if (step === 1)
        for (const p of [...plan.dry, ...plan.rock, ...plan.water]) {
          const a = art.bundle(ART.terrain).decor!.items[p.id]!;
          const q = terrainProject(
            p.x,
            p.y,
            a.kind === "water" ? 0.5 : (read.height(p.x, p.y) ?? 0),
          );
          const n = artSprite(sheet.textures[a.frame]!, a.renderScale);
          n.position.set(q.x, q.y);
          n.zIndex = p.x + p.y;
          bodies.addChild(n);
          if (a.shadowFrame) {
            const s = artSprite(
              sheet.textures[a.shadowFrame]!,
              a.shadowRenderScale!,
            );
            s.position.set(q.x, q.y);
            s.alpha = 0.45;
            shadows.addChild(s);
          }
        }
      glintPositions = step === 1 ? plan.glint : [];
      count = {
        decor: bodies.children.length,
        patches: ground.children.length,
        glints: glints.length,
      };
      frame = -2;
      tick();
    },
    stats: () => ({
      environmentCounts: count,
      environmentCaps: ENVIRONMENT_CAPS,
      environmentGlintsAnimated: !motion.matches && readAtmosphere().animate,
      terrainMipBytes: Math.ceil(
        ["grass", "woodland", "path-dirt", "water", "bank"].reduce(
          (n, k) => n + (tex[k]!.width * tex[k]!.height * 4) / 3,
          0,
        ),
      ),
    }),
    destroy() {
      clearInterval(timer);
      for (const t of frames) t.destroy(false);
    },
  };
}
