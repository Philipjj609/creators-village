import { preparePicking, pickingStats } from "./picking.js";
import { Assets, Sprite, type Spritesheet, type Texture } from "pixi.js";

export const ART = {
  shelter: "cv-artlab-ap4-shelter-01",
  construction: "cv-artlab-ap4-construction-01",
  terrain: "cv-artlab-ap4-terrain-01",
  structures: "cv-artlab-batch-a-structures-02",
  civic: "cv-artlab-batch-b-structures-02",
  workshop: "cv-artlab-ve01-workshop-03",
  cast: "cv-artlab-cast-02",
  trees: "cv-artlab-ve02-broadleaf-01",
  conifers: "cv-artlab-batch-c-vegetation-01",
  props: "cv-artlab-batch-c-props-01",
  effects: "cv-artlab-batch-c-effects-01",
  ambient: "cv-artlab-ambient-02",
  windmill: "cv-artlab-windmill-01",
} as const;
export const ASSET_SCALE = 32 / (2560 / 22 / Math.sqrt(2));
type Page = {
  image: string;
  spritesheet: string;
  decodedBytes: number;
  character?: string;
  group?: string;
};
export type ArtAsset = {
  id: string;
  frame: string;
  shadowFrame: string;
  renderScale: number;
  shadowRenderScale: number;
  footprint?: { envelope: { width: number; depth: number } };
  emitters?: Record<string, number[][]>;
  boundsLogical?: { max: number[] };
};
export type Cast = {
  id: string;
  renderScale: number;
  shadowRenderScale: number;
  locomotion: { strideUnits: number };
  animations: Record<
    string,
    { fps: number; frames: number; directions: string[] }
  >;
};
export type Layer = {
  url: string;
  left: number;
  top: number;
  scale: number;
  decodedBytes: number;
};
type Bundle = {
  pages?: Page[];
  atlas?: Page;
  assets?: ArtAsset[];
  cast?: Cast[];
  variants?: {
    id: string;
    frame: string;
    shadowFrame: string;
    height: number;
  }[];
  layers?: Layer[];
  decor?: {
    items: Record<
      string,
      {
        frame: string;
        kind: string;
        renderScale: number;
        shadowFrame?: string;
        shadowRenderScale?: number;
      }
    >;
  };
  buildings?: {
    id?: string;
    screenAnchor: number[];
    detail: Layer;
    emitters: Record<string, number[][]>;
  }[];
};
type Catalog = {
  version: string;
  bundles: Record<string, Bundle>;
  files: { url: string; sha256: string; decodedBytes?: number }[];
};
let catalogPromise: Promise<Catalog> | null = null;
const loads = new Map<string, Promise<unknown>>();
const decoded = new Map<string, number>();
export const artUrl = (bundle: string, file: string) =>
  `/assets/${bundle}/${file}`;
export function artCatalog() {
  return (catalogPromise ??= fetch("/assets/cv-ap4-01/catalog.json")
    .then(async (r) => {
      if (!r.ok) throw Error("Village art catalogue unavailable");
      const c = (await r.json()) as Catalog;
      if (c.version !== "cv-ap4-01")
        throw Error("Village art version mismatch");
      return c;
    })
    .catch((e) => {
      catalogPromise = null;
      throw e;
    }));
}
/** Immutable, deduplicated Pixi cache. A fixed set of used pages is retained across world visits;
 * unused builder/visitor/zone pages are never requested. Display nodes remain scene-owned. */
export async function createArtLibrary() {
  const catalog = await artCatalog(),
    own = new Set<string>();
  const began = performance.now();
  let readyMs = 0;
  async function load<T>(url: string): Promise<T> {
    const firstRequest = !own.has(url);
    own.add(url);
    if (!loads.has(url))
      loads.set(
        url,
        Assets.load(url)
          .then((value) => {
            const file = catalog.files.find((f) => f.url === url);
            if (file?.decodedBytes) decoded.set(url, file.decodedBytes);
            else if (!url.endsWith(".json")) {
              const t = value as Texture;
              decoded.set(url, t.source.pixelWidth * t.source.pixelHeight * 4);
            }
            // Spritesheet's page is loaded by Pixi's parser, not fetched twice.
            if (url.endsWith(".json")) {
              const sheet = value as Spritesheet;
              for (const texture of Object.values(sheet.textures))
                preparePicking(texture);
              const image = sheet.data.meta.image;
              const page = url.slice(0, url.lastIndexOf("/") + 1) + image;
              const f = catalog.files.find((f) => f.url === page);
              if (f?.decodedBytes) decoded.set(page, f.decodedBytes);
            }
            if (!url.endsWith(".json")) preparePicking(value as Texture);
            return value;
          })
          .catch((e) => {
            loads.delete(url);
            throw e;
          }),
      );
    const value = (await loads.get(url)) as T;
    if (firstRequest) readyMs = performance.now() - began;
    return value;
  }
  return {
    bundle(name: string) {
      const b = catalog.bundles[name];
      if (!b) throw Error("Unknown art bundle");
      return b;
    },
    async sheet(bundle: string, character?: string, group?: string) {
      const b = catalog.bundles[bundle],
        p =
          b?.pages?.find(
            (p) =>
              (!character || p.character === character) &&
              (!group || p.group === group),
          ) ?? b?.atlas;
      if (!p) throw Error("Missing art page");
      const sheet = await load<Spritesheet>(artUrl(bundle, p.spritesheet));
      if (
        sheet.data.meta.image !== p.image ||
        (character &&
          Object.keys(sheet.textures).some(
            (key) => !key.startsWith(character + "/"),
          ))
      )
        throw Error("Artwork atlas identity mismatch");
      return sheet;
    },
    texture: (bundle: string, file: string) =>
      load<Texture>(artUrl(bundle, file)),
    decodedBytes: (bundle: string) =>
      [...decoded]
        .filter(([url]) => url.startsWith("/assets/" + bundle + "/"))
        .reduce((n, [, b]) => n + b, 0),
    stats: () => ({
      ...pickingStats(),
      artVersion: catalog.version,
      artReadyMs: readyMs,
      artRequestedPages: own.size,
      artCachedPages: decoded.size,
      artDecodedBytes: [...decoded.values()].reduce((n, b) => n + b, 0),
      artCachedImages: [...decoded.keys()],
    }),
  };
}
export type ArtLibrary = Awaited<ReturnType<typeof createArtLibrary>>;
export function setArtFrame(sprite: Sprite, texture: Texture) {
  sprite.texture = texture;
  sprite.anchor.copyFrom(texture.defaultAnchor ?? { x: 0.5, y: 1 });
}
export function artSprite(texture: Texture, renderScale: number, fit = 1) {
  const sprite = new Sprite(texture);
  sprite.anchor.copyFrom(texture.defaultAnchor ?? { x: 0.5, y: 1 });
  sprite.scale.set(ASSET_SCALE * renderScale * fit);
  return sprite;
}
/** Uniform presentation fit only. Never mutate a saved footprint or scale terrain. */
export function visualFit(
  width: number,
  depth: number,
  artWidth: number,
  artDepth: number,
) {
  if (
    ![width, depth, artWidth, artDepth].every(
      (n) => Number.isFinite(n) && n > 0,
    )
  )
    throw Error("Invalid visual envelope");
  return Math.min(1, width / artWidth, depth / artDepth);
}
