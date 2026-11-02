import { registerPick } from "./picking.js";
import {
  Container,
  Graphics,
  Sprite,
  type Spritesheet,
  type Application,
} from "pixi.js";
import type {
  FoundingWorld,
  LivingVillage,
  ResidentState,
} from "@creators-village/contracts";
import { evaluateResidents } from "@creators-village/world/living";
import { terrainProject } from "./founding-projection.js";
import type { attachCamera } from "./camera.js";

import {
  ART,
  artSprite,
  setArtFrame,
  type ArtLibrary,
  type Cast,
} from "./art.js";
import {
  residentArtwork,
  prepareResidentArtwork,
  artDirection,
  semanticAnimation,
  walkFrame,
} from "./resident-art.js";

export type LivingViewState = { plan: LivingVillage; states: ResidentState[] };
/** Four persisted fictional identities, rendered through versioned art without changing their routes or timing. */
export function attachResidents(
  app: Application,
  objects: Container,
  world: FoundingWorld,
  host: HTMLElement,
  camera: ReturnType<typeof attachCamera>,
  art: ArtLibrary,
  shadows: Container,
  onSelect: (id: string) => void,
  onState?: (state: LivingViewState | null) => void,
  viewport?: () => { x: number; y: number; width: number; height: number },
  heightAt?: (x: number, y: number) => number | null,
  onFollowChange?: (id: string | null) => void,
) {
  const actors = new Map<
    string,
    {
      node: Container;
      body: Container;
      sprite: Sprite;
      shadow: Sprite;
      ring: Graphics;
      cue: Graphics;
      model: Cast;
      loco: Spritesheet;
      activity?: Spritesheet;
      activityLoading: boolean;
      activityFailed: boolean;
      distance: number;
      previous: { x: number; y: number } | null;
      completed: number | null;
      reactAt: number;
      animation: string;
    }
  >();
  const completionReactions = new Set<string>();
  let drawCpuMs = 0,
    maxDrawCpuMs = 0;
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
    for (const a of actors.values()) {
      a.node.destroy({ children: true });
      a.shadow.destroy();
    }
    actors.clear();
    states = [];
    plan = null;
    onState?.(null);
    camera.invalidate();
  }
  async function character(id: string) {
    const key = residentArtwork(id);
    if (!key) throw Error("Unmapped fictional resident");
    const model = art.bundle(ART.cast).cast!.find((c) => c.id === key)!;
    const loco = await art.sheet(ART.cast, key, "loco");
    const node = new Container(),
      body = new Container();
    const sprite = artSprite(
      loco.textures[key + "/idle-se-0"]!,
      model.renderScale,
    );
    const shadow = artSprite(
      loco.textures[key + "/shadow-se"]!,
      model.shadowRenderScale,
    );
    shadow.alpha = 0.45;
    const ring = new Graphics()
      .ellipse(0, 0, 11, 4)
      .stroke({ color: 0xffe8aa, width: 2 });
    const cue = new Graphics();
    ring.visible = false;
    node.label = id;
    registerPick(node, id, body);
    body.addChild(sprite);
    node.addChild(ring, body, cue);
    return {
      node,
      body,
      sprite,
      shadow,
      ring,
      cue,
      model,
      loco,
      activityLoading: false,
      activityFailed: false,
      distance: 0,
      previous: null,
      completed: null,
      reactAt: -Infinity,
      animation: "idle-se",
    };
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
        ![
          "lw1-routines-1",
          "lw1-goals-1",
          "cv-f1-goals-1",
          "cv-f2-goals-1",
        ].includes(next.rules) ||
        next.worldId !== world.id ||
        next.baselineHash !== world.baseline.hash ||
        next.residents.length > 4 ||
        new Set(next.residents.map((r) => r.id)).size !== next.residents.length
      )
        throw Error("Resident version mismatch");
      const fetchedAt = performance.now();
      for (const [id, actor] of actors)
        if (!next.residents.some((r) => r.id === id)) {
          actor.node.destroy({ children: true });
          actor.shadow.destroy();
          actors.delete(id);
        }
      const missing = await prepareResidentArtwork(
        next.residents.filter((r) => !actors.has(r.id)).map((r) => r.id),
        character,
        () => !disposed && token === request,
        (actor) => {
          actor.node.destroy({ children: true });
          actor.shadow.destroy();
        },
      );
      if (!missing) return;
      for (const { id, actor } of missing) {
        actors.set(id, actor);
        objects.addChild(actor.node);
        shadows.addChild(actor.shadow);
      }
      plan = next;
      received = fetchedAt;
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
    const began = performance.now();
    lastDraw = now;
    const time = plan.serverTimeMs + now - received;
    states = evaluateResidents(plan, time, motion.matches);
    for (const s of states) {
      const a = actors.get(s.id);
      if (!a) continue;
      const p = terrainProject(
        s.position.x,
        s.position.y,
        heightAt?.(s.position.x, s.position.y) ?? s.position.height,
      );
      a.node.position.set(p.x, p.y);
      a.node.zIndex = s.position.x + s.position.y;
      a.shadow.position.copyFrom(a.node.position);
      const direction = artDirection(s.direction);
      if (a.previous && s.activity === "travel") {
        const delta = Math.hypot(
          s.position.x - a.previous.x,
          s.position.y - a.previous.y,
        );
        // Ignore topology reload/hidden-tab discontinuities; never change authoritative movement.
        if (delta < 1) a.distance += delta;
      }
      a.previous = { x: s.position.x, y: s.position.y };
      if (
        a.completed !== null &&
        s.completedActions !== undefined &&
        s.completedActions > a.completed
      )
        a.reactAt = now;
      a.completed = s.completedActions ?? null;
      let animation = semanticAnimation(s, now - a.reactAt < 600);
      const spec = a.model.animations[animation]!;
      // No rear activity artwork supplied: retain honest facing with same-direction idle.
      if (!spec.directions.includes(direction)) animation = "idle";
      if (
        animation !== "idle" &&
        animation !== "walk" &&
        !a.activity &&
        !a.activityLoading &&
        !a.activityFailed
      ) {
        a.activityLoading = true;
        void art
          .sheet(ART.cast, a.model.id, "act")
          .then((sheet) => {
            if (!disposed && actors.get(s.id) === a) {
              a.activity = sheet;
              camera.invalidate();
            }
          })
          .catch(() => {
            a.activityFailed = true;
            host.dataset.residentArtError = "activity-unavailable";
          })
          .finally(() => {
            a.activityLoading = false;
          });
      }
      const sheet =
        animation === "idle" || animation === "walk" ? a.loco : a.activity;
      if (!sheet) animation = "idle";
      const table = a.model.animations[animation]!,
        textures = (
          animation === "idle" || animation === "walk" ? a.loco : a.activity
        )!.animations[a.model.id + "/" + animation + "-" + direction]!;
      const frame = motion.matches
        ? 0
        : animation === "walk"
          ? walkFrame(
              a.distance,
              a.model.locomotion.strideUnits,
              textures.length,
            )
          : animation === "react"
            ? Math.min(
                textures.length - 1,
                Math.floor(((now - a.reactAt) / 1000) * table.fps),
              )
            : Math.floor((time / 1000) * table.fps) % textures.length;
      setArtFrame(a.sprite, textures[frame]!);
      setArtFrame(
        a.shadow,
        a.loco.textures[a.model.id + "/shadow-" + direction]!,
      );
      a.animation = animation + "-" + direction;
      a.cue.clear();
      if (s.actionPhase === "arriving")
        a.cue
          .moveTo(-4, 1)
          .lineTo(4, 1)
          .stroke({ color: 0x756f56, alpha: 0.6, width: 1 });
      a.ring.visible = s.id === selected;
      if (following === s.id) {
        const frame = viewport?.();
        camera.follow(
          { x: p.x, y: p.y - 20 },
          Math.max(1.6, camera.stats().scale),
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
    drawCpuMs = performance.now() - began;
    maxDrawCpuMs = Math.max(maxDrawCpuMs, drawCpuMs);
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
    reactToCompletion(projectId: string) {
      if (completionReactions.has(projectId)) return;
      completionReactions.add(projectId);
      if (completionReactions.size > 32)
        completionReactions.delete(completionReactions.values().next().value!);
      host.dataset.residentMilestone = projectId;
      for (const a of actors.values()) a.reactAt = performance.now();
      lastDraw = -Infinity;
      draw();
    },
    nodes: () => [...actors.values()].map((a) => a.node),
    cancelFollow: () => {
      if (following) {
        following = "";
        onFollowChange?.(null);
      }
    },
    select(id: string) {
      if (selected !== id && following) {
        following = "";
        onFollowChange?.(null);
      }
      selected = id;
      for (const [key, a] of actors) a.ring.visible = key === id;
      camera.invalidate();
    },
    focus(id: string) {
      if (actors.has(id)) {
        selected = following = id;
        onFollowChange?.(id);
        const a = actors.get(id)!,
          frame = viewport?.();
        camera.focus(
          { x: a.node.x, y: a.node.y - 20 },
          Math.max(1.6, camera.stats().scale),
          frame
            ? { x: frame.x + frame.width / 2, y: frame.y + frame.height / 2 }
            : undefined,
        );
        lastDraw = -Infinity;
        draw();
      }
    },
    locate(id: string, mode: "frame" | "nudge" = "frame") {
      const a = actors.get(id);
      if (!a) return;
      const frame = viewport?.() ?? {
        x: 12,
        y: 12,
        width: host.clientWidth - 24,
        height: host.clientHeight - 24,
      };
      camera.locate({ x: a.node.x, y: a.node.y - 20 }, frame, mode, 1.6, {
        width: 24,
        height: 46,
      });
    },
    stats: () => ({
      residentDrawCpuMs: drawCpuMs,
      residentMaxDrawCpuMs: maxDrawCpuMs,
      completionReactions: [...completionReactions],
      residents: actors.size,
      residentDisplayNodes: [...actors.values()].reduce(
        (n, a) => n + a.body.children.length + a.node.children.length + 2,
        0,
      ),
      residentTextureBytes: art.decodedBytes(ART.cast),
      residentArtwork: [...actors.entries()].map(([id, a]) => ({
        id,
        art: a.model.id,
        appearanceInstances: objects.children.filter((n) => n === a.node)
          .length,
        bodySprites: a.body.children.length,
        textureFrame: {
          x: a.sprite.texture.frame.x,
          y: a.sprite.texture.frame.y,
          width: a.sprite.texture.frame.width,
          height: a.sprite.texture.frame.height,
        },
        animation: a.animation,
        activityLoaded: !!a.activity,
      })),
      followingResident: following || null,
      selectedResident: selected || null,
      residentSelectionRings: [...actors.values()].filter((a) => a.ring.visible)
        .length,
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
