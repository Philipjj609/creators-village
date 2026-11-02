import { createEnvironmentArt } from "./environment-art.js";
import {
  tileFill,
  material,
  shade,
  woodlandOverlay,
  shoreOverlay,
  drawPaths,
  type Exclusion,
} from "./terrain-art.js";
import { vegetationScale } from "./vegetation.js";
import { renderDelta } from "./reconcile.js";
import { createPlacementPreview, type PlacementPreview } from "./placement.js";
import { TERRAIN_STYLE, coastEdges } from "./terrain-style.js";
import { registerPick, pickVisible } from "./picking.js";
import { attachAmbient } from "./ambient.js";
import {
  ART,
  ASSET_SCALE,
  createArtLibrary,
  artSprite,
  visualFit,
} from "./art.js";
import { projectSelection } from "./selection.js";
import type { WorldSelection } from "./selection.js";
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
import { terrainWindow } from "./viewport-bounds.js";
import { terrainProject, pickGround } from "./founding-projection.js";
import { attachResidents, type LivingViewState } from "./living.js";
import { constructionView } from "@creators-village/contracts";

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
  onFollowChange?: (id: string | null) => void,
  isPlanning?: () => boolean,
  onHoverTerrain?: (sample: { x: number; y: number; height: number }) => void,
  onCancelPlacement?: () => boolean,
) {
  const mountBegan = performance.now();
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
  const art = await createArtLibrary();
  const shelterModel = art.bundle(ART.shelter).buildings![0]!;
  const shelterLayer = art
    .bundle(ART.shelter)
    .layers!.find((l) => l.url === "shelter.png")!;
  const [shelterTexture, treeSheet, coniferSheet] = await Promise.all([
    art.texture(ART.shelter, "shelter.png"),
    art.sheet(ART.trees),
    art.sheet(ART.conifers),
  ]);
  if (!b || !layer || !tree || manifest.version !== "hearthside-hero-01")
    throw Error("Unsupported pinned asset bundle");
  const { app, software, renderStats } = await createSurface(host),
    scene = new Container();
  app.stage.addChild(scene);
  const extraSprites = new Map<string, Sprite>();
  const constructionSites = new Map<
    string,
    { node: Container; view: ReturnType<typeof constructionView> }
  >();
  const treePlacements: {
    x: number;
    y: number;
    height: number;
    canopy: number;
    blossom: boolean;
  }[] = [];
  const buildingPlacements: {
    id: string;
    asset: string;
    x: number;
    y: number;
    height: number;
    fit: number;
  }[] = [
    {
      id: world.structure.id,
      asset: "shelter",
      x: 0,
      y: 0,
      height: world.structure.height,
      fit: 1,
    },
  ];
  let residentTopology = "";
  const preview = new Graphics();
  let current: Wf2State | null = null,
    extraBaseBytes = 0,
    extraDetail: Sprite | null = null,
    extraDetailBytes = 0;
  let currentGeometry = "",
    currentGeneration = 0;
  let disposed = false,
    sequence = 0,
    busy = false;
  const cache = new Map<string, TerrainChunk>();
  let heightReader = terrainReader(world.baseline, []);
  const terrain = new Container(),
    objects = new Container();
  objects.sortableChildren = true;
  const groundBand = new Container(),
    naturalShadows = new Container(),
    buildingShadows = new Container(),
    residentShadows = new Container(),
    siteShadows = new Container();
  groundBand.addChild(
    naturalShadows,
    buildingShadows,
    residentShadows,
    siteShadows,
  );
  const environment = await createEnvironmentArt(art, app, () =>
    camera.invalidate(),
  );
  const siteGround = new Container();
  const placementFloor = new Graphics();
  scene.addChild(
    terrain,
    environment.ground,
    siteGround,
    environment.shadows,
    groundBand,
    environment.bodies,
    preview,
    placementFloor,
    objects,
  );
  // Authoritative 3x2 open notice shelter; the 6x6 residential lodge is a different family.
  const shelter = new Sprite(shelterTexture);
  const assetScale = ASSET_SCALE;
  const anchor = terrainProject(0, 0, world.structure.height);
  shelter.position.set(
    anchor.x + (shelterLayer.left - shelterModel.screenAnchor[0]!) * assetScale,
    anchor.y + (shelterLayer.top - shelterModel.screenAnchor[1]!) * assetScale,
  );
  shelter.scale.set(shelterLayer.scale * assetScale);
  const sl = art
    .bundle(ART.shelter)
    .layers!.find((l) => l.url === "shelter-shadow.png")!;
  const ss = new Sprite(await art.texture(ART.shelter, sl.url));
  ss.position.set(
    anchor.x + (sl.left - shelterModel.screenAnchor[0]!) * assetScale,
    anchor.y + (sl.top - shelterModel.screenAnchor[1]!) * assetScale,
  );
  ss.scale.set(sl.scale * assetScale);
  ss.alpha = 0.45;
  buildingShadows.addChild(ss);
  registerPick(shelter, world.structure.id);
  objects.addChild(shelter);
  let detail: Sprite | null = null;
  const marker = new Graphics();
  objects.addChild(marker);
  let skippedGroundUpdates = 0,
    streamRequests = 0,
    streamBytes = 0,
    streamMs = 0;
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
    const scale = scene.scale.x || 1;
    const { centerX, centerY, radius, x0, x1, y0, y1, cells } = terrainWindow(
      app.screen.width,
      app.screen.height,
      scene.x,
      scene.y,
      scale,
      world.baseline,
    );
    const step = scale < 0.35 ? 4 : scale < 0.8 ? 2 : 1;
    const key = `${x0},${x1},${y0},${y1},${step},${cells.x0},${cells.x1},${cells.y0},${cells.y1}`;
    if (key === lastKey && !force) return;
    lastKey = key;
    busy = true;
    const epoch = ++sequence;
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
        const requestBegan = performance.now();
        const response = await fetch(
          `/api/founding/${encodeURIComponent(world.id)}/chunks?keys=${encodeURIComponent(missing.slice(i, i + 64).join(";"))}`,
        );
        if (!response.ok) throw Error("Terrain unavailable");
        const text = await response.text();
        streamRequests++;
        streamBytes += new TextEncoder().encode(text).length;
        streamMs += performance.now() - requestBegan;
        const data = JSON.parse(text) as {
          baselineHash: string;
          chunks: TerrainChunk[];
        };
        if (data.baselineHash !== world.baseline.hash)
          throw Error("Terrain version mismatch");
        for (const c of data.chunks) cache.set(`${c.x},${c.y}`, c);
      }
      if (disposed || epoch !== sequence) return;
      const cpuBegan = performance.now();
      for (const c of terrain.removeChildren()) c.destroy({ children: true });
      for (const c of naturalShadows.removeChildren()) c.destroy();
      treePlacements.length = 0;
      const retained = new Set<Container>([
        shelter,
        marker,
        placement.node,
        ...living.nodes(),
        ...ambient.nodes(),
        ...extraSprites.values(),
        ...[...constructionSites.values()].map((s) => s.node),
      ]);
      if (detail) retained.add(detail);
      if (extraDetail) retained.add(extraDetail);
      for (const c of objects.removeChildren())
        if (!retained.has(c)) c.destroy();
      objects.addChild(placement.node);
      objects.addChild(shelter);
      if (detail) objects.addChild(detail);
      objects.addChild(marker);
      for (const s of extraSprites.values()) objects.addChild(s);
      if (extraDetail) objects.addChild(extraDetail);
      for (const node of living.nodes()) objects.addChild(node);
      for (const node of ambient.nodes()) objects.addChild(node);
      renderedChunks = 0;
      triangles = 0;
      treeCount = 0;
      const read = terrainReader(world.baseline, [...cache.values()]),
        items: { node: Container; depth: number }[] = [];
      heightReader = read;
      const rockFeatures = new Graphics();
      for (const k of needed) {
        const c = cache.get(k)!,
          g = new Graphics();
        terrain.addChild(g);
        renderedChunks++;
        const drawCell = (xx: number, yy: number, size: number) => {
          const x = c.x * 32 + xx,
            y = c.y * 32 + yy;
          if (x < cells.x0 || x >= cells.x1 || y < cells.y0 || y >= cells.y1)
            return;
          const flag = c.cells[yy * 32 + xx]!,
            wet = !!(flag & WATER);
          // Never classify a coarse block from one corner when it crosses a real coastline.
          if (size > 1) {
            let mixed = false;
            for (let dy = 0; dy < size; dy++)
              for (let dx = 0; dx < size; dx++)
                if (!!(c.cells[(yy + dy) * 32 + xx + dx]! & WATER) !== wet)
                  mixed = true;
            if (mixed) {
              for (let dy = 0; dy < size; dy++)
                for (let dx = 0; dx < size; dx++) drawCell(xx + dx, yy + dy, 1);
              return;
            }
          }
          const z = (dx: number, dy: number) =>
            wet
              ? TERRAIN_STYLE.waterLevel
              : c.heights[(yy + dy) * 33 + xx + dx]! / 16;
          const a = terrainProject(x, y, z(0, 0)),
            b = terrainProject(x + size, y, z(size, 0)),
            d = terrainProject(x + size, y + size, z(size, size)),
            e = terrainProject(x, y + size, z(0, size));
          const waterNeighbors = [
            [-1, 0],
            [1, 0],
            [0, -1],
            [0, 1],
          ].filter(([dx, dy]) => {
            const f = read.cell(x + dx!, y + dy!);
            return f !== 255 && !!(f & WATER);
          }).length;
          const fill = tileFill(
            environment.tex[material(flag)]!,
            wet
              ? waterNeighbors < 4
                ? 0xf2fffc
                : 0xffffff
              : shade(x, y, z(size, 0) - z(0, 0)),
          );
          g.poly([a.x, a.y, b.x, b.y, d.x, d.y]).fill(fill);
          g.poly([a.x, a.y, d.x, d.y, e.x, e.y]).fill(fill);
          triangles += 2;
        };
        for (let yy = 0; yy < 32; yy += step)
          for (let xx = 0; xx < 32; xx += step) drawCell(xx, yy, step);
        // Exposed bank faces bridge actual land edge elevations to the fixed water plane.
        // They never change height queries, navigability, flags or world boundaries.
        for (let yy = 0; yy < 32; yy++)
          for (let xx = 0; xx < 32; xx++) {
            const x = c.x * 32 + xx,
              y = c.y * 32 + yy;
            if (x < cells.x0 || x >= cells.x1 || y < cells.y0 || y >= cells.y1)
              continue;
            for (const edge of coastEdges(x, y, read.cell)) {
              const [u, v] = edge.corners;
              const a = terrainProject(
                x + u![0]!,
                y + u![1]!,
                c.heights[(yy + u![1]!) * 33 + xx + u![0]!]! / 16,
              );
              const b = terrainProject(
                x + v![0]!,
                y + v![1]!,
                c.heights[(yy + v![1]!) * 33 + xx + v![0]!]! / 16,
              );
              const d = terrainProject(
                x + v![0]!,
                y + v![1]!,
                TERRAIN_STYLE.waterLevel,
              );
              const e = terrainProject(
                x + u![0]!,
                y + u![1]!,
                TERRAIN_STYLE.waterLevel,
              );
              g.poly([a.x, a.y, b.x, b.y, d.x, d.y, e.x, e.y]).fill(
                tileFill(environment.tex.bank!, 0xffffff),
              );
            }
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
              const variant =
                Math.abs(
                  Math.imul(Math.floor(x), 73856093) ^
                    Math.imul(Math.floor(y), 19349663),
                ) % 10;
              const id =
                variant === 0
                  ? "blossom"
                  : variant === 1
                    ? "pine-small"
                    : [
                        "oak-round",
                        "oak-tall",
                        "oak-wide",
                        "oak-young",
                        "oak-old",
                        "oak-round-autumn",
                        "oak-wide-autumn",
                        "oak-twin",
                      ][variant - 2]!;
              const sheet = variant < 2 ? coniferSheet : treeSheet;
              const n = artSprite(sheet.textures[id]!, 2, vegetationScale(id)),
                shadow = artSprite(
                  sheet.textures[id + "-shadow"]!,
                  4,
                  vegetationScale(id),
                );
              shadow.alpha = 0.45;
              registerPick(n, null);
              n.position.set(p.x, p.y);
              shadow.position.set(p.x, p.y);
              naturalShadows.addChild(shadow);
              items.push({ node: n, depth: x + y });
              treePlacements.push({
                x,
                y,
                height: read.height(x, y) ?? 0,
                canopy:
                  (variant < 2
                    ? art.bundle(ART.conifers).assets!.find((a) => a.id === id)!
                        .boundsLogical!.max[2]!
                    : art.bundle(ART.trees).variants!.find((a) => a.id === id)!
                        .height) * vegetationScale(id),
                blossom: id === "blossom",
              });
              treeCount++;
            }
          }
      }
      terrain.addChild(rockFeatures);
      const allPaths = current
        ? current.paths.map((p) => ({
            width: p.widthQ / 256,
            points: p.points.map((v) => ({ x: v.qx / 256, y: v.qy / 256 })),
          }))
        : [world.path];
      const win = cells;
      const woodland = woodlandOverlay(read, environment.tex, win);
      if (woodland) terrain.addChild(woodland);
      const shores = shoreOverlay(read, environment.tex, win);
      for (const n of shores.meshes) if (n) terrain.addChild(n);
      terrain.addChild(
        drawPaths(read, environment.tex, allPaths, { provisional: false }),
      );
      const exclusions: Exclusion[] = [
        { x: -1.5, y: -1, width: 3, depth: 2 },
        { x: -0.75, y: 1, width: 1.5, depth: 1 },
      ];
      for (const st of current?.structures ?? [])
        exclusions.push({
          x: st.position.qx / 256,
          y: st.position.qy / 256,
          width: st.footprint.widthQ / 256,
          depth: st.footprint.depthQ / 256,
        });
      for (const pr of current?.projects ?? [])
        if (pr.state !== "draft" && pr.state !== "cancelled") {
          exclusions.push(
            {
              x: pr.site.qx / 256 - 3,
              y: pr.site.qy / 256 - 3,
              width: 6,
              depth: 6,
            },
            {
              x: pr.site.qx / 256 - 0.75,
              y: pr.site.qy / 256 + 3,
              width: 1.5,
              depth: 1,
            },
          );
        }
      for (const path of allPaths)
        for (let i = 1; i < path.points.length; i++) {
          const a = path.points[i - 1]!,
            b = path.points[i]!,
            d = path.width / 2 + 0.25;
          exclusions.push({
            x: Math.min(a.x, b.x) - d,
            y: Math.min(a.y, b.y) - d,
            width: Math.abs(a.x - b.x) + 2 * d,
            depth: Math.abs(a.y - b.y) + 2 * d,
          });
        }
      environment.rebuild(read, win, exclusions, step, (x, y) => {
        const p = scene.toGlobal(
          terrainProject(
            x,
            y,
            read.cell(Math.floor(x), Math.floor(y)) & 1
              ? 0.5
              : (read.height(x, y) ?? 0),
          ),
        );
        return (
          p.x >= -100 &&
          p.x <= app.screen.width + 100 &&
          p.y >= -160 &&
          p.y <= app.screen.height + 160
        );
      });
      for (const site of constructionSites.values())
        items.push({
          node: site.node,
          depth: (site.view.center.qx + site.view.center.qy) / 256,
        });
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
      ambient.refresh();
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
    fitWidth: 1700,
    fitHeight: 1100,
    center: { x: 0, y: 0 },
    maxScale: 2.6,
    minOverviewScale: Math.max(
      0.34,
      app.screen.width / 5600,
      app.screen.height / 3600,
    ),
    cover: true,
    onExplore: () => living.cancelFollow(),
    onHover(p) {
      if (!isPlanning?.()) return;
      const point = scene.toLocal(p),
        sample = pickGround(point.x, point.y, heightReader);
      if (sample) onHoverTerrain?.(sample);
    },
    onContextMenu: () => onCancelPlacement?.() ?? false,
    onTap(p) {
      const hit = !isPlanning?.() ? pickVisible(objects, p) : null;
      if (hit?.id) {
        onSelect(hit.id);
        return;
      }
      const point = scene.toLocal(p);
      {
        const sample = pickGround(
          point.x,
          point.y,
          terrainReader(world.baseline, [...cache.values()]),
        );
        if (!isPlanning?.()) onSelect(undefined);
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
  const placement = createPlacementPreview(
    art,
    objects,
    placementFloor,
    (x, y) => heightReader.height(x, y),
    () => camera.invalidate(),
  );
  const living = attachResidents(
    app,
    objects,
    world,
    host,
    camera,
    art,
    residentShadows,
    (id) => onSelect(id),
    onLiving,
    focusViewport,
    (x, y) => heightReader.height(x, y),
    (id) => {
      host.dataset.followingResident = id ?? "";
      onFollowChange?.(id);
    },
  );
  const ambient = attachAmbient(
    app,
    scene,
    objects,
    host,
    art,
    treePlacements,
    buildingPlacements,
    () => camera.invalidate(),
  );
  let selectedObject: WorldSelection | null = null;
  function selectionPoint(ref: WorldSelection) {
    if (ref.kind === "structure") {
      if (ref.id === world.structure.id)
        return { x: anchor.x, y: anchor.y - 35 };
      const st = current?.structures.find((v) => v.id === ref.id);
      if (st) {
        const p = terrainProject(
          (st.position.qx + st.footprint.widthQ / 2) / 256,
          (st.position.qy + st.footprint.depthQ / 2) / 256,
          st.position.height / 16,
        );
        return { x: p.x, y: p.y - 35 };
      }
    }
    if (ref.kind === "site") {
      const pr = current?.projects.find((v) => v.id === ref.id);
      if (pr && pr.state !== "cancelled" && pr.state !== "draft") {
        const p = terrainProject(
          pr.site.qx / 256,
          pr.site.qy / 256,
          pr.site.baseHeight / 16,
        );
        return { x: p.x, y: p.y - 25 };
      }
    }
    return null;
  }
  function setSelection(ref: WorldSelection | null) {
    const key = ref ? ref.kind + ":" + ref.id : "";
    if (host.dataset.selectedObject !== key) {
      host.dataset.focusedObject = "";
      host.dataset.selectedScreenBounds = "";
    }
    selectedObject = ref;
    projectSelection(
      ref,
      () => marker.clear(),
      (id) => living.select(id),
      (r) => {
        const p = selectionPoint(r);
        if (p)
          marker
            .ellipse(p.x, p.y + 30, 65, 26)
            .stroke({ color: 0xf7e0a3, width: 3 });
      },
    );
    host.dataset.selectedObject = ref ? ref.kind + ":" + ref.id : "";
    camera.invalidate();
  }
  function select() {
    marker
      .clear()
      .ellipse(anchor.x, anchor.y, 65, 26)
      .stroke({ color: 0xf7e9b9, width: 3 });
    camera.invalidate();
  }
  const update = () => {
    void refresh();
    if (selectedObject) {
      const bounds =
        selectedObject.kind === "resident"
          ? living
              .stats()
              .residentScreenBounds.find((v) => v.id === selectedObject!.id)
          : (() => {
              const ref = selectedObject!;
              const node =
                ref.kind === "site"
                  ? (constructionSites.get(ref.id)?.node ??
                    extraSprites.get("wf2-workshop-" + ref.id))
                  : ref.id === world.structure.id
                    ? (detail ?? shelter)
                    : extraDetail?.label === ref.id
                      ? extraDetail
                      : extraSprites.get(ref.id);
              const b = node?.getBounds();
              return b
                ? { x: b.x, y: b.y, width: b.width, height: b.height }
                : null;
            })();
      host.dataset.selectedScreenBounds = bounds ? JSON.stringify(bounds) : "";
    } else host.dataset.selectedScreenBounds = "";
  };
  app.ticker.add(update);
  await refresh(true);
  if (host.dataset.terrainError) {
    environment.destroy();
    living.destroy();
    ambient.destroy();
    camera.destroy();
    app.destroy(true, { children: true });
    throw Error("Terrain unavailable");
  }
  const initialArtReadyMs = performance.now() - mountBegan;
  host.dataset.artInitialMs = String(initialArtReadyMs);
  let detailRequest = 0;
  const detailed = new WeakSet<Sprite>();
  let focusedDetailLoads = 0;
  async function ensureDetail(ref: WorldSelection) {
    if (ref.kind === "resident") return;
    let node: Sprite | undefined,
      family: string,
      id: string,
      origin: { x: number; y: number };
    if (ref.kind === "structure" && ref.id === world.structure.id) {
      node = shelter;
      family = ART.shelter;
      id = "shelter";
      origin = anchor;
    } else if (ref.kind === "site" && constructionSites.has(ref.id)) {
      const site = constructionSites.get(ref.id)!;
      node = site.node.children.find((c): c is Sprite => c instanceof Sprite);
      family = ART.construction;
      id = site.view.phase === "foundation" ? "foundation" : "framing";
      origin = terrainProject(
        site.view.center.qx / 256,
        site.view.center.qy / 256,
        site.view.height / 16,
      );
    } else {
      const structure = current?.structures.find(
        (s) =>
          s.id === (ref.kind === "site" ? "wf2-workshop-" + ref.id : ref.id),
      );
      if (!structure) return;
      node = extraSprites.get(structure.id);
      family = ART.workshop;
      id = "workshop";
      origin = terrainProject(
        (structure.position.qx + structure.footprint.widthQ / 2) / 256,
        (structure.position.qy + structure.footprint.depthQ / 2) / 256,
        structure.position.height / 16,
      );
    }
    if (!node || detailed.has(node)) return;
    const model =
      art.bundle(family).buildings!.find((b) => b.id === id) ??
      art.bundle(family).buildings![0]!;
    const layer = model.detail,
      request = ++detailRequest;
    try {
      const texture = await art.texture(family, layer.url);
      if (disposed || node.destroyed || request !== detailRequest) return;
      node.texture = texture;
      node.position.set(
        origin.x + (layer.left - model.screenAnchor[0]!) * assetScale,
        origin.y + (layer.top - model.screenAnchor[1]!) * assetScale,
      );
      node.scale.set(layer.scale * assetScale);
      detailed.add(node);
      focusedDetailLoads++;
      camera.invalidate();
    } catch {
      /* Optional focus detail failure retains the verified base artwork and working selection. */
    }
  }
  function frameDetail(sprite: Sprite) {
    const frame = focusViewport?.() ?? {
      x: 16,
      y: 16,
      width: host.clientWidth - 32,
      height: host.clientHeight - 32,
    };
    const scale = Math.min(
      2.2,
      frame.width / Math.max(1, sprite.width),
      frame.height / Math.max(1, sprite.height),
    );
    const bounds = sprite.getBounds(),
      center = scene.toLocal({
        x: bounds.x + bounds.width / 2,
        y: bounds.y + bounds.height / 2,
      });
    camera.focus(center, scale, {
      x: frame.x + frame.width / 2,
      y: frame.y + frame.height / 2,
    });
  }
  async function focus() {
    living.cancelFollow();
    clearExtraDetail();
    select();
    frameDetail(shelter);
    void ensureDetail({ kind: "structure", id: world.structure.id });
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
    previewPlacement: (value: PlacementPreview) => placement.set(value),
    setSelection,
    focusSelection(ref: WorldSelection, mode: "frame" | "nudge" = "frame") {
      if (mode === "frame") void ensureDetail(ref);
      host.dataset.focusedObject = ref.kind + ":" + ref.id;
      if (ref.kind === "resident") living.locate(ref.id, mode);
      else {
        const node =
          ref.kind === "structure"
            ? ref.id === world.structure.id
              ? (detail ?? shelter)
              : extraDetail?.label === ref.id
                ? extraDetail
                : extraSprites.get(ref.id)
            : ref.kind === "site"
              ? (constructionSites.get(ref.id)?.node ??
                extraSprites.get("wf2-workshop-" + ref.id))
              : undefined;
        const p = selectionPoint(ref),
          f = focusViewport?.() ?? {
            x: 16,
            y: 16,
            width: host.clientWidth - 32,
            height: host.clientHeight - 32,
          };
        if (node) {
          const b = node.getBounds(),
            center = scene.toLocal({
              x: b.x + b.width / 2,
              y: b.y + b.height / 2,
            });
          camera.locate(center, f, mode, 1.4, {
            width: b.width / scene.scale.x,
            height: b.height / scene.scale.x,
          });
        } else if (
          p &&
          ref.kind === "site" &&
          current?.projects.find((p) => p.id === ref.id)?.state !== "cancelled"
        )
          camera.locate(p, f, mode, 1.4);
      }
    },
    followResident(id: string | null) {
      if (id) living.focus(id);
      else living.cancelFollow();
    },
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
    focusProject(id: string) {
      const p = current?.projects.find((p) => p.id === id);
      if (!p) return;
      reset();
      const a = terrainProject(
        p.site.qx / 256,
        p.site.qy / 256,
        p.site.baseHeight / 16,
      );
      const frame = focusViewport?.();
      camera.focus(
        { x: a.x, y: a.y - 30 },
        1.6,
        frame
          ? { x: frame.x + frame.width / 2, y: frame.y + frame.height / 2 }
          : undefined,
      );
    },
    previewPlan(plan: Wf2State["projects"][number] | null) {
      preview.clear();
      host.dataset.planPreview = plan?.id ?? "";
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
      const exclusionKey = (v: Wf2State | null) =>
        JSON.stringify(
          v?.projects
            .filter((p) => p.state !== "draft" && p.state !== "cancelled")
            .map((p) => [p.id, p.site]),
        );
      const exclusionsChanged = exclusionKey(current) !== exclusionKey(state);
      const { pathsChanged, newlyCompleted } = renderDelta(current, state);
      current = state;
      const geometry = JSON.stringify([
        state.topologyEpoch,
        state.structures.map((s) => [s.id, s.revision]),
        state.paths.map((p) => [p.id, p.revision]),
        state.projects.map((p) => [p.id, p.revision, p.state, p.acceptedCount]),
      ]);
      if (geometry === currentGeometry) return;
      currentGeometry = geometry;
      const generation = ++currentGeneration;
      const topology = JSON.stringify([
        state.topologyEpoch,
        state.structures.map((s) => [s.id, s.revision]),
      ]);
      if (topology !== residentTopology) {
        residentTopology = topology;
        void living.reload().then(() => {
          for (const p of newlyCompleted) living.reactToCompletion(p.id);
        });
      }
      const stages = new Set(
        state.projects
          .map((p) => constructionView(p, state.structures).phase)
          .filter(
            (p) =>
              p === "foundation" ||
              p === "building" ||
              p === "awaiting-structure",
          )
          .map((p) => (p === "foundation" ? "foundation" : "framing")),
      );
      const stageTextures = new Map<string, Texture>();
      await Promise.all(
        [...stages].flatMap((stage) =>
          ["", "-ground", "-shadow"].map(async (suffix) => {
            const file = stage + suffix + ".png";
            stageTextures.set(file, await art.texture(ART.construction, file));
          }),
        ),
      );
      if (disposed || generation !== currentGeneration) return;
      for (const parent of [siteShadows, siteGround])
        for (const c of parent.removeChildren()) c.destroy();
      for (const site of constructionSites.values())
        site.node.destroy({ children: true });
      constructionSites.clear();
      for (const project of state.projects) {
        const v = constructionView(project, state.structures);
        if (!["foundation", "building", "awaiting-structure"].includes(v.phase))
          continue;
        if (
          project.template !== "wf2-workshop-1" ||
          v.footprint.widthQ !== 1536 ||
          v.footprint.depthQ !== 1536
        )
          throw Error("Construction art footprint mismatch");
        const stage = v.phase === "foundation" ? "foundation" : "framing",
          model = art
            .bundle(ART.construction)
            .buildings!.find((b) => b.id === stage)!;
        const origin = terrainProject(
          v.center.qx / 256,
          v.center.qy / 256,
          v.height / 16,
        );
        const node = new Container();
        node.zIndex = (v.center.qx + v.center.qy) / 256;
        node.label = "project:" + project.id;
        for (const suffix of ["-ground", "-shadow", ""]) {
          const l = art
            .bundle(ART.construction)
            .layers!.find((l) => l.url === stage + suffix + ".png")!;
          const n = new Sprite(stageTextures.get(l.url)!);
          n.position.set(
            origin.x + (l.left - model.screenAnchor[0]!) * assetScale,
            origin.y + (l.top - model.screenAnchor[1]!) * assetScale,
          );
          n.scale.set(l.scale * assetScale);
          if (suffix === "-shadow") {
            n.alpha = 0.45;
            siteShadows.addChild(n);
          } else if (suffix === "-ground") siteGround.addChild(n);
          else {
            node.addChild(n);
          }
        }
        // Picking walks the painter-ordered children of objects. Register the
        // place container, whose visible geometry is the framing/foundation sprite.
        registerPick(node, node.label);
        constructionSites.set(project.id, { node, view: v });
        objects.addChild(node);
      }
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
        if (s.footprint.widthQ !== 1536 || s.footprint.depthQ !== 1536)
          throw Error("Workshop visual footprint mismatch");
        const model = art.bundle(ART.workshop).buildings![0]!,
          l = art
            .bundle(ART.workshop)
            .layers!.find((l) => l.url === "workshop.png")!,
          shadowLayer = art
            .bundle(ART.workshop)
            .layers!.find((l) => l.url === "workshop-shadow.png")!;
        const [texture, shadowTexture] = await Promise.all([
          art.texture(ART.workshop, l.url),
          art.texture(ART.workshop, shadowLayer.url),
        ]);
        if (disposed || generation !== currentGeneration) return;
        const node = new Sprite(texture),
          p = terrainProject(
            (s.position.qx + s.footprint.widthQ / 2) / 256,
            (s.position.qy + s.footprint.depthQ / 2) / 256,
            s.position.height / 16,
          );
        node.position.set(
          p.x + (l.left - model.screenAnchor[0]!) * assetScale,
          p.y + (l.top - model.screenAnchor[1]!) * assetScale,
        );
        node.scale.set(l.scale * assetScale);
        node.zIndex =
          (s.position.qx +
            s.position.qy +
            s.footprint.widthQ / 2 +
            s.footprint.depthQ / 2) /
          256;
        const shadow = new Sprite(shadowTexture);
        shadow.alpha = 0.45;
        shadow.position.set(
          p.x + (shadowLayer.left - model.screenAnchor[0]!) * assetScale,
          p.y + (shadowLayer.top - model.screenAnchor[1]!) * assetScale,
        );
        shadow.scale.set(shadowLayer.scale * assetScale);
        buildingShadows.addChild(shadow);
        buildingPlacements.push({
          id: s.id,
          asset: "workshop",
          x: (s.position.qx + s.footprint.widthQ / 2) / 256,
          y: (s.position.qy + s.footprint.depthQ / 2) / 256,
          height: s.position.height / 16,
          fit: 1,
        });
        registerPick(node, s.id);
        extraSprites.set(s.id, node);
        extraBaseBytes = l.decodedBytes + shadowLayer.decodedBytes;
        objects.addChild(node);
      }
      if (pathsChanged || exclusionsChanged) {
        lastKey = "";
        await refresh(true);
      } else {
        skippedGroundUpdates++;
        ambient.refresh();
      }
      setSelection(selectedObject);
      camera.invalidate();
    },
    async focusStructure(id: string) {
      if (id === world.structure.id) return focus();
      const node = extraSprites.get(id);
      if (!node) throw Error("Unknown structure");
      reset();
      frameDetail(node);
      void ensureDetail({ kind: "structure", id });
    },
    zoom: (factor: number) => {
      living.cancelFollow();
      camera.zoom(factor);
    },
    stats: () => ({
      ...camera.stats(),
      ...renderStats(),
      ...living.stats(),
      ...art.stats(),
      initialArtReadyMs,
      focusedDetailLoads,
      artResourceTimings: performance
        .getEntriesByType("resource")
        .filter((e) => e.name.includes("/assets/cv-"))
        .map((e) => ({
          url: new URL(e.name).pathname,
          durationMs: e.duration,
          transferBytes: (e as PerformanceResourceTiming).transferSize,
          encodedBytes: (e as PerformanceResourceTiming).encodedBodySize,
        })),
      ...ambient.stats(),
      ...environment.stats(),
      structureArtwork: [
        {
          id: world.structure.id,
          family: ART.shelter,
          footprint: [world.structure.width, world.structure.depth],
          instances: objects.children.filter((n) => n === shelter).length,
        },
        ...[...extraSprites].map(([id, node]) => ({
          id,
          family: ART.workshop,
          instances: objects.children.filter((n) => n === node).length,
        })),
      ],
      selectedObject,
      objectSelectionRings: marker.context.instructions.length ? 1 : 0,
      constructionViewVersion: "cv-construction-1",
      constructionSites: [...constructionSites.values()].map((s) => ({
        ...s.view,
        screenBounds: (() => {
          const b = s.node.getBounds();
          return { x: b.x, y: b.y, width: b.width, height: b.height };
        })(),
      })),
      constructionTextureBytes: art.decodedBytes(ART.construction),
      constructionArt:
        "AP4 foundation/framing at authoritative site; workshop-03 on saved completion",
      renderer: software ? "software WebGL2" : "WebGL2",
      skippedGroundUpdates,
      streamRequests,
      streamDecodedJsonBytes: streamBytes,
      streamTotalMs: streamMs,
      renderedChunks,
      triangles,
      treeCount,
      residentChunks: cache.size,
      residentTerrainPayloadBytes: cache.size * 3202,
      cpuRebuildMs,
      maxCpuRebuildMs,
      rebuildCount,
      chunkKeys: residentKeys,
      decodedBytes: art.stats().artDecodedBytes,
      terrainStyle: TERRAIN_STYLE.version,
      baselineHash: world.baseline.hash,
      terrainError: host.dataset.terrainError ?? null,
    }),
    destroy() {
      disposed = true;
      ++sequence;
      ++detailRequest;
      placement.destroy();
      living.destroy();
      ambient.destroy();
      environment.destroy();
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
