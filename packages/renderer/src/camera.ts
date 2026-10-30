import type { Application, Container } from "pixi.js";
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
    maxScale?: number;
    cover?: boolean;
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
  function invalidate() {
    if (disposed || document.hidden) return;
    if (!app.ticker.started) sampling = false;
    app.start();
  }
  function reset() {
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
      base * (options.cover ? 1 : 0.65),
      Math.min(scale * factor, options.maxScale ?? 2.1),
    );
    if (at) {
      const ratio = scale / previous;
      x = at.x - (at.x - x) * ratio;
      y = at.y - (at.y - y) * ratio;
    }
    invalidate();
  }
  function focus(point: Point, requested: number, screenCenter?: Point) {
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
    if (event.key === "ArrowLeft") x += 60;
    else if (event.key === "ArrowRight") x -= 60;
    else if (event.key === "ArrowUp") y += 60;
    else if (event.key === "ArrowDown") y -= 60;
    else if (event.key === "+" || event.key === "=") zoom(1.3);
    else if (event.key === "-") zoom(1 / 1.3);
    else if (event.key === "Home") reset();
    else return;
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
    moved = 0;
  const local = (event: PointerEvent) => {
    const r = app.canvas.getBoundingClientRect();
    return { x: event.clientX - r.left, y: event.clientY - r.top };
  };
  function down(event: PointerEvent) {
    const p = local(event);
    pointers.set(event.pointerId, p);
    app.canvas.setPointerCapture(event.pointerId);
    start = p;
    last = p;
    moved = 0;
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      distance = Math.hypot(a!.x - b!.x, a!.y - b!.y);
    }
    invalidate();
  }
  function move(event: PointerEvent) {
    if (!pointers.has(event.pointerId)) return;
    const p = local(event);
    pointers.set(event.pointerId, p);
    moved = Math.max(moved, Math.hypot(p.x - start.x, p.y - start.y));
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a!.x - b!.x, a!.y - b!.y);
      if (distance > 0)
        zoom(d / distance, { x: (a!.x + b!.x) / 2, y: (a!.y + b!.y) / 2 });
      distance = d;
    } else {
      x += p.x - last.x;
      y += p.y - last.y;
    }
    last = p;
    invalidate();
  }
  function up(event: PointerEvent) {
    const p = local(event);
    pointers.delete(event.pointerId);
    if (moved < 7 && pointers.size === 0) options.onTap(p);
    distance = 0;
    if (pointers.size === 1) {
      last = [...pointers.values()][0]!;
      start = last;
      moved = 100;
    }
  }
  function cancel(event: PointerEvent) {
    pointers.delete(event.pointerId);
    distance = 0;
  }
  function wheel(event: WheelEvent) {
    event.preventDefault();
    const r = app.canvas.getBoundingClientRect();
    zoom(Math.exp(-event.deltaY * 0.001), {
      x: event.clientX - r.left,
      y: event.clientY - r.top,
    });
  }
  const events = [
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
    const b = options.bounds;
    if (options.cover) {
      x = Math.max(
        app.screen.width - (b.x + b.width) * scale,
        Math.min(x, -b.x * scale),
      );
      y = Math.max(
        app.screen.height - (b.y + b.height) * scale,
        Math.min(y, -b.y * scale),
      );
    } else {
      x = Math.max(
        60 - (b.x + b.width) * scale,
        Math.min(x, app.screen.width - 60 - b.x * scale),
      );
      y = Math.max(
        60 - (b.y + b.height) * scale,
        Math.min(y, app.screen.height - 60 - b.y * scale),
      );
    }
    const ease = matchMedia("(prefers-reduced-motion: reduce)").matches
      ? 1
      : 0.14;
    scene.x += (x - scene.x) * ease;
    scene.y += (y - scene.y) * ease;
    scene.scale.set(scene.scale.x + (scale - scene.scale.x) * ease);
    if (
      Math.abs(x - scene.x) < 0.1 &&
      Math.abs(y - scene.y) < 0.1 &&
      Math.abs(scale - scene.scale.x) < 0.0001
    ) {
      scene.position.set(x, y);
      scene.scale.set(scale);
      app.stop();
    }
  };
  app.ticker.add(tick);
  const visibility = () => {
    if (document.hidden) app.stop();
    else invalidate();
  };
  document.addEventListener("visibilitychange", visibility);
  return {
    reset,
    zoom,
    focus,
    invalidate,
    stats: () => {
      const sorted = [...intervals].sort((a, b) => a - b);
      return {
        frameMs: frames ? total / frames : 0,
        frames,
        p95Ms: sorted[Math.floor(sorted.length * 0.95)] ?? 0,
        activeSamples: sorted.length,
        scale: scene.scale.x,
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
