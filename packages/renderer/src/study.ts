import { Container, Sprite, type Texture } from "pixi.js";
import {
  createSurface,
  loadTextures,
  releaseStudyTextures,
  cachedTextureCount,
} from "./surface.js";
import { attachCamera } from "./camera.js";
export type StudyLayer = {
  id: string;
  url: string;
  left: number;
  top: number;
  width: number;
  height: number;
  scale: number;
  depth: number;
  kind: string;
  decodedBytes: number;
  mask: string[];
};
export type StudyBuilding = {
  id: string;
  name: string;
  kind: string;
  story: string;
  screenAnchor: [number, number];
  detail: StudyLayer;
  body: number[];
  assembly: string;
};
export type StudyManifest = {
  version: string;
  studyOnly: true;
  width: number;
  height: number;
  layers: StudyLayer[];
  buildings: StudyBuilding[];
  baseDecodedBytes: number;
};
export function validateStudy(value: unknown): StudyManifest {
  const m = value as StudyManifest;
  const expectedBuildings =
    m?.version === "v04-neighborhood-study-01"
      ? 5
      : m?.version === "hearthside-hero-01"
        ? 3
        : 0;
  if (
    !expectedBuildings ||
    m.studyOnly !== true ||
    m.width !== 2560 ||
    m.height !== 1920 ||
    !Array.isArray(m.layers) ||
    !Array.isArray(m.buildings) ||
    m.buildings.length !== expectedBuildings
  )
    throw Error("Unsupported study fixture");
  for (const l of [...m.layers, ...m.buildings.map((b) => b.detail)])
    if (
      !l.url.startsWith(`/study-assets/${m.version}/`) ||
      !/^[a-z0-9.-]+\.png$/.test(l.url.split("/").at(-1) ?? "") ||
      l.url.split("/").length !== 4 ||
      ![l.left, l.top, l.width, l.height, l.scale, l.depth].every(
        Number.isFinite,
      ) ||
      l.width <= 0 ||
      l.height <= 0 ||
      !Array.isArray(l.mask) ||
      l.mask.length !== 32 ||
      l.mask.some((row) => !/^[01]{32}$/.test(row))
    )
      throw Error("Invalid study asset bounds or namespace");
  return m;
}
export async function mountStudy(
  host: HTMLElement,
  manifest: StudyManifest,
  onSelect: (id: string) => void,
) {
  const { app, software } = await createSurface(host);
  const scene = new Container();
  app.stage.addChild(scene);
  let textures: Record<string, Texture>;
  try {
    textures = await loadTextures(manifest.layers.map((l) => l.url));
  } catch (error) {
    app.destroy(true, { children: true, texture: false, textureSource: false });
    throw error;
  }
  const nodes = new Map<string, Sprite>();
  const ordered = [...manifest.layers].sort(
    (a, b) => a.depth - b.depth || a.id.localeCompare(b.id),
  );
  function apply(node: Sprite, layer: StudyLayer, texture: Texture) {
    node.texture = texture;
    node.position.set(layer.left, layer.top);
    node.scale.set(layer.scale);
  }
  for (const layer of ordered) {
    const node = new Sprite(textures[layer.url]);
    apply(node, layer, textures[layer.url]!);
    scene.addChild(node);
    nodes.set(layer.id, node);
  }
  let selected: string | null = null,
    detailUrl: string | null = null,
    detailBytes = 0,
    epoch = 0,
    disposed = false;
  function select(id: string) {
    const b = manifest.buildings.find((b) => b.id === id);
    if (!b) return;
    selected = id;
    onSelect(id);
    camera.invalidate();
  }
  const camera = attachCamera(app, scene, host, {
    bounds: { x: 0, y: 0, width: manifest.width, height: manifest.height },
    fitWidth:
      manifest.width * (manifest.version === "hearthside-hero-01" ? 1 : 0.86),
    fitHeight:
      manifest.height * (manifest.version === "hearthside-hero-01" ? 1 : 0.8),
    cover: manifest.version === "hearthside-hero-01",
    center: { x: manifest.width * 0.5, y: manifest.height * 0.53 },
    maxScale: 2.4,
    onTap(point) {
      for (const layer of [...ordered].reverse()) {
        if (layer.kind === "ground") continue;
        const box = nodes.get(layer.id)!.getBounds();
        const x = Math.floor(((point.x - box.x) / box.width) * 32),
          y = Math.floor(((point.y - box.y) / box.height) * 32);
        if (x < 0 || x >= 32 || y < 0 || y >= 32 || layer.mask[y]![x] !== "1")
          continue;
        if (layer.kind === "building") select(layer.id);
        break;
      }
    },
  });
  async function releaseDetail() {
    if (!detailUrl) return;
    const url = detailUrl;
    for (const b of manifest.buildings) {
      const base = manifest.layers.find((l) => l.id === b.id)!;
      apply(nodes.get(b.id)!, base, textures[base.url]!);
    }
    detailUrl = null;
    detailBytes = 0;
    await releaseStudyTextures([url]);
  }
  let operation: Promise<void> = Promise.resolve();
  function enqueue(work: () => Promise<void>) {
    const next = operation.then(work, work);
    operation = next.catch(() => {});
    return next;
  }
  function focus(id: string) {
    const b = manifest.buildings.find((b) => b.id === id);
    if (!b || disposed) return;
    select(id);
    const ticket = ++epoch;
    return enqueue(async () => {
      await releaseDetail();
      if (disposed || ticket !== epoch) return;
      const loaded = await loadTextures([b.detail.url]);
      if (disposed || ticket !== epoch) {
        await releaseStudyTextures([b.detail.url]);
        return;
      }
      detailUrl = b.detail.url;
      detailBytes = b.detail.decodedBytes;
      apply(nodes.get(id)!, b.detail, loaded[b.detail.url]!);
      const base = manifest.layers.find((l) => l.id === id)!;
      const width = base.width * base.scale,
        height = base.height * base.scale;
      camera.focus(
        { x: base.left + width / 2, y: base.top + height * 0.5 },
        Math.min(
          app.screen.width / (width * 1.35),
          app.screen.height / (height * 1.35),
          2.1,
        ),
      );
    });
  }
  function reset() {
    epoch++;
    return enqueue(async () => {
      await releaseDetail();
      if (!disposed) camera.reset();
    });
  }
  return {
    select,
    focus,
    reset,
    zoom: camera.zoom,
    stats: () => ({
      ...camera.stats(),
      renderer: software ? "WebGL2 SwiftShader/software" : "WebGL2",
      baseDecodedBytes: manifest.baseDecodedBytes,
      detailDecodedBytes: detailBytes,
      residentDecodedBytes: manifest.baseDecodedBytes + detailBytes,
      textureCount: manifest.layers.length + (detailUrl ? 1 : 0),
      cachedDetailTextures: cachedTextureCount(
        manifest.buildings.map((b) => b.detail.url),
      ),
      autoMipmapSources: [...nodes.values()].filter(
        (n) => n.texture.source.autoGenerateMipmaps,
      ).length,
      canvasPixels: [app.canvas.width, app.canvas.height],
      selected,
      focused: detailUrl !== null,
    }),
    async destroy() {
      disposed = true;
      epoch++;
      camera.destroy();
      await operation;
      await releaseDetail();
      app.destroy(true, {
        children: true,
        texture: false,
        textureSource: false,
      });
      await releaseStudyTextures(manifest.layers.map((l) => l.url));
    },
  };
}
