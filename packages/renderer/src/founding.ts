import { Container, Graphics, Sprite, Assets, type Texture } from "pixi.js";
import type {
  FoundingWorld,
  TerrainChunk,
  Wf2State,
} from "@creators-village/contracts";
import {
  terrainReader,
  WATER,
  TREE,
  ROCK,
} from "@creators-village/world/spatial";
import { createSurface } from "./surface.js";
import { attachCamera } from "./camera.js";
import { terrainProject, pickGround } from "./founding-projection.js";
import { attachResidents, type LivingViewState } from "./living.js";
/** Fixed axes match Blender B(x,y,z)=(y,x,z), camera45/30. Height is logical units, never v1 elevation. */
export async function mountFounding(
  host: HTMLElement,
  world: FoundingWorld,
  onSelect: (id?: string) => void,
  onTerrain?: (sample: {
    x: number;
    y: number;
    height: number;
    active: boolean;
    cover: string;
  }) => void,
  focusViewport?: () => { x: number; y: number; width: number; height: number },
  onLiving?: (state: LivingViewState | null) => void,
) {
  delete host.dataset.terrainError;
  const bundle = "/assets/hearthside-hero-01/",
    manifestText = await fetch(bundle + "manifest.json").then((r) => {
      if (!r.ok) throw Error("Missing pinned shelter bundle");
      return r.text();
    });
  const manifest = JSON.parse(manifestText),
    manifestHash = Array.from(
      new Uint8Array(
        await crypto.subtle.digest(
          "SHA-256",
          new TextEncoder().encode(manifestText),
        ),
      ),
      (v) => v.toString(16).padStart(2, "0"),
    ).join("");
  const b = manifest.buildings.find((v: { id: string }) => v.id === "commons"),
    layer = manifest.layers.find((v: { id: string }) => v.id === "commons"),
    tree = manifest.layers.find((v: { id: string }) => v.id === "apple-tree");
  const baseUrls = [bundle + "commons.png", bundle + "apple-tree.png"],
    textures = (await Assets.load<Texture>(baseUrls)) as unknown as Record<
      string,
      Texture
    >;
  if (!b || !layer || !tree || manifest.version !== "hearthside-hero-01")
    throw Error("Unsupported pinned asset bundle");
  const { app, software } = await createSurface(host),
    scene = new Container();
  app.stage.addChild(scene);
  const extraSprites = new Map<string, Sprite>();
  const preview = new Graphics();
  scene.addChild(preview);
  let current: Wf2State | null = null,
    extraBaseBytes = 0,
    extraDetail: Sprite | null = null,
    extraDetailBytes = 0;
  let currentGeometry = "";
  let disposed = false,
    sequence = 0,
    busy = false;
  const cache = new Map<string, TerrainChunk>();
  let heightReader = terrainReader(world.baseline, []);
  const terrain = new Container(),
    objects = new Container();
  objects.sortableChildren = true;
  scene.addChild(terrain, objects);
  const shelter = new Sprite(textures[baseUrls[0]!]!);
  objects.addChild(shelter);
  // Full-frame original ortho_scale22 / width2560; source XY scale82.28px per unit.
  const assetScale = 32 / (2560 / 22 / Math.sqrt(2));
  const anchor = terrainProject(0, 0, world.structure.height);
  shelter.position.set(
    anchor.x + (layer.left - b.screenAnchor[0]) * assetScale,
    anchor.y + (layer.top - b.screenAnchor[1]) * assetScale,
  );
  shelter.scale.set(layer.scale * assetScale);
  let detail: Sprite | null = null;
  const marker = new Graphics();
  objects.addChild(marker);
  let cpuRebuildMs = 0,
    maxCpuRebuildMs = 0,
    rebuildCount = 0;
  let renderedChunks = 0,
    triangles = 0,
    treeCount = 0,
    detailBytes = Assets.cache.has(bundle + "commons-detail.png")
      ? b.detail.decodedBytes
      : 0,
    lastKey = "",
    residentKeys: string[] = [];
  async function refresh(force = false) {
    if (disposed || busy) return;
    const scale = scene.scale.x || 1,
      cx = (app.screen.width / 2 - scene.x) / scale,
      cy = (app.screen.height / 2 - scene.y) / scale;
    const lx = cx / 64 + cy / 32,
      ly = cy / 32 - cx / 64;
    const centerX = Math.max(-48, Math.min(48, lx)),
      centerY = Math.max(-48, Math.min(48, ly));
    const radius = scale < 0.35 ? 96 : scale < 0.8 ? 64 : 40;
    const step = scale < 0.35 ? 4 : scale < 0.8 ? 2 : 1;
    const key = `${Math.floor(centerX / 16)},${Math.floor(centerY / 16)},${radius},${step}`;
    if (key === lastKey && !force) return;
    lastKey = key;
    busy = true;
    const epoch = ++sequence;
    const x0 = Math.max(-8, Math.floor((centerX - radius) / 32)),
      x1 = Math.min(7, Math.floor((centerX + radius) / 32)),
      y0 = Math.max(-8, Math.floor((centerY - radius) / 32)),
      y1 = Math.min(7, Math.floor((centerY + radius) / 32));
    try {
      const needed: string[] = [];
      const missing: string[] = [];
      for (let y = y0; y <= y1; y++)
        for (let x = x0; x <= x1; x++) {
          const k = `${x},${y}`;
          needed.push(k);
          if (!cache.has(k)) missing.push(k);
        }
      // Bounded request batches, immutable persisted chunks. Never client generation.
      for (let i = 0; i < missing.length; i += 64) {
        const response = await fetch(
          `/api/founding/${encodeURIComponent(world.id)}/chunks?keys=${encodeURIComponent(missing.slice(i, i + 64).join(";"))}`,
        );
        if (!response.ok) throw Error("Terrain unavailable");
        const data = (await response.json()) as {
          baselineHash: string;
          chunks: TerrainChunk[];
        };
        if (data.baselineHash !== world.baseline.hash)
          throw Error("Terrain version mismatch");
        for (const c of data.chunks) cache.set(`${c.x},${c.y}`, c);
      }
      if (disposed || epoch !== sequence) return;
      const cpuBegan = performance.now();
      for (const c of terrain.removeChildren()) c.destroy();
      for (const c of objects.removeChildren())
        if (
          c !== shelter &&
          c !== detail &&
          c !== marker &&
          c !== extraDetail &&
          !living.nodes().includes(c as Container) &&
          ![...extraSprites.values()].includes(c as Sprite)
        )
          c.destroy();
      objects.addChild(shelter);
      if (detail) objects.addChild(detail);
      objects.addChild(marker);
      for (const s of extraSprites.values()) objects.addChild(s);
      if (extraDetail) objects.addChild(extraDetail);
      for (const node of living.nodes()) objects.addChild(node);
      renderedChunks = 0;
      triangles = 0;
      treeCount = 0;
      const read = terrainReader(world.baseline, [...cache.values()]),
        items: { node: Sprite; depth: number }[] = [];
      heightReader = read;
      for (const k of needed) {
        const c = cache.get(k)!;
        const g = new Graphics();
        terrain.addChild(g);
        renderedChunks++;
        for (let yy = 0; yy < 32; yy += step)
          for (let xx = 0; xx < 32; xx += step) {
            const x = c.x * 32 + xx,
              y = c.y * 32 + yy,
              flag = c.cells[yy * 32 + xx]!,
              wet = (flag & WATER) !== 0;
            const z = (dx: number, dy: number) =>
              wet ? 0.5 : c.heights[(yy + dy) * 33 + xx + dx]! / 16;
            const a = terrainProject(x, y, z(0, 0)),
              b = terrainProject(x + step, y, z(step, 0)),
              d = terrainProject(x + step, y + step, z(step, step)),
              e = terrainProject(x, y + step, z(0, step));
            const hh = z(0, 0),
              shade = Math.max(
                -8,
                Math.min(9, Math.round((z(step, 0) - hh) * 9)),
              );
            const base = wet
              ? 0x709fa2
              : flag & (8 | TREE)
                ? 0x819777
                : 0xa4ae84;
            const color = base + shade * 0x010101;
            g.poly([a.x, a.y, b.x, b.y, d.x, d.y]).fill(color);
            g.poly([a.x, a.y, d.x, d.y, e.x, e.y]).fill(color);
            triangles += 2;
          }
        // Natural feature IDs/occupancy derive from persisted cell flags, not decorative RNG.
        for (let yy = 0; yy < 32; yy++)
          for (let xx = 0; xx < 32; xx++) {
            const flag = c.cells[yy * 32 + xx]!,
              x = c.x * 32 + xx + 0.5,
              y = c.y * 32 + yy + 0.5;
            if (
              !(flag & (TREE | ROCK)) ||
              Math.abs(x - centerX) > radius * 0.8 ||
              Math.abs(y - centerY) > radius * 0.8
            )
              continue;
            if (step === 4 && (xx + yy) % 4) continue;
            const p = terrainProject(x, y, read.height(x, y) ?? 0);
            if (flag & TREE) {
              const n = new Sprite(textures[baseUrls[1]!]!);
              n.anchor.set(0.5, 0.87);
              n.position.set(p.x, p.y);
              n.scale.set(assetScale * tree.scale * 0.42);
              items.push({ node: n, depth: x + y });
              treeCount++;
            } else g.ellipse(p.x, p.y - 3, 9, 5).fill(0x858a78);
          }
      }
      const path = new Graphics();
      terrain.addChild(path);
      const allPaths = current
        ? current.paths.map((p) => ({
            width: p.widthQ / 256,
            points: p.points.map((v) => ({ x: v.qx / 256, y: v.qy / 256 })),
          }))
        : [world.path];
      for (const route of allPaths)
        for (let i = 0; i < route.points.length - 1; i++) {
          const a = route.points[i]!,
            b = route.points[i + 1]!;
          const p = terrainProject(a.x, a.y, read.height(a.x, a.y) ?? 1),
            q = terrainProject(b.x, b.y, read.height(b.x, b.y) ?? 1);
          path
            .moveTo(p.x, p.y)
            .lineTo(q.x, q.y)
            .stroke({
              width: route.width * 24,
              color: 0xc4b28d,
              cap: current ? "butt" : "round",
            });
        }
      items.push({ node: shelter, depth: 0 });
      if (detail) items.push({ node: detail, depth: 0 });
      if (current)
        for (const s of current.structures) {
          const n = extraSprites.get(s.id);
          if (n)
            items.push({
              node: n,
              depth:
                (s.position.qx +
                  s.position.qy +
                  s.footprint.widthQ / 2 +
                  s.footprint.depthQ / 2) /
                256,
            });
        }
      if (extraDetail && current) {
        const s = current.structures.find((s) => s.id === extraDetail!.label);
        if (s)
          items.push({
            node: extraDetail,
            depth:
              (s.position.qx +
                s.position.qy +
                s.footprint.widthQ / 2 +
                s.footprint.depthQ / 2) /
              256,
          });
      }
      items.sort((a, b) => a.depth - b.depth);
      for (const item of items) {
        item.node.zIndex = item.depth;
        objects.addChild(item.node);
      }
      marker.zIndex = 10000;
      objects.addChild(marker);
      cpuRebuildMs = performance.now() - cpuBegan;
      maxCpuRebuildMs = Math.max(maxCpuRebuildMs, cpuRebuildMs);
      rebuildCount++;
      residentKeys = needed;
      for (const k of cache.keys()) if (!needed.includes(k)) cache.delete(k);
      camera.invalidate();
    } catch {
      lastKey = key;
      host.dataset.terrainError = "unavailable";
    } finally {
      busy = false;
    }
  }
  const camera = attachCamera(app, scene, host, {
    bounds: { x: -4200, y: -2400, width: 8400, height: 4800 },
    fitWidth: 3300,
    fitHeight: 1900,
    center: { x: 0, y: 0 },
    maxScale: 2.6,
    cover: true,
    onExplore: () => living.cancelFollow(),
    onTap(p) {
      if (living.pick(p)) return;
      const candidates = [...extraSprites.entries()].reverse();
      if (extraDetail)
        candidates.unshift([String(extraDetail.label), extraDetail]);
      for (const [id, node] of candidates) {
        if (!node.visible) continue;
        const box = node.getBounds();
        if (
          p.x >= box.x &&
          p.x <= box.x + box.width &&
          p.y >= box.y &&
          p.y <= box.y + box.height
        ) {
          onSelect(id);
          return;
        }
      }
      const point = scene.toLocal(p);
      if (Math.hypot(point.x - anchor.x, point.y - anchor.y + 35) < 100) {
        onSelect(world.structure.id);
        select();
      } else {
        const sample = pickGround(
          point.x,
          point.y,
          terrainReader(world.baseline, [...cache.values()]),
        );
        if (sample)
          onTerrain?.({
            x: sample.x,
            y: sample.y,
            height: sample.height,
            active: sample.x ** 2 + sample.y ** 2 < world.active.radius ** 2,
            cover:
              sample.flags & 1
                ? "water"
                : sample.flags & (2 | 8)
                  ? "woodland"
                  : "meadow",
          });
      }
    },
  });
  const living = attachResidents(
    app,
    objects,
    world,
    host,
    camera,
    (id) => onSelect(id),
    onLiving,
    focusViewport,
    (x, y) => heightReader.height(x, y),
  );
  function select() {
    marker
      .clear()
      .ellipse(anchor.x, anchor.y, 65, 26)
      .stroke({ color: 0xf7e9b9, width: 3 });
    camera.invalidate();
  }
  const update = () => {
    void refresh();
  };
  app.ticker.add(update);
  await refresh(true);
  if (host.dataset.terrainError) {
    living.destroy();
    camera.destroy();
    app.destroy(true, { children: true });
    throw Error("Terrain unavailable");
  }
  let detailRequest = 0;
  function frameDetail(sprite: Sprite) {
    if (!focusViewport) return;
    const frame = focusViewport();
    const scale = Math.min(
      2.2,
      frame.width / Math.max(1, sprite.width),
      frame.height / Math.max(1, sprite.height),
    );
    camera.focus(
      { x: sprite.x + sprite.width / 2, y: sprite.y + sprite.height / 2 },
      scale,
      { x: frame.x + frame.width / 2, y: frame.y + frame.height / 2 },
    );
  }
  async function focus() {
    living.cancelFollow();
    clearExtraDetail();
    select();
    camera.focus({ x: anchor.x, y: anchor.y - 35 }, 2.2);
    if (detail) {
      frameDetail(detail);
      return;
    }
    const url = bundle + "commons-detail.png";
    const token = ++detailRequest;
    const texture = await Assets.load<Texture>(url);
    detailBytes = b.detail.decodedBytes;
    if (disposed || token !== detailRequest) return;
    detail = new Sprite(texture);
    detail.scale.set(b.detail.scale * assetScale);
    detail.position.set(
      anchor.x + (b.detail.left - b.screenAnchor[0]) * assetScale,
      anchor.y + (b.detail.top - b.screenAnchor[1]) * assetScale,
    );
    detailBytes = b.detail.decodedBytes;
    shelter.visible = false;
    objects.addChild(detail);
    frameDetail(detail);
    lastKey = "";
    camera.invalidate();
  }
  function reset() {
    living.cancelFollow();
    clearExtraDetail();
    ++detailRequest;
    shelter.visible = true;
    if (detail) {
      detail.destroy();
      detail = null;
    }
    camera.reset();
    lastKey = "";
  }
  return {
    select,
    focus,
    reset,
    focusResident: (id: string) => {
      clearExtraDetail();
      shelter.visible = !detail;
      living.focus(id);
    },
    selectResident: (id: string) => living.select(id),
    refreshResidents: () => living.reload(),
    previewPlan(plan: Wf2State["projects"][number] | null) {
      preview.clear();
      if (!plan) {
        camera.invalidate();
        return;
      }
      const s = plan.site,
        corners = [
          [-3, -3],
          [3, -3],
          [3, 3],
          [-3, 3],
        ].map(([x, y]) =>
          terrainProject(s.qx / 256 + x!, s.qy / 256 + y!, s.baseHeight / 16),
        );
      preview
        .poly(corners.flatMap((p) => [p.x, p.y]))
        .fill({ color: 0xd7bd6b, alpha: 0.22 })
        .stroke({ color: 0x765c26, width: 2 });
      for (let i = 1; i < plan.path.points.length; i++) {
        const a = plan.path.points[i - 1]!,
          b = plan.path.points[i]!;
        const p = terrainProject(a.qx / 256, a.qy / 256, s.baseHeight / 16),
          q = terrainProject(b.qx / 256, b.qy / 256, s.baseHeight / 16);
        preview
          .moveTo(p.x, p.y)
          .lineTo(q.x, q.y)
          .stroke({ color: 0x765c26, width: 3 });
      }
      camera.invalidate();
    },
    async updateCurrent(state: Wf2State) {
      if (
        state.worldId !== world.id ||
        state.baseline.hash !== world.baseline.hash
      )
        throw Error("World/baseline mismatch");
      current = state;
      const geometry = JSON.stringify([
        state.topologyEpoch,
        state.structures.map((s) => [s.id, s.revision]),
        state.paths.map((p) => [p.id, p.revision]),
      ]);
      if (geometry === currentGeometry) return;
      currentGeometry = geometry;
      void living.reload();
      const extra = state.structures.filter((s) => s.id !== world.structure.id);
      for (const s of extra) {
        if (s.assetManifestHash !== manifestHash)
          throw Error("Pinned asset manifest mismatch");
        if (
          s.template !== "wf2-workshop-1" ||
          s.appearance !== "hearthside-hero-01/workshop"
        )
          throw Error("Unsupported current structure");
        if (extraSprites.has(s.id)) continue;
        const model = manifest.buildings.find(
            (v: { id: string }) => v.id === "workshop",
          ),
          l = manifest.layers.find((v: { id: string }) => v.id === "workshop");
        const texture = await Assets.load<Texture>(bundle + "workshop.png");
        if (disposed) return;
        const node = new Sprite(texture),
          p = terrainProject(
            (s.position.qx + s.footprint.widthQ / 2) / 256,
            (s.position.qy + s.footprint.depthQ / 2) / 256,
            s.position.height / 16,
          );
        node.position.set(
          p.x + (l.left - model.screenAnchor[0]) * assetScale,
          p.y + (l.top - model.screenAnchor[1]) * assetScale,
        );
        node.scale.set(l.scale * assetScale);
        extraSprites.set(s.id, node);
        extraBaseBytes = l.decodedBytes;
        objects.addChild(node);
      }
      lastKey = "";
      await refresh(true);
      camera.invalidate();
    },
    async focusStructure(id: string) {
      if (id === world.structure.id) return focus();
      const s = current?.structures.find((s) => s.id === id);
      if (!s) throw Error("Unknown structure");
      reset();
      const token = ++detailRequest;
      const p = terrainProject(
        (s.position.qx + s.footprint.widthQ / 2) / 256,
        (s.position.qy + s.footprint.depthQ / 2) / 256,
        s.position.height / 16,
      );
      camera.focus({ x: p.x, y: p.y - 40 }, 2.2);
      const model = manifest.buildings.find(
        (v: { id: string }) => v.id === "workshop",
      );
      const texture = await Assets.load<Texture>(
        bundle + "workshop-detail.png",
      );
      if (disposed || token !== detailRequest) return;
      extraDetail = new Sprite(texture);
      extraDetail.label = id;
      extraDetail.scale.set(model.detail.scale * assetScale);
      extraDetail.position.set(
        p.x + (model.detail.left - model.screenAnchor[0]) * assetScale,
        p.y + (model.detail.top - model.screenAnchor[1]) * assetScale,
      );
      extraDetailBytes = model.detail.decodedBytes;
      extraSprites.get(id)!.visible = false;
      objects.addChild(extraDetail);
      frameDetail(extraDetail);
      lastKey = "";
      camera.invalidate();
    },
    zoom: (factor: number) => {
      living.cancelFollow();
      camera.zoom(factor);
    },
    stats: () => ({
      ...camera.stats(),
      ...living.stats(),
      renderer: software ? "software WebGL2" : "WebGL2",
      renderedChunks,
      triangles,
      treeCount,
      residentChunks: cache.size,
      residentTerrainPayloadBytes: cache.size * 3202,
      cpuRebuildMs,
      maxCpuRebuildMs,
      rebuildCount,
      chunkKeys: residentKeys,
      decodedBytes:
        layer.decodedBytes +
        tree.decodedBytes +
        detailBytes +
        extraBaseBytes +
        extraDetailBytes,
      baselineHash: world.baseline.hash,
      terrainError: host.dataset.terrainError ?? null,
    }),
    destroy() {
      disposed = true;
      ++sequence;
      ++detailRequest;
      living.destroy();
      app.ticker.remove(update);
      camera.destroy();
      app.destroy(true, {
        children: true,
      }); /* Pinned shared textures retained by Pixi Assets, bounded to this bundle. */
    },
  };
  function clearExtraDetail() {
    for (const s of extraSprites.values()) s.visible = true;
    if (extraDetail) {
      extraDetail.destroy();
      extraDetail = null;
    }
  }
}
