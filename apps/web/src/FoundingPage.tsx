import { useEffect, useRef, useState, type FormEvent } from "react";
import type {
  FoundingWorld,
  FoundingJob,
  PublicIdentity,
} from "@creators-village/contracts";
import type { mountFounding } from "@creators-village/renderer";
import { navigate } from "./routing.js";
import { useSession } from "./session.js";
async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, init);
  const b = await r.json();
  if (!r.ok) throw Error(b.error ?? "World unavailable");
  return b as T;
}
export function FoundingPage({
  startCreation = false,
}: {
  startCreation?: boolean;
}) {
  const session = useSession();
  const query = new URLSearchParams(location.search);
  const [initialId] = useState(
    () =>
      query.get("world") ??
      `showcase-${["willow", "hearth", "brook"].includes(query.get("founding") ?? "") ? query.get("founding") : "fern"}`,
  );
  const [world, setWorld] = useState<FoundingWorld | null>(null),
    [me, setMe] = useState<PublicIdentity | null>(null),
    [error, setError] = useState(""),
    [creating, setCreating] = useState(
      startCreation || query.get("founding") === "new",
    ),
    [busy, setBusy] = useState(false),
    [selected, setSelected] = useState(false),
    [focused, setFocused] = useState(false),
    [fallback, setFallback] = useState(false),
    [name, setName] = useState("Our First Clearing"),
    [seed, setSeed] = useState("morning-fern"),
    [job, setJob] = useState<string | null>(
      sessionStorage.getItem("cv-founding-job"),
    ),
    [metrics, setMetrics] = useState<object>({}),
    [sample, setSample] = useState<{
      x: number;
      y: number;
      height: number;
      active: boolean;
      cover: string;
    } | null>(null);
  const host = useRef<HTMLDivElement>(null),
    view = useRef<Awaited<ReturnType<typeof mountFounding>> | null>(null);
  useEffect(() => {
    let cancelled = false;
    void api<FoundingWorld>("/api/founding/" + encodeURIComponent(initialId))
      .then((w) => {
        if (!cancelled) setWorld(w);
      })
      .catch((e) => {
        if (!cancelled) setError(e.message);
      });
    void api<{ person: PublicIdentity | null }>("/api/me")
      .then((r) => {
        if (!cancelled) setMe(r.person);
      })
      .catch(() => {
        if (!cancelled)
          setError("Account status unavailable. Reload to retry.");
      });
    return () => {
      cancelled = true;
    };
  }, [initialId]);
  useEffect(() => {
    if (!world || !host.current) return;
    let cancelled = false;
    const node = host.current;
    node.dataset.renderState = "loading";
    setFallback(false);
    void import("@creators-village/renderer")
      .then((m) =>
        cancelled
          ? null
          : m.mountFounding(
              node,
              world,
              () => {
                setSample(null);
                setSelected(true);
              },
              (sample) => {
                setSelected(false);
                setSample(sample);
              },
            ),
      )
      .then((v) => {
        if (!v) return;
        if (cancelled) v.destroy();
        else {
          view.current = v;
          node.dataset.renderState = "ready";
        }
      })
      .catch(() => {
        if (!cancelled) setFallback(true);
      });
    return () => {
      cancelled = true;
      view.current?.destroy();
      view.current = null;
    };
  }, [world]);
  useEffect(() => {
    const timer = setInterval(() => {
      if (view.current) setMetrics(view.current.stats());
    }, 500);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (!job) return;
    let cancelled = false,
      polling = false;
    const poll = async () => {
      if (polling) return;
      polling = true;
      try {
        const state = await api<FoundingJob>("/api/founding-jobs/" + job);
        if (cancelled) return;
        if (state.status === "ready") {
          const w = await api<FoundingWorld>("/api/founding/" + state.worldId);
          if (cancelled) return;
          setWorld(w);
          void api<{ person: PublicIdentity | null }>("/api/me")
            .then((r) => setMe(r.person))
            .catch(() => {});
          setCreating(false);
          setJob(null);
          setBusy(false);
          sessionStorage.removeItem("cv-founding-job");
          await session.refresh();
          navigate("/villages/" + w.id, true);
        } else if (state.status === "failed") {
          setError(
            state.error ??
              "Generation failed safely; existing worlds are unchanged.",
          );
          setJob(null);
          setBusy(false);
          sessionStorage.removeItem("cv-founding-job");
        }
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      } finally {
        polling = false;
      }
    };
    void poll();
    const timer = setInterval(() => void poll(), 1000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [job]);
  async function create(e: FormEvent) {
    e.preventDefault();
    if (!me) return;
    setBusy(true);
    setError("");
    const development = me.worldVersion === 1;
    const key =
      "cv-founding-command:" + JSON.stringify({ name, seed, development });
    let commandId = sessionStorage.getItem(key);
    if (!commandId) {
      commandId = crypto.randomUUID();
      sessionStorage.setItem(key, commandId);
    }
    try {
      const accepted = await api<{ jobId: string; worldId: string }>(
        "/api/founding",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-CSRF-Token": me.csrfToken,
          },
          body: JSON.stringify({ commandId, name, seed, development }),
        },
      );
      sessionStorage.setItem("cv-founding-job", accepted.jobId);
      setJob(accepted.jobId);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }
  useEffect(() => {
    if (!creating) return;
    const prior = document.activeElement as HTMLElement | null;
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
    const nodes = () => [
      ...(dialog?.querySelectorAll<HTMLElement>(
        "button:not([disabled]),input:not([disabled]),a[href]",
      ) ?? []),
    ];
    nodes()[0]?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy && !job) setCreating(false);
      if (e.key !== "Tab") return;
      const all = nodes(),
        first = all[0],
        last = all.at(-1);
      if (!all.length) {
        e.preventDefault();
        return;
      }
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last?.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("keydown", key);
      prior?.focus();
    };
  }, [creating, busy, job]);
  const dev = world?.purpose === "development" && world.source === "creator";
  return (
    <div className="app-shell founding-page">
      <header className="topbar" inert={creating}>
        <a className="brand" href="/">
          creator’s village.
        </a>
        <nav aria-label="World navigation">
          {me?.developmentWorldId && (
            <a href={"/playtest?world=" + me.developmentWorldId}>
              Private participation
            </a>
          )}
          <a href="?founding=fern">A beginning</a>
          <a href="?founding=hearth">Creek</a>
          <a href="?founding=brook">Ridge</a>
          <a href="/">Legacy villages</a>
          <button onClick={() => setSelected(true)}>Gathering shelter</button>
        </nav>
        <div className="account">
          {me ? (
            <>
              <span>{me.displayName}</span>
              {me.worldId && (
                <a
                  href={
                    me.worldVersion === 2
                      ? `?world=${me.worldId}`
                      : `?village=${me.worldId}`
                  }
                >
                  My village
                </a>
              )}
              {me.developmentWorldId ? (
                <a href={`?world=${me.developmentWorldId}`}>
                  Development world
                </a>
              ) : (
                <button
                  className="primary small"
                  onClick={() => setCreating(true)}
                >
                  {me.worldVersion === 1
                    ? "Create development world"
                    : "Found a village"}
                </button>
              )}
            </>
          ) : (
            <a className="primary small" href="/auth/twitch">
              Connect with Twitch
            </a>
          )}
        </div>
      </header>
      <main className="village-page" inert={creating}>
        <section className="world-heading">
          <div>
            <div className="eyebrow">A PLACE TO BEGIN</div>
            <h1>{world?.name ?? "Finding our clearing…"}</h1>
            <p>
              One gathering shelter, a short path, and room for the community’s
              future.
            </p>
          </div>
          <div className="world-badge">
            {world?.source === "showcase"
              ? "REPRODUCIBLE FOUNDING EXAMPLE · NO MEMBER ACTIVITY"
              : dev
                ? "PRIVATE DEVELOPMENT / TEST WORLD · V1 PRESERVED"
                : "SAVED FOUNDING VILLAGE"}
          </div>
        </section>
        {error && (
          <div className="error-banner" role="alert">
            {error}
            <button onClick={() => setError("")}>Dismiss</button>
          </div>
        )}
        <section className="map-frame" aria-label="Explore founding landscape">
          <div
            className="map-canvas"
            ref={host}
            aria-label="Founding landscape. Drag to pan, scroll or pinch to zoom."
          />
          {fallback && (
            <div className="fallback">
              <h2>A quieter view</h2>
              <p>
                The graphics view could not load. Your saved world remains
                available.
              </p>
              <button onClick={() => setSelected(true)}>
                Inspect gathering shelter
              </button>
            </div>
          )}
          <div className="map-topline">
            <span className="map-chip">
              {world?.baseline.landform.replaceAll("-", " ")} · founding
              territory
            </span>
            <button
              className="icon-button"
              onClick={() => {
                view.current?.reset();
                setFocused(false);
              }}
            >
              ⌖
            </button>
          </div>
          <div className="camera-controls">
            <button
              aria-label="Zoom in"
              onClick={() => view.current?.zoom(1.25)}
            >
              +
            </button>
            <button
              aria-label="Zoom out"
              onClick={() => view.current?.zoom(0.8)}
            >
              −
            </button>
            <button
              aria-label="Fit village"
              onClick={() => {
                view.current?.reset();
                setFocused(false);
              }}
            >
              ⌖
            </button>
          </div>
          <div className="map-caption">
            <span>
              THE WORLD IS MOSTLY UNDEVELOPED
              <small>
                {world?.source === "showcase"
                  ? "Reproducible example. Real villages save their geography permanently."
                  : "Surrounding geography is saved; construction and expansion are future chapters."}
              </small>
            </span>
          </div>
          {sample && !selected && (
            <aside className="places-panel" aria-label="Landscape inspection">
              <button
                aria-label="Close terrain inspection"
                onClick={() => setSample(null)}
              >
                ×
              </button>
              <h2>{sample.cover}</h2>
              <p>
                {sample.active
                  ? "Inside founding territory"
                  : "Surrounding landscape · inactive territory"}
              </p>
              <p>
                Logical location {sample.x.toFixed(2)}, {sample.y.toFixed(2)} ·
                elevation {sample.height.toFixed(2)}
              </p>
              <p>
                Natural cover describes geography. It grants no construction
                permission. No terrain editing is enabled in WF1.
              </p>
            </aside>
          )}
          {selected && world && (
            <aside className="places-panel">
              <button
                aria-label="Close inspection"
                onClick={() => setSelected(false)}
              >
                ×
              </button>
              <h2>{world.structure.name}</h2>
              <p>
                A small founding shelter for gathering. Its identity stays with
                this world as it grows.
              </p>
              <dl>
                <dt>Foundation</dt>
                <dd>{world.structure.template}</dd>
                <dt>Entrance</dt>
                <dd>
                  {world.structure.entrance.x}, {world.structure.entrance.y}
                </dd>
                <dt>Saved landscape</dt>
                <dd>{world.baseline.landform.replaceAll("-", " ")}</dd>
              </dl>
              <button
                onClick={() => {
                  void view.current
                    ?.focus()
                    .catch(() =>
                      setError(
                        "Closer-view asset unavailable. Overview remains saved.",
                      ),
                    );
                  setFocused(true);
                }}
              >
                Take a closer look
              </button>
              {focused && (
                <button
                  onClick={() => {
                    view.current?.reset();
                    setFocused(false);
                  }}
                >
                  Return to overview
                </button>
              )}
              <p>
                No homes, completed projects or community activity have been
                invented.
              </p>
            </aside>
          )}
        </section>
        <footer className="world-footer">
          WF1 world foundation · art direction remains under review. No
          construction or economy is enabled.
        </footer>
        <details className="foundation-details">
          <summary>World record and rendering diagnostics</summary>
          <p>
            World ID: {world?.id} · format 2 · geographic baseline:{" "}
            {world?.baseline.hash}
          </p>
          <p>
            Finite geographic envelope; one active founding territory.
            Ecological regions do not grant construction permission.
          </p>
          <pre id="wf1-metrics">{JSON.stringify(metrics)}</pre>
        </details>
      </main>
      {creating && (
        <div className="modal-backdrop">
          <section
            className="text-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="found-title"
          >
            <button
              className="close-modal"
              aria-label="Cancel founding"
              disabled={busy || Boolean(job)}
              onClick={() => setCreating(false)}
            >
              ×
            </button>
            <h2 id="found-title">
              {me?.worldVersion === 1
                ? "Create a development world"
                : "Found your village"}
            </h2>
            {me?.worldVersion === 1 ? (
              <p>
                This creates one private development/test world alongside your
                unchanged v1 village. It does not replace it or create another
                production community.
              </p>
            ) : (
              <p>
                Your founding village and landscape will be public by its world
                link, as with existing villages. Credentials and private
                identity remain private.
              </p>
            )}
            {me ? (
              <form onSubmit={(e) => void create(e)}>
                <label>
                  Village name
                  <input
                    autoFocus
                    required
                    minLength={3}
                    maxLength={48}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    disabled={busy || Boolean(job)}
                  />
                </label>
                <label>
                  A word to grow from
                  <input
                    required
                    maxLength={64}
                    value={seed}
                    onChange={(e) => setSeed(e.target.value)}
                    disabled={busy || Boolean(job)}
                  />
                </label>
                <p>
                  Only the gathering shelter and its initial path are founded.
                  The rest remains landscape.
                </p>
                <button className="primary" disabled={busy || Boolean(job)}>
                  {busy || job
                    ? "Preparing and saving geography…"
                    : "Create saved founding world"}
                </button>
              </form>
            ) : (
              <a href="/auth/twitch">Sign in with Twitch to continue</a>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
