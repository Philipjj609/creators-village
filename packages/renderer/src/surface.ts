import { Application, Assets, type Texture } from "pixi.js";

/** Shared by the legacy village and candidate studies; no authoritative state here. */
export async function createSurface(host: HTMLElement) {
  const probe = document.createElement("canvas");
  const context = probe.getContext("webgl2");
  if (!context)
    throw new Error("WebGL2 is unavailable; use accessible Places.");
  const debug = context.getExtension("WEBGL_debug_renderer_info");
  const software = debug
    ? /SwiftShader|llvmpipe|software/i.test(
        String(context.getParameter(debug.UNMASKED_RENDERER_WEBGL)),
      )
    : false;
  context.getExtension("WEBGL_lose_context")?.loseContext();
  const app = new Application();
  await app.init({
    resizeTo: host,
    backgroundAlpha: 0,
    antialias: true,
    preference: "webgl",
    preferWebGLVersion: 2,
    resolution: software ? 0.75 : Math.min(devicePixelRatio, 1.7),
    autoDensity: true,
    autoStart: false,
  });
  host.appendChild(app.canvas);
  return { app, software };
}

export async function loadTextures(urls: string[]) {
  return (await Assets.load<Texture>(urls)) as unknown as Record<
    string,
    Texture
  >;
}

export async function releaseStudyTextures(urls: string[]) {
  // Only the isolated study's namespace is ever unloaded; legacy assets stay cached.
  if (urls.some((url) => !url.startsWith("/study-assets/")))
    throw new Error("Study texture release outside its namespace");
  await Assets.unload(urls);
}
export function cachedTextureCount(urls: string[]) {
  return urls.filter((url) => Assets.cache.has(url)).length;
}
// Pixi's bundled static shader/uniform polyfills support strict CSP without enabling eval.
import "pixi.js/unsafe-eval";
