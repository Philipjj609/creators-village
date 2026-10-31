import { Container, Graphics, type Application } from "pixi.js";
import type {
  FoundingWorld,
  LivingVillage,
  ResidentState,
} from "@creators-village/contracts";
import { evaluateResidents } from "@creators-village/world/living";
import { terrainProject } from "./founding-projection.js";
import type { attachCamera } from "./camera.js";

export type LivingViewState = { plan: LivingVillage; states: ResidentState[] };
/** Four original provisional vector puppets; no textures, atlas edits or per-frame allocation of display nodes. */
export function attachResidents(
  app: Application,
  objects: Container,
  world: FoundingWorld,
  host: HTMLElement,
  camera: ReturnType<typeof attachCamera>,
  onSelect: (id: string) => void,
  onState?: (state: LivingViewState | null) => void,
  viewport?: () => { x: number; y: number; width: number; height: number },
  heightAt?: (x: number, y: number) => number | null,
) {
  const actors = new Map<
    string,
    {
      node: Container;
      body: Container;
      left: Graphics;
      right: Graphics;
      arm: Graphics;
      ring: Graphics;
      cue: Graphics;
      eyes: Graphics;
    }
  >();
  const motion = matchMedia("(prefers-reduced-motion: reduce)");
  let plan: LivingVillage | null = null,
    states: ResidentState[] = [],
    received = 0,
    disposed = false,
    request = 0,
    controller: AbortController | null = null,
    selected = "",
    following = "",
    lastDraw = -Infinity,
    lastNotify = -Infinity;
  function clear() {
    for (const a of actors.values()) a.node.destroy({ children: true });
    actors.clear();
    states = [];
    plan = null;
    onState?.(null);
    camera.invalidate();
  }
  function puppet(id: string, color: number, index: number) {
    const node = new Container(),
      body = new Container(),
      ring = new Graphics()
        .ellipse(0, 0, 11, 4)
        .stroke({ color: 0xffe8aa, width: 2 });
    ring.visible = false;
    node.label = id;
    node.addChild(
      new Graphics().ellipse(0, 0, 8, 3).fill({ color: 0x302f36, alpha: 0.22 }),
      ring,
      body,
    );
    const left = new Graphics().roundRect(-5, -11, 4, 11, 2).fill(0x3c4146);
    const right = new Graphics().roundRect(1, -11, 4, 11, 2).fill(0x3c4146);
    const arm = new Graphics().roundRect(5, -25, 4, 14, 2).fill(color);
    const eyes = new Graphics()
      .circle(-2, -33, 0.7)
      .circle(2, -33, 0.7)
      .fill(0x332e36);
    const cue = new Graphics();
    body.addChild(
      left,
      right,
      new Graphics()
        .roundRect(-7, -27, 14, 19, 4)
        .fill(color)
        .stroke({ color: 0x433d46, width: 1.2 }),
      new Graphics().roundRect(-10, -25, 4, 14, 2).fill(color),
      arm,
      new Graphics()
        .circle(0, -33, 6)
        .fill([0xe2b08a, 0xba8668, 0xefc19c, 0x9c715c][index]!),
      new Graphics()
        .ellipse(0, -38, 7, 3)
        .fill(
          index === 0
            ? 0x76554b
            : index === 1
              ? 0xd6b773
              : index === 2
                ? 0x59483e
                : 0x475549,
        ),
      eyes,
    );
    node.addChild(cue);
    // Role silhouettes: brim, mender's apron and field tender's satchel.
    if (index === 0 || index === 1)
      body.addChild(
        new Graphics()
          .ellipse(0, -37, 10, 2)
          .fill(index === 0 ? 0x76554b : 0xd6b773),
      );
    if (index === 2)
      body.addChild(
        new Graphics().poly([-4, -22, 4, -22, 6, -9, -6, -9]).fill(0xe6d5b4),
      );
    if (index === 3)
      body.addChild(new Graphics().roundRect(4, -18, 7, 8, 2).fill(0xad7950));
    objects.addChild(node);
    return { node, body, left, right, arm, ring, cue, eyes };
  }
  async function reload(invalidate = true) {
    const token = ++request;
    controller?.abort();
    controller = new AbortController();
    // Do not draw an old route through a newly reserved or completed footprint.
    if (invalidate) clear();
    try {
      const r = await fetch(
        `/api/founding/${encodeURIComponent(world.id)}/residents`,
        { cache: "no-store", signal: controller.signal },
      );
      if (!r.ok) throw Error("Residents unavailable");
      const next = (await r.json()) as LivingVillage;
      if (disposed || token !== request) return;
      if (
        !["lw1-routines-1", "lw1-goals-1"].includes(next.rules) ||
        next.worldId !== world.id ||
        next.baselineHash !== world.baseline.hash ||
        next.residents.length > 4
      )
        throw Error("Resident version mismatch");
      plan = next;
      received = performance.now();
      for (const [id, actor] of actors)
        if (!next.residents.some((r) => r.id === id)) {
          actor.node.destroy({ children: true });
          actors.delete(id);
        }
      next.residents.forEach((r, i) => {
        if (!actors.has(r.id)) actors.set(r.id, puppet(r.id, r.color, i));
      });
      delete host.dataset.residentError;
      lastDraw = lastNotify = -Infinity;
      draw();
    } catch {
      if (!disposed && token === request) {
        clear();
        host.dataset.residentError = "unavailable";
      }
    }
  }
  function draw() {
    const now = performance.now();
    if (
      !plan ||
      disposed ||
      document.hidden ||
      now - lastDraw < (motion.matches ? 1000 : 1000 / 30)
    )
      return;
    lastDraw = now;
    const time = plan.serverTimeMs + now - received;
    states = evaluateResidents(plan, time, motion.matches);
    for (const s of states) {
      const a = actors.get(s.id)!;
      const p = terrainProject(
        s.position.x,
        s.position.y,
        heightAt?.(s.position.x, s.position.y) ?? s.position.height,
      );
      a.node.position.set(p.x, p.y);
      a.node.zIndex = s.position.x + s.position.y;
      const walk =
        !motion.matches && s.activity === "travel"
          ? Math.sin(time / 120) * 3
          : 0;
      a.left.y = walk;
      a.right.y = -walk;
      a.body.y = motion.matches
        ? 0
        : s.activity === "travel"
          ? -Math.abs(walk) * 0.35
          : Math.sin(time / 650) * 0.5;
      a.body.scale.y = s.activity === "rest" ? 0.85 : 1;
      const facing = s.direction.x - s.direction.y;
      a.body.scale.x = facing < 0 ? -1 : 1;
      a.eyes.x = Math.abs(facing) > 0.05 ? 2 : 0;
      a.eyes.visible = s.direction.x + s.direction.y >= 0;
      a.cue.scale.x = a.body.scale.x;
      const acting = s.actionPhase
        ? s.actionPhase === "performing"
        : s.activity !== "travel";
      const progress = s.phaseProgress ?? 0;
      a.cue.clear();
      if (acting && s.activity === "work") {
        // Held tool and deliberate strokes at the actual interaction position.
        const stroke = motion.matches ? 0 : Math.sin(time / 210) * 3;
        a.cue
          .moveTo(8, -20 + stroke)
          .lineTo(14, -13 + stroke)
          .stroke({ color: 0x735746, width: 2.5 });
        a.cue.roundRect(12, -15 + stroke, 7, 3, 1).fill(0xc8bda1);
      } else if (acting && s.activity === "rest") {
        a.body.y = 5;
        a.body.scale.y = 0.7;
        a.cue
          .moveTo(-11, 1)
          .lineTo(11, 1)
          .stroke({ color: 0x756f56, width: 2 });
        a.cue
          .moveTo(6, -40)
          .lineTo(11, -40)
          .lineTo(6, -36)
          .lineTo(11, -36)
          .stroke({ color: 0xf4e5be, width: 1.4 });
      } else if (acting && s.activity === "gather") {
        const speak = motion.matches
          ? true
          : Math.floor(
              time / 1900 +
                (s.id.endsWith("mira") || s.id.endsWith("nell") ? 0 : 1),
            ) %
              2 ===
            0;
        if (speak) {
          a.cue.roundRect(5, -49, 19, 11, 4).fill(0xfff2d6);
          a.cue.poly([7, -39, 7, -35, 12, -39]).fill(0xfff2d6);
          a.cue
            .circle(10, -43, 1)
            .circle(14, -43, 1)
            .circle(18, -43, 1)
            .fill(0x786d5b);
        }
      } else if (acting && s.activity === "observe") {
        a.cue
          .moveTo(7, -31)
          .lineTo(13, -34)
          .stroke({ color: 0xc69b79, width: 3 });
        a.cue.circle(16, -37, 4).stroke({ color: 0x676e64, width: 1.8 });
      }
      if (s.actionPhase === "arriving")
        a.cue
          .ellipse(0, 0, 9, 3)
          .stroke({ color: 0xe6d4a0, alpha: 0.7, width: 1 });
      if (s.actionPhase === "complete" && !motion.matches)
        a.body.y = -Math.sin(progress * Math.PI) * 2;
      a.arm.rotation =
        !motion.matches && (s.activity === "work" || s.activity === "gather")
          ? Math.sin(time / 260) * 0.12
          : 0;
      a.ring.visible = s.id === selected;
      if (following === s.id) {
        const frame = viewport?.();
        camera.follow(
          { x: p.x, y: p.y - 20 },
          2.2,
          frame
            ? { x: frame.x + frame.width / 2, y: frame.y + frame.height / 2 }
            : undefined,
        );
      }
    }
    if (now - lastNotify >= 1000) {
      onState?.({ plan, states });
      lastNotify = now;
    }
    camera.invalidate();
  }
  const timer = setInterval(draw, 1000 / 30);
  const refreshTimer = setInterval(() => {
    if (!document.hidden) void reload(false);
  }, 30000);
  const resume = () => {
    if (!document.hidden) void reload();
  };
  document.addEventListener("visibilitychange", resume);
  window.addEventListener("online", resume);
  void reload();
  return {
    reload,
    nodes: () => [...actors.values()].map((a) => a.node),
    cancelFollow: () => {
      following = "";
    },
    select(id: string) {
      selected = id;
      following = "";
    },
    focus(id: string) {
      if (actors.has(id)) {
        selected = following = id;
        const a = actors.get(id)!,
          frame = viewport?.();
        camera.focus(
          { x: a.node.x, y: a.node.y - 20 },
          2.2,
          frame
            ? { x: frame.x + frame.width / 2, y: frame.y + frame.height / 2 }
            : undefined,
        );
        lastDraw = -Infinity;
        draw();
      }
    },
    pick(p: { x: number; y: number }) {
      const candidates = [...actors.entries()].sort(
        (a, b) => b[1].node.zIndex - a[1].node.zIndex,
      );
      for (const [id, a] of candidates) {
        const b = a.node.getBounds(),
          pad = Math.max(3, 9 - b.width / 2);
        if (
          p.x >= b.x - pad &&
          p.x <= b.x + b.width + pad &&
          p.y >= b.y - pad &&
          p.y <= b.y + b.height + pad
        ) {
          selected = id;
          following = "";
          onSelect(id);
          return true;
        }
      }
      return false;
    },
    stats: () => ({
      residents: actors.size,
      residentDisplayNodes: [...actors.values()].reduce(
        (n, a) => n + a.body.children.length + a.node.children.length + 1,
        0,
      ),
      residentTextureBytes: 0,
      followingResident: following || null,
      reducedMotion: motion.matches,
      residentStates: states,
      residentRules: plan?.rules ?? null,
      residentScreenBounds: [...actors.entries()].map(([id, a]) => {
        const b = a.node.getBounds();
        return { id, x: b.x, y: b.y, width: b.width, height: b.height };
      }),
    }),
    destroy() {
      disposed = true;
      ++request;
      controller?.abort();
      clearInterval(timer);
      clearInterval(refreshTimer);
      document.removeEventListener("visibilitychange", resume);
      window.removeEventListener("online", resume);
      clear();
    },
  };
}
