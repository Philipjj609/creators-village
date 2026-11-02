import { selectionFrame } from "./selection.js";
import type { Application, Container } from "pixi.js";
import { dampedStep, deadZoneTarget } from "./camera-motion.js";
import { clampCameraTranslation } from "./viewport-bounds.js";
type Point = { x: number; y: number };
type Bounds = { x: number; y: number; width: number; height: number };

/** Production-relevant demand camera shared with the retained legacy renderer. */
export function attachCamera(
  app: Application,
  scene: Container,
  host: HTMLElement,
  options: {
    bounds: Bounds;
    fitWidth: number;
    fitHeight: number;
    center: Point;
    onTap: (point: Point) => void;
    onHover?: (point: Point) => void;
    onContextMenu?: () => boolean;
    minOverviewScale?: number;
    maxScale?: number;
    cover?: boolean;
    onExplore?: () => void;
  },
) {
  let x = 0,
    y = 0,
    scale = 1,
    base = 1,
    disposed = false,
    frames = 0,
    total = 0,
    sampling = false;
  const intervals: number[] = [];
  const motion = matchMedia("(prefers-reduced-motion: reduce)");
  let vx = 0,
    vy = 0,
    vs = 0,
    releaseX = 0,
    releaseY = 0,
    lastPointerTime = 0;
  let overview: { x: number; y: number; scale: number } | null = null;
  let focused = false,
    autoFocus = false;
  function invalidate() {
    if (disposed || document.hidden) return;
    if (!app.ticker.started) sampling = false;
    app.start();
  }
  function reset() {
    autoFocus = true;
    focused = false;
    releaseX = releaseY = 0;
    if (overview) {
      ({ x, y, scale } = overview);
      overview = null;
      invalidate();
      return;
    }
    app.resize();
    base = (options.cover ? Math.max : Math.min)(
      app.screen.width / options.fitWidth,
      app.screen.height / options.fitHeight,
      ...(options.cover ? [] : [1]),
    );
    scale = base;
    x = app.screen.width * 0.5 - options.center.x * scale;
    y = app.screen.height * 0.52 - options.center.y * scale;
    invalidate();
  }
  function zoom(factor: number, at?: Point) {
    const previous = scale;
    scale = Math.max(
      options.minOverviewScale ?? base * (options.cover ? 1 : 0.65),
      Math.min(scale * factor, options.maxScale ?? 2.1),
    );
    at ??= { x: app.screen.width / 2, y: app.screen.height / 2 };
    if (at) {
      const ratio = scale / previous;
      x = at.x - (at.x - x) * ratio;
      y = at.y - (at.y - y) * ratio;
    }
    invalidate();
  }
  function interrupt() {
    releaseX = releaseY = 0;
    if (!autoFocus) return;
    autoFocus = false;
    x = scene.x;
    y = scene.y;
    scale = scene.scale.x;
    vx = vy = vs = 0;
    releaseX = releaseY = 0;
  }
  function focus(point: Point, requested: number, screenCenter?: Point) {
    autoFocus = true;
    host.dataset.cameraState = "moving";
    if (!focused) {
      overview = { x, y, scale };
      focused = true;
    }
    releaseX = releaseY = 0;
    scale = Math.max(base, Math.min(requested, options.maxScale ?? 2.1));
    x = (screenCenter?.x ?? app.screen.width * 0.5) - point.x * scale;
    y = (screenCenter?.y ?? app.screen.height * 0.48) - point.y * scale;
    invalidate();
  }
  // Keyboard exploration is scoped to the canvas; forms and page shortcuts are untouched.
  const canvas = app.canvas;
  canvas.tabIndex = 0;
  canvas.setAttribute("role", "img");
  canvas.setAttribute(
    "aria-label",
    "Village map. Arrow keys pan, plus and minus zoom, Home returns to overview. Places provides text inspection.",
  );
  function keyboard(event: KeyboardEvent) {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    if (
      ![
        "ArrowLeft",
        "ArrowRight",
        "ArrowUp",
        "ArrowDown",
        "+",
        "=",
        "-",
        "Home",
      ].includes(event.key)
    )
      return;
    interrupt();
    if (event.key === "ArrowLeft") x += 60;
    else if (event.key === "ArrowRight") x -= 60;
    else if (event.key === "ArrowUp") y += 60;
    else if (event.key === "ArrowDown") y -= 60;
    else if (event.key === "+" || event.key === "=") zoom(1.3);
    else if (event.key === "-") zoom(1 / 1.3);
    else if (event.key === "Home") reset();
    else return;
    options.onExplore?.();
    event.preventDefault();
    invalidate();
  }
  canvas.addEventListener("keydown", keyboard);
  reset();
  scene.position.set(x, y);
  scene.scale.set(scale);
  const pointers = new Map<number, Point>();
  let start = { x: 0, y: 0 },
    last = { x: 0, y: 0 },
    distance = 0,
    moved = 0,
    downTime = 0,
    touch = false,
    gesture = false;
  const local = (event: PointerEvent) => {
    const r = app.canvas.getBoundingClientRect();
    return { x: event.clientX - r.left, y: event.clientY - r.top };
  };
  function down(event: PointerEvent) {
    if (event.button !== 0) return;
    const p = local(event);
    pointers.set(event.pointerId, p);
    app.canvas.setPointerCapture(event.pointerId);
    start = p;
    last = p;
    moved = 0;
    downTime = performance.now();
    touch = event.pointerType === "touch";
    gesture = false;
    releaseX = releaseY = 0;
    lastPointerTime = performance.now();
    if (pointers.size === 2) {
      gesture = true;
      moved = 100;
      interrupt();
      options.onExplore?.();
      const [a, b] = [...pointers.values()];
      distance = Math.hypot(a!.x - b!.x, a!.y - b!.y);
    }
    invalidate();
  }
  function move(event: PointerEvent) {
    if (!pointers.has(event.pointerId)) {
      if (!pointers.size) options.onHover?.(local(event));
      return;
    }
    const p = local(event);
    pointers.set(event.pointerId, p);
    moved = Math.max(moved, Math.hypot(p.x - start.x, p.y - start.y));
    if (!gesture && moved >= (touch ? 10 : 6)) {
      gesture = true;
      interrupt();
      options.onExplore?.();
    }
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a!.x - b!.x, a!.y - b!.y);
      if (distance > 0)
        zoom(d / distance, { x: (a!.x + b!.x) / 2, y: (a!.y + b!.y) / 2 });
      distance = d;
    } else {
      x += p.x - last.x;
      y += p.y - last.y;
      const now = performance.now(),
        dt = Math.max(0.008, (now - lastPointerTime) / 1000);
      releaseX = Math.max(-900, Math.min(900, (p.x - last.x) / dt));
      releaseY = Math.max(-900, Math.min(900, (p.y - last.y) / dt));
      lastPointerTime = now;
    }
    last = p;
    invalidate();
  }
  function up(event: PointerEvent) {
    if (event.button !== 0) return;
    const p = local(event);
    pointers.delete(event.pointerId);
    if (moved < 7 || motion.matches || performance.now() - lastPointerTime > 80)
      releaseX = releaseY = 0;
    if (
      !gesture &&
      moved < (touch ? 10 : 6) &&
      performance.now() - downTime < 500 &&
      pointers.size === 0
    )
      options.onTap(p);
    distance = 0;
    invalidate();
    if (pointers.size === 1) {
      last = [...pointers.values()][0]!;
      start = last;
      moved = 100;
    }
  }
  function cancel(event: PointerEvent) {
    gesture = true;
    moved = 100;
    pointers.delete(event.pointerId);
    distance = 0;
    releaseX = releaseY = 0;
  }
  function wheel(event: WheelEvent) {
    options.onExplore?.();
    interrupt();
    releaseX = releaseY = 0;
    event.preventDefault();
    const r = app.canvas.getBoundingClientRect();
    zoom(Math.exp(-event.deltaY * 0.001), {
      x: event.clientX - r.left,
      y: event.clientY - r.top,
    });
  }
  const contextMenu = (event: MouseEvent) => {
    if (options.onContextMenu?.()) event.preventDefault();
  };
  const events = [
    ["contextmenu", contextMenu],
    ["pointerdown", down],
    ["pointermove", move],
    ["pointerup", up],
    ["pointercancel", cancel],
    ["wheel", wheel],
  ] as const;
  for (const [type, listener] of events)
    app.canvas.addEventListener(type, listener as EventListener, {
      passive: false,
    });
  let width = host.clientWidth,
    height = host.clientHeight;
  const observer = new ResizeObserver(() => {
    if (width !== host.clientWidth || height !== host.clientHeight) {
      width = host.clientWidth;
      height = host.clientHeight;
      overview = null;
      focused = false;
      reset();
    }
  });
  observer.observe(host);
  const tick = (t: typeof app.ticker) => {
    if (disposed) return;
    if (sampling) {
      frames++;
      total += t.elapsedMS;
      intervals.push(t.elapsedMS);
      if (intervals.length > 720) intervals.shift();
    }
    sampling = true;
    const seconds = Math.min(0.05, t.elapsedMS / 1000);
    if (!pointers.size && !motion.matches) {
      const decay = Math.exp(-10 * seconds);
      x += (releaseX * (1 - decay)) / 10;
      y += (releaseY * (1 - decay)) / 10;
      releaseX *= decay;
      releaseY *= decay;
    }
    ({ x, y } = clampCameraTranslation(
      x,
      y,
      scale,
      app.screen.width,
      app.screen.height,
      options.bounds,
    ));
    if (motion.matches) {
      scene.position.set(x, y);
      scene.scale.set(scale);
      vx = vy = vs = releaseX = releaseY = 0;
    } else {
      const sx = dampedStep(scene.x, vx, x, seconds),
        sy = dampedStep(scene.y, vy, y, seconds),
        sz = dampedStep(Math.log(scene.scale.x), vs, Math.log(scale), seconds);
      scene.position.set(sx.value, sy.value);
      scene.scale.set(Math.exp(sz.value));
      vx = sx.velocity;
      vy = sy.velocity;
      vs = sz.velocity;
    }
    const visible = clampCameraTranslation(
      scene.x,
      scene.y,
      scene.scale.x,
      app.screen.width,
      app.screen.height,
      options.bounds,
    );
    scene.position.set(visible.x, visible.y);
    if (
      Math.abs(x - scene.x) < 0.1 &&
      Math.abs(y - scene.y) < 0.1 &&
      Math.abs(scale - scene.scale.x) < 0.0001 &&
      Math.hypot(releaseX, releaseY) < 0.5
    ) {
      host.dataset.cameraState = "settled";
      scene.position.set(x, y);
      scene.scale.set(scale);
      vx = vy = vs = 0;
      app.stop();
    } else host.dataset.cameraState = "moving";
  };
  app.ticker.add(tick);
  const visibility = () => {
    if (document.hidden) app.stop();
    else invalidate();
  };
  document.addEventListener("visibilitychange", visibility);
  return {
    reset,
    zoom: (factor: number) => {
      interrupt();
      zoom(factor);
    },
    focus,
    locate(
      point: Point,
      frame: Bounds,
      mode: "frame" | "nudge" = "frame",
      requested = 1.4,
      extent = { width: 60, height: 70 },
    ) {
      if (mode === "frame") {
        const fit = Math.min(
          frame.width / (extent.width + 24),
          frame.height / (extent.height + 24),
        );
        focus(
          point,
          Math.min(Math.max(scale, requested), fit),
          selectionFrame(point, frame, extent, scale, "frame"),
        );
        return;
      }
      const screen = { x: point.x * scale + x, y: point.y * scale + y };
      const { x: cx, y: cy } = selectionFrame(
        screen,
        frame,
        extent,
        scale,
        "nudge",
      );
      if (cx !== screen.x || cy !== screen.y)
        focus(point, scale, { x: cx, y: cy });
    },
    follow(point: Point, requested: number, screenCenter?: Point) {
      autoFocus = true;
      if (!focused) {
        focus(point, requested, screenCenter);
        return;
      }
      const center = screenCenter ?? {
        x: app.screen.width * 0.5,
        y: app.screen.height * 0.48,
      };
      // Target-space dead zone avoids feeding spring lag back into the target.
      x -= deadZoneTarget(point.x * scale + x, center.x, 36);
      y -= deadZoneTarget(point.y * scale + y, center.y, 26);
      invalidate();
    },
    invalidate,
    stats: () => {
      const sorted = [...intervals].sort((a, b) => a - b);
      return {
        frameMs: frames ? total / frames : 0,
        frames,
        p95Ms: sorted[Math.floor(sorted.length * 0.95)] ?? 0,
        activeSamples: sorted.length,
        scale: scene.scale.x,
        position: { x: scene.x, y: scene.y },
        target: { x, y, scale },
        cameraVelocity: { x: vx, y: vy, zoom: vs },
        savedOverview: overview,
        running: app.ticker.started,
      };
    },
    destroy() {
      canvas.removeEventListener("keydown", keyboard);
      disposed = true;
      observer.disconnect();
      app.ticker.remove(tick);
      document.removeEventListener("visibilitychange", visibility);
      for (const [type, listener] of events)
        app.canvas.removeEventListener(type, listener as EventListener);
      app.stop();
    },
  };
}
