import { useEffect, useRef, useState, type FormEvent } from "react";
import type {
  WorldSnapshot,
  PublicIdentity,
  Building,
} from "@creators-village/contracts";
import type { VillageView } from "@creators-village/renderer";

function Leaf() {
  return (
    <svg
      width="31"
      height="36"
      viewBox="0 0 31 36"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M15 34V16M15 24C-1 26 0 10 1 8c12-1 16 5 14 16ZM15 17C13 3 24 0 29 1c3 12-1 18-14 16Z"
        fill="currentColor"
      />
      <path d="m15 24-8-9m8 2 8-10" stroke="#f5f1e7" strokeWidth="1.4" />
    </svg>
  );
}
const descriptions: Record<Building["recipe"]["shape"], string> = {
  cottage:
    "A low, welcoming roof, climbing greenery and a little light in the window. Made for quiet mornings.",
  gable:
    "Steep rooflines, a storybook dormer and handcrafted timber details give this home its own character.",
  tower:
    "A tall little lookout among the trees. A different silhouette, with the same warm woodland materials.",
  hall: "The heart of the settlement. A place imagined for gathering and future community projects. Project contributions arrive in a later phase.",
  mill: "A landmark to find your way home. Its sails and warm stone silhouette mark the edge of the woodland.",
};
async function json<T>(url: string, options?: RequestInit): Promise<T> {
  const r = await fetch(url, options);
  if (!r.ok) {
    const b = await r.json().catch(() => ({}));
    throw new Error(
      b.error ?? "Could not reach the village. Please try again.",
    );
  }
  return r.json() as Promise<T>;
}
export function App() {
  const [world, setWorld] = useState<WorldSnapshot | null>(null),
    [me, setMe] = useState<PublicIdentity | null>(null),
    [selected, setSelected] = useState<string | null>(null),
    [error, setError] = useState(""),
    [list, setList] = useState(false),
    [focus, setFocus] = useState(false),
    [create, setCreate] = useState(false),
    [busy, setBusy] = useState(false),
    [about, setAbout] = useState(false),
    [fallback, setFallback] = useState(false);
  const host = useRef<HTMLDivElement>(null),
    view = useRef<VillageView | null>(null),
    [name, setName] = useState("My Woodland Village"),
    [seed, setSeed] = useState("morning-fern");
  async function load(url: string) {
    setError("");
    setSelected(null);
    try {
      setWorld(await json<WorldSnapshot>(url));
    } catch (e) {
      setError((e as Error).message);
    }
  }
  useEffect(() => {
    const query = new URLSearchParams(location.search),
      id = query.get("village");
    void load(
      id ? "/api/villages/" + encodeURIComponent(id) : "/api/showcase/fern",
    );
    void json<{ person: PublicIdentity | null }>("/api/me")
      .then((d) => setMe(d.person))
      .catch(() => setMe(null));
    if (query.get("auth") === "declined")
      setError("Twitch sign-in was declined. You can still explore freely.");
  }, []);
  useEffect(() => {
    if (!world || !host.current) return;
    let cancelled = false;
    setFallback(false);
    const node = host.current;
    node.dataset.renderState = "loading";
    void import("@creators-village/renderer")
      .then((m) =>
        m.mountVillage(node, world, (id) => {
          setSelected(id);
          setList(false);
        }),
      )
      .then((v) => {
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
    function key(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setFocus(false);
        setCreate(false);
        setAbout(false);
        setList(false);
      }
    }
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);
  useEffect(() => {
    if (!(focus || create || about)) return;
    const prior = document.activeElement as HTMLElement | null;
    const dialog = document.querySelector<HTMLElement>("[role=dialog]");
    const nodes = () => [
      ...(dialog?.querySelectorAll<HTMLElement>(
        "button:not([disabled]),input,a[href]",
      ) ?? []),
    ];
    nodes()[0]?.focus();
    function trap(e: KeyboardEvent) {
      if (e.key !== "Tab") return;
      const n = nodes(),
        first = n[0],
        last = n[n.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last?.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first?.focus();
      }
    }
    document.addEventListener("keydown", trap);
    return () => {
      document.removeEventListener("keydown", trap);
      prior?.focus();
    };
  }, [focus, create, about]);
  const building = world?.buildings.find((b) => b.id === selected);
  async function createWorld(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!me) return;
    setBusy(true);
    setError("");
    const key = "cv-create:" + name + ":" + seed;
    let commandId = sessionStorage.getItem(key);
    if (!commandId) {
      commandId = crypto.randomUUID();
      sessionStorage.setItem(key, commandId);
    }
    try {
      const saved = await json<WorldSnapshot>("/api/villages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Token": me.csrfToken,
        },
        body: JSON.stringify({ commandId, name, seed }),
      });
      setWorld(saved);
      setMe({ ...me, worldId: saved.id });
      setCreate(false);
      history.replaceState(null, "", "?village=" + saved.id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function select(b: Building) {
    view.current?.select(b.id);
    setSelected(b.id);
    setList(false);
  }
  return (
    <div className="app-shell">
      <header className="topbar" inert={focus || create || about}>
        <a className="brand" href="/" aria-label="Creator’s Village home">
          <Leaf />
          <span>
            creator’s
            <span className="brand-bottom">
              village<span className="brand-dot">.</span>
            </span>
          </span>
        </a>
        <nav aria-label="Village navigation">
          <a href="?founding=fern">A founding landscape</a>
          <button
            className="nav-active"
            onClick={() => {
              setList(false);
              view.current?.reset();
            }}
          >
            The village
          </button>
          <button onClick={() => setList(!list)} aria-expanded={list}>
            Places{" "}
            <span className="nav-count">{world?.buildings.length ?? "—"}</span>
          </button>
          <button onClick={() => setAbout(true)}>Our story</button>
        </nav>
        <div className="account">
          {me?.worldVersion === 1 && (
            <a
              href={
                me.developmentWorldId
                  ? "?world=" + me.developmentWorldId
                  : "?founding=new"
              }
            >
              Development world
            </a>
          )}
          {me ? (
            <>
              <span className="identity">
                <span className="online-dot" />
                {me.displayName}
              </span>
              <button
                className="primary small"
                onClick={() => {
                  if (me.worldId) {
                    if (me.worldVersion === 2) {
                      location.href = "?world=" + me.worldId;
                      return;
                    }
                    void load("/api/villages/" + me.worldId);
                    history.replaceState(null, "", "?village=" + me.worldId);
                  } else location.href = "?founding=new";
                }}
              >
                {me.worldId ? "My village" : "Create a village"} <span>↗</span>
              </button>
            </>
          ) : (
            <a
              className="primary small"
              href="http://localhost:3000/auth/twitch"
            >
              Connect with Twitch <span>↗</span>
            </a>
          )}
        </div>
      </header>
      <main className="village-page" inert={focus || create || about}>
        <section className="world-heading">
          <div>
            <div className="eyebrow">
              <span className="tiny-leaf">❧</span> A LITTLE WORLD, SHARED
            </div>
            <h1>
              {world?.name ?? "Finding our way home…"}
              <span className="heading-flower">✳</span>
            </h1>
            <p>
              {world?.source === "creator"
                ? "Your community’s own corner of the world. Saved here, ready for your next visit."
                : "A woodland village to wander. Slow down, look closer, and find a favourite little place."}
            </p>
          </div>
          <div className="world-badge">
            <span className="sun">☀</span>
            <div>
              Woodland days
              <span>
                {world?.source === "creator"
                  ? "CREATOR VILLAGE · SAVED"
                  : "SEED SHOWCASE · NOT LIVE"}
              </span>
            </div>
          </div>
        </section>
        {error && (
          <div role="alert" className="error-banner">
            {error}
            <button onClick={() => setError("")} aria-label="Dismiss error">
              ×
            </button>
          </div>
        )}
        <section className="map-frame" aria-label="Explore the village">
          <div
            className="map-canvas"
            ref={host}
            aria-label="Village map. Drag to pan, scroll or pinch to zoom. Use Places for accessible building inspection."
          />
          {!world && (
            <div className="loading" role="status">
              Growing a little woodland…
            </div>
          )}
          {fallback && (
            <div className="fallback" role="status">
              <h2>A quieter way to explore</h2>
              <p>
                This device couldn’t open the WebGL village. Every building is
                still available in Places.
              </p>
              <button className="primary" onClick={() => setList(true)}>
                Explore places
              </button>
            </div>
          )}
          <div className="map-topline">
            <span className="map-chip">
              <span className="online-dot" />{" "}
              {world?.source === "creator"
                ? "A world that stays"
                : "An original woodland showcase"}
            </span>
            <button
              className="icon-button compass"
              aria-label="Reset camera"
              onClick={() => view.current?.reset()}
            >
              N<span>↑</span>
            </button>
          </div>
          <div className="map-caption">
            <span className="caption-mark">❧</span>
            <span>
              There’s a story in every little roof.
              <small>Select a building to take a closer look.</small>
            </span>
          </div>
          <div className="camera-controls" aria-label="Camera controls">
            <button
              onClick={() => view.current?.zoom(1.25)}
              aria-label="Zoom in"
            >
              +
            </button>
            <span />
            <button
              onClick={() => view.current?.zoom(0.8)}
              aria-label="Zoom out"
            >
              −
            </button>
            <button
              onClick={() => view.current?.reset()}
              aria-label="Fit village"
            >
              ⌖
            </button>
          </div>
          <div className="map-instructions">
            DRAG TO WANDER <i /> SCROLL OR PINCH TO ZOOM
          </div>
          {world && (
            <div className="seed-picker">
              {world.source === "showcase" ? (
                <>
                  <span>WANDER SOMEWHERE NEW</span>
                  <button
                    className={world.seed === "fern" ? "active-seed" : ""}
                    onClick={() => void load("/api/showcase/fern")}
                  >
                    Fern Hollow
                  </button>
                  <button
                    className={world.seed === "willow" ? "active-seed" : ""}
                    onClick={() => void load("/api/showcase/willow")}
                  >
                    Willowmere
                  </button>
                </>
              ) : (
                <span>YOUR VILLAGE · REVISION {world.revision}</span>
              )}
            </div>
          )}
          {list && world && (
            <aside className="places-panel">
              <div className="panel-title">
                <h2>Around the village</h2>
                <button
                  className="icon-button"
                  onClick={() => setList(false)}
                  aria-label="Close places"
                >
                  ×
                </button>
              </div>
              <p>Every place has its own character.</p>
              <div className="places-scroll">
                {world.buildings.map((b) => (
                  <button key={b.id} onClick={() => select(b)}>
                    <img
                      src={`/assets/woodland-vector-1/${b.recipe.shape}-${b.recipe.palette}-iso.png`}
                      alt=""
                    />
                    <span>
                      {b.name}
                      <small>
                        {b.kind === "home"
                          ? "Woodland home"
                          : b.kind === "hall"
                            ? "Community landmark"
                            : "Village landmark"}
                      </small>
                    </span>
                    <span>↗</span>
                  </button>
                ))}
              </div>
            </aside>
          )}
          {building && !list && (
            <aside className="building-card" aria-label="Building inspection">
              <button
                className="close-card"
                onClick={() => {
                  setSelected(null);
                  setFocus(false);
                }}
                aria-label="Close building inspection"
              >
                ×
              </button>
              <div className="building-preview">
                <img
                  src={`/assets/woodland-vector-1/${building.recipe.shape}-${building.recipe.palette}-iso.png`}
                  alt={`${building.name}, a ${building.recipe.shape} in the woodland family`}
                />
                <span className="preview-flower">✳</span>
              </div>
              <div className="building-body">
                <div className="eyebrow">
                  {building.kind === "home"
                    ? "A WOODLAND HOME"
                    : "A PLACE TO GATHER"}
                </div>
                <h2>{building.name}</h2>
                <p>{descriptions[building.recipe.shape]}</p>
                <div className="building-detail">
                  <span>Character</span>
                  <strong>
                    {building.recipe.shape === "mill"
                      ? "Windmill"
                      : building.recipe.shape.charAt(0).toUpperCase() +
                        building.recipe.shape.slice(1)}
                  </strong>
                </div>
                <div className="building-detail">
                  <span>Belongs to</span>
                  <strong>{world?.name}</strong>
                </div>
                <button
                  className="outline-button"
                  onClick={() => setFocus(true)}
                >
                  Take a closer look <span>↗</span>
                </button>
                <small className="honest-note">
                  {world?.source === "showcase"
                    ? "Example world · no fictional community activity"
                    : "Saved structure · no member or presence data"}
                </small>
              </div>
            </aside>
          )}
        </section>
        <footer className="world-footer">
          <div>
            <span className="footer-leaf">❧</span> Built around belonging.
            <span className="footer-divider" />A world worth coming back to.
          </div>
          <button onClick={() => setAbout(true)}>
            A small beginning, a bigger story <span>↗</span>
          </button>
        </footer>
      </main>
      {focus && building && (
        <div className="modal-backdrop" onClick={() => setFocus(false)}>
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="focus-title"
            className="focus-modal"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              autoFocus
              className="close-modal"
              onClick={() => setFocus(false)}
              aria-label="Return to village"
            >
              ×
            </button>
            <div className="focus-art">
              <span className="eyebrow">
                A DIFFERENT VIEW OF THE SAME PLACE
              </span>
              <img
                src={`/assets/woodland-vector-1/${building.recipe.shape}-${building.recipe.palette}-front.png`}
                alt={`Front view of ${building.name}`}
              />
              <div className="focus-grass" />
            </div>
            <div className="focus-copy">
              <span className="eyebrow">{world?.name}</span>
              <h2 id="focus-title">{building.name}</h2>
              <p>{descriptions[building.recipe.shape]}</p>
              <p className="subtle">
                The same building, in the same village. A closer composition
                reveals its little details.
              </p>
              <button className="primary" onClick={() => setFocus(false)}>
                ← Back to the village
              </button>
            </div>
          </section>
        </div>
      )}
      {about && (
        <div className="modal-backdrop">
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="about-title"
            className="text-modal"
          >
            <button
              autoFocus
              className="close-modal"
              onClick={() => setAbout(false)}
              aria-label="Close story"
            >
              ×
            </button>
            <Leaf />
            <div className="eyebrow">CREATOR’S VILLAGE</div>
            <h2 id="about-title">A place to belong.</h2>
            <p>
              A living community home, shaped by the people who gather around a
              creator. A world that stays, even when the stream ends.
            </p>
            <p>
              This first chapter lets a creator connect Twitch, establish a
              saved village, and explore its buildings. Community contributions,
              inhabitants and shared projects are future chapters.
            </p>
            <p className="subtle">
              {world?.source === "showcase"
                ? "You are exploring a reproducible showcase seed, not a real creator’s community."
                : "This village is saved in the local authoritative database."}{" "}
              No follower lists or personal presence are shown.
            </p>
            <button className="primary" onClick={() => setAbout(false)}>
              Let’s wander
            </button>
          </section>
        </div>
      )}
      {create && (
        <div className="modal-backdrop">
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="create-title"
            className="text-modal"
          >
            <button
              className="close-modal"
              onClick={() => setCreate(false)}
              aria-label="Cancel village creation"
            >
              ×
            </button>
            <div className="eyebrow">YOUR FIRST LITTLE CORNER</div>
            <h2 id="create-title">Give your village a home.</h2>
            <p>
              Its landscape, buildings and chosen name will be public. Your
              Twitch credentials and private identity stay private.
            </p>
            <form onSubmit={(e) => void createWorld(e)}>
              <label>
                Village name
                <input
                  autoFocus
                  required
                  minLength={3}
                  maxLength={48}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </label>
              <label>
                A word to grow from
                <input
                  required
                  maxLength={64}
                  value={seed}
                  onChange={(e) => setSeed(e.target.value)}
                />
                <small>
                  This seed shapes your landscape. The created village is saved,
                  not regenerated on each visit.
                </small>
              </label>
              <button className="primary" disabled={busy}>
                {busy ? "Making a place for you…" : "Create my village ↗"}
              </button>
            </form>
          </section>
        </div>
      )}
    </div>
  );
}
