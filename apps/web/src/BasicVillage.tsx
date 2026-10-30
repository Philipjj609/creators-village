import { useEffect, useRef, useState } from "react";
import type {
  FoundingWorld,
  WorldSnapshot,
  WorldEntry,
} from "@creators-village/contracts";
import type { VillageView, mountFounding } from "@creators-village/renderer";
import { api } from "./api.js";
import { visibleWorldFrame } from "./viewport.js";
import { Link, usePanel } from "./routing.js";
import { useSession } from "./session.js";
import { WorldNav, CameraControls, Panel, Notice } from "./ui.js";
export function BasicVillage({ entry }: { entry: WorldEntry }) {
  const { person } = useSession(),
    [panel, setPanel] = usePanel(),
    [world, setWorld] = useState<WorldSnapshot | FoundingWorld | null>(null),
    [selected, setSelected] = useState(""),
    [focused, setFocused] = useState(""),
    [error, setError] = useState(""),
    [renderError, setRenderError] = useState(""),
    [retry, setRetry] = useState(0),
    [ready, setReady] = useState(false);
  const host = useRef<HTMLDivElement>(null),
    view = useRef<
      VillageView | Awaited<ReturnType<typeof mountFounding>> | null
    >(null),
    pick = useRef((id?: string) => {});
  pick.current = (id) => {
    setFocused("");
    setSelected(id ?? "founding-shelter");
    setPanel("inspect");
  };
  useEffect(() => {
    let live = true;
    setWorld(null);
    setError("");
    void api<WorldSnapshot | FoundingWorld>(
      entry.version === 1
        ? "/api/villages/" + entry.id
        : "/api/founding/" + entry.id,
    )
      .then((w) => {
        if (live) setWorld(w);
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
    };
  }, [entry.id, entry.version, retry]);
  useEffect(() => {
    if (!world || !host.current) return;
    let cancelled = false;
    const node = host.current;
    setReady(false);
    setRenderError("");
    node.dataset.renderState = "loading";
    void import("@creators-village/renderer")
      .then((m) =>
        world.schemaVersion === 1
          ? m.mountVillage(node, world, (id) => pick.current(id))
          : m.mountFounding(
              node,
              world,
              (id) => pick.current(id),
              undefined,
              () => visibleWorldFrame(node),
            ),
      )
      .then((v) => {
        if (cancelled) {
          v.destroy();
          return;
        }
        view.current = v;
        node.dataset.renderState = "ready";
        setReady(true);
      })
      .catch(() => {
        if (!cancelled) {
          node.dataset.renderState = "failed";
          setRenderError(
            "The graphics view could not load. You can still inspect Places; saved data is unchanged.",
          );
        }
      });
    return () => {
      cancelled = true;
      view.current?.destroy();
      view.current = null;
    };
  }, [world]);
  const places =
      world?.schemaVersion === 1
        ? world.buildings
        : world
          ? [{ id: world.structure.id, name: world.structure.name }]
          : [],
    place = places.find((p) => p.id === selected);
  async function focus() {
    if (!view.current) return;
    try {
      await (world?.schemaVersion === 2
        ? (
            view.current as Awaited<ReturnType<typeof mountFounding>>
          ).focusStructure(selected)
        : (view.current as VillageView).focus(selected));
      setFocused(selected);
    } catch {
      setRenderError(
        "The focused view could not load. Your saved place is unchanged.",
      );
    }
  }
  return (
    <div className="pi-village">
      <WorldNav
        name={entry.name}
        status={
          world
            ? ready
              ? "Ready to explore"
              : renderError
                ? "Places view"
                : "Loading the landscape…"
            : "Loading saved world…"
        }
        projects={false}
        manage={Boolean(person)}
      />
      <main className="pi-world-stage">
        <div ref={host} className="pi-canvas" aria-label="Explore village" />
        <div className="pi-world-label">
          {entry.source === "showcase"
            ? "Reproducible founding example · no member activity"
            : entry.version === 1
              ? "Original saved village · v1 preserved"
              : "Saved founding world"}
        </div>
        {!world && !error && (
          <div className="pi-world-loading">
            <h2>Finding our clearing…</h2>
            <p>Loading the saved landscape.</p>
          </div>
        )}
        {error && (
          <div className="pi-world-loading">
            <Notice kind="error" onRetry={() => setRetry((n) => n + 1)}>
              {error}
            </Notice>
            <Link href="/communities">Return to My Communities</Link>
          </div>
        )}
        {world && (
          <CameraControls
            disabled={!ready}
            reset={() => view.current?.reset()}
            zoom={(f) => view.current?.zoom(f)}
            places={() => setPanel("places")}
          />
        )}{" "}
        {renderError && (
          <div className="pi-world-alert">
            <Notice kind="error">
              {renderError}
              <button onClick={() => setPanel("places")}>Explore places</button>
            </Notice>
          </div>
        )}
        {panel && (
          <Panel
            title={
              panel === "inspect"
                ? "Building inspection"
                : panel === "places"
                  ? "Places"
                  : "Village settings"
            }
            onClose={() => setPanel("")}
          >
            {panel === "places" ? (
              <>
                <p>Find a place in this landscape.</p>
                {places.map((p) => (
                  <button
                    key={p.id}
                    className="pi-place-row"
                    onClick={() => pick.current(p.id)}
                  >
                    {p.name}
                    <span aria-hidden="true">↗</span>
                  </button>
                ))}
              </>
            ) : panel === "inspect" && place ? (
              <>
                <h3>{place.name}</h3>
                <p>
                  {entry.version === 1
                    ? "An original building in this retained village. No community construction activity is implied by its generated layout."
                    : "The first gathering place. Its identity remains part of this world as the community grows."}
                </p>
                {focused === selected &&
                  world?.schemaVersion === 1 &&
                  (() => {
                    const b = world.buildings.find((b) => b.id === selected);
                    return b ? (
                      <img
                        className="pi-legacy-detail"
                        src={`/assets/${world.assetVersion}/${b.recipe.shape}-${b.recipe.palette}-front.png`}
                        alt={`${b.name}, preserved front view`}
                      />
                    ) : null;
                  })()}
                <button
                  className="pi-button primary"
                  onClick={focus}
                  disabled={Boolean(renderError)}
                >
                  Take a closer look
                </button>
                <button onClick={() => view.current?.reset()}>
                  Village overview
                </button>
                <small className="pi-muted">
                  Existing geometry and materials · visual direction in
                  development
                </small>
              </>
            ) : (
              <>
                <p>
                  {entry.purpose === "showcase"
                    ? "This is a reproducible example, not a record of member achievements."
                    : entry.version === 1
                      ? "This original world stays intact. Its URL, assets and saved data remain compatible."
                      : "This world is saved. Construction access is controlled separately."}
                </p>
                {person && (
                  <Link href="/settings">
                    Your account, receipts and privacy
                  </Link>
                )}
                <Link className="pi-button" href="/communities">
                  My Communities
                </Link>
              </>
            )}
          </Panel>
        )}
      </main>
    </div>
  );
}
