import { Application, Assets, type Texture, type WebGLRenderer } from "pixi.js";

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
  const gl = (app.renderer as WebGLRenderer).gl;
  let calls = 0,
    lastCalls = 0,
    maxCalls = 0,
    renderBegan = 0,
    cpuMs = 0,
    lastRender = 0;
  const intervals: number[] = [],
    movingIntervals: number[] = [];
  // Count actual calls on this scene's context, not estimated sprite batches.
  for (const method of [
    "drawElements",
    "drawArrays",
    "drawElementsInstanced",
    "drawArraysInstanced",
  ] as const) {
    const original = gl[method].bind(gl) as (...args: number[]) => void;
    (gl[method] as (...args: number[]) => void) = (...args: number[]) => {
      calls++;
      original(...args);
    };
  }
  const renderProbe = {
    prerender() {
      calls = 0;
      renderBegan = performance.now();
    },
    postrender() {
      const now = performance.now();
      cpuMs = now - renderBegan;
      lastCalls = calls;
      maxCalls = Math.max(maxCalls, calls);
      if (lastRender && !document.hidden) {
        const dt = now - lastRender;
        intervals.push(dt);
        if (intervals.length > 240) intervals.shift();
        if (host.dataset.cameraState === "moving") {
          movingIntervals.push(dt);
          if (movingIntervals.length > 240) movingIntervals.shift();
        }
      }
      lastRender = now;
    },
  };
  app.renderer.runners.prerender!.add(renderProbe);
  app.renderer.runners.postrender!.add(renderProbe);
  const distribution = (values: number[]) => {
    const sorted = [...values].sort((a, b) => a - b);
    return {
      samples: values.length,
      meanMs: values.length
        ? values.reduce((n, v) => n + v, 0) / values.length
        : 0,
      p95Ms: sorted[Math.floor(sorted.length * 0.95)] ?? 0,
      maxMs: sorted.at(-1) ?? 0,
    };
  };
  return {
    app,
    software,
    renderStats: () => ({
      glDrawCalls: lastCalls,
      glMaxDrawCalls: maxCalls,
      cpuRenderMs: cpuMs,
      renderPacing: distribution(intervals),
      cameraPacing: distribution(movingIntervals),
      resolution: app.renderer.resolution,
    }),
  };
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
