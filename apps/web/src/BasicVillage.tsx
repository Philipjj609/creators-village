import { VillageAtmosphere } from "./VillageAtmosphere.js";
import { VillageDirectory } from "./VillageDirectory.js";
import { describePlace } from "./place-descriptor.js";
import { useVillageInteraction } from "./use-village-interaction.js";
import { objectRef } from "./village-selection.js";
import { useSelectionProjection } from "./use-selection-projection.js";
import { useEffect, useRef, useState } from "react";
import type {
  FoundingWorld,
  WorldSnapshot,
  WorldEntry,
} from "@creators-village/contracts";
import type {
  VillageView,
  mountFounding,
  LivingViewState,
} from "@creators-village/renderer";
import { ResidentList, ResidentPanel } from "./ResidentPanel.js";
import { api } from "./api.js";
import { visibleWorldFrame } from "./viewport.js";
import { Link } from "./routing.js";
import { useSession } from "./session.js";
import { Notice } from "./ui.js";
import { WorldNav, CameraControls, Panel } from "./VillageChrome.js";
export function BasicVillage({ entry }: { entry: WorldEntry }) {
  const interaction = useVillageInteraction(),
    { panel, setPanel, selected } = interaction;
  const { person } = useSession(),
    [world, setWorld] = useState<WorldSnapshot | FoundingWorld | null>(null),
    [error, setError] = useState(""),
    [renderError, setRenderError] = useState(""),
    [retry, setRetry] = useState(0),
    [ready, setReady] = useState(false);
  const [living, setLiving] = useState<LivingViewState | null>(null);
  const host = useRef<HTMLDivElement>(null),
    view = useRef<
      VillageView | Awaited<ReturnType<typeof mountFounding>> | null
    >(null),
    pick = useRef((id?: string) => {});
  const listPick = (id: string) => {
    const ref = objectRef(id);
    if (ref) interaction.send({ type: "listPick", ref });
  };
  pick.current = (id) =>
    interaction.send({ type: "worldPick", ref: objectRef(id) });
  const interactionRef = useRef(interaction);
  interactionRef.current = interaction;
  useSelectionProjection(view, interaction.state, ready);
  useEffect(() => {
    const ref = interactionRef.current.state.selection;
    if (!ref || !world) return;
    const missing =
      ref.kind === "resident"
        ? world.schemaVersion === 1 ||
          (living?.plan
            ? !living.plan.residents.some((r) => r.id === ref.id)
            : false)
        : ref.kind === "structure"
          ? world.schemaVersion === 1
            ? !world.buildings.some((b) => b.id === ref.id)
            : world.structure.id !== ref.id
          : ref.kind !== "landmark" ||
            world.schemaVersion !== 1 ||
            ref.id !== "pond";
    if (missing)
      interactionRef.current.send({ type: "objectRemoved", id: ref.id });
  }, [selected, world, living?.plan]);
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
          ? m.mountVillage(
              node,
              world,
              (id) => pick.current(id),
              () => visibleWorldFrame(node),
            )
          : m.mountFounding(
              node,
              world,
              (id) => pick.current(id),
              undefined,
              () => visibleWorldFrame(node),
              setLiving,
              (id) => {
                if (!id && interactionRef.current.state.following)
                  interactionRef.current.send({ type: "cameraManual" });
              },
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
  const namedBuildings =
    world?.schemaVersion === 1
      ? world.buildings.map((b) => ({
          id: b.id,
          name: b.name,
          x: b.position.x / 256,
          y: b.position.y / 256,
        }))
      : world
        ? [
            {
              id: world.structure.id,
              name: world.structure.name,
              x: world.structure.x,
              y: world.structure.y,
            },
          ]
        : [];
  const describeBuilding = (id: string) => {
    const target = namedBuildings.find((p) => p.id === id);
    return target
      ? describePlace(target, namedBuildings)
      : "In this saved village";
  };
  const legacyBuilding =
    world?.schemaVersion === 1
      ? world.buildings.find((b) => b.id === selected)
      : null;
  return (
    <div className="pi-village ui3-shell">
      <span className="ux1-announcement" role="status">
        {interaction.notice
          ? "Stopped following " +
            (living?.plan.residents.find((r) => r.id === interaction.notice)
              ?.name ?? "the inhabitant") +
            "."
          : ""}
      </span>
      <WorldNav
        activePanel={panel}
        onTab={(view) => interaction.send({ type: "tab", view })}
        entry={entry}
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
        people={world?.schemaVersion === 2}
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
            contextKey={
              ["inspect", "resident"].includes(panel) ? selected : panel
            }
            title={
              panel === "inspect"
                ? "Building"
                : panel === "landmark"
                  ? "Landmark"
                  : panel === "places"
                    ? "Places"
                    : panel === "people"
                      ? "People"
                      : panel === "resident"
                        ? "Inhabitant"
                        : "Village settings"
            }
            onClose={() => interaction.send({ type: "close" })}
            onEscape={() => interaction.send({ type: "escape" })}
            back={
              interaction.state.selection
                ? {
                    label:
                      interaction.state.returnView === "people"
                        ? "People"
                        : "Places",
                    onBack: () => interaction.send({ type: "back" }),
                  }
                : undefined
            }
            locate={
              interaction.state.selection && ready
                ? () =>
                    view.current?.focusSelection(interaction.state.selection!)
                : undefined
            }
            memory={interaction.memories[panel as "people" | "places"]}
          >
            {panel === "places" ? (
              <VillageDirectory
                label="Places"
                memory={interaction.memories.places}
                items={[
                  ...(world?.schemaVersion === 1
                    ? [
                        {
                          key: "landmark:pond",
                          name: "Village pond",
                          description: "Landmark · Saved water feature",
                        },
                      ]
                    : []),
                  ...places.map((p) => ({
                    key: p.id,
                    name: p.name,
                    description: "Building · " + describeBuilding(p.id),
                  })),
                ]}
                select={listPick}
                empty="No saved places are available."
              />
            ) : panel === "people" ? (
              world?.schemaVersion === 2 ? (
                <ResidentList
                  living={living}
                  select={listPick}
                  memory={interaction.memories.people}
                  following={interaction.state.following}
                />
              ) : (
                <p>
                  No resident information is available for this saved world.
                </p>
              )
            ) : panel === "resident" ? (
              <ResidentPanel
                living={living}
                id={selected}
                following={interaction.state.following === selected}
                focus={() => interaction.send({ type: "followToggle" })}
              />
            ) : panel === "landmark" && world?.schemaVersion === 1 ? (
              <>
                <h3>Village pond</h3>
                <p>A water feature in this saved landscape.</p>
              </>
            ) : panel === "inspect" && place ? (
              <>
                <h3>{place.name}</h3>
                <p className="ux1-meta">
                  Building · {describeBuilding(selected)}
                </p>
                <p>
                  {entry.version === 1
                    ? legacyBuilding
                      ? `${legacyBuilding.kind[0]!.toUpperCase()}${legacyBuilding.kind.slice(1)} in this village.`
                      : "A saved building."
                    : "A shared gathering place and shelter."}
                </p>
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
                <VillageAtmosphere />
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
