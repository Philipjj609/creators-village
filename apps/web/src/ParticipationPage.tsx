import { useOrbWallet, OrbHUD, OrbFunding } from "./Orbs.js";
import { CommunityPanel } from "./CommunityPanel.js";
import { AccountRecognition } from "./AccountRecognition.js";
import { canonicalPlace, projectForPlace } from "./place-project.js";
import { WorkshopPlanner, type PlacementPhase } from "./WorkshopPlanner.js";
import { snappedSite } from "./placement-state.js";
import { VillageAtmosphere } from "./VillageAtmosphere.js";
import { VillageDirectory } from "./VillageDirectory.js";
import { describePlace, villagePlaces } from "./place-descriptor.js";
import { useVillageInteraction } from "./use-village-interaction.js";
import { objectRef } from "./village-selection.js";
import { useSelectionProjection } from "./use-selection-projection.js";
import { useEffect, useRef, useState } from "react";
import type {
  FoundingWorld,
  PublicIdentity,
  Wf2State,
  Wf2Project,
  Wf2Batch,
  WorldEntry,
} from "@creators-village/contracts";
import type {
  mountFounding,
  LivingViewState,
} from "@creators-village/renderer";
import { ResidentList, ResidentPanel } from "./ResidentPanel.js";
import { villageActionError } from "./village-panel-state.js";
import { ConfirmAction, ProjectInspector } from "./village-panels.js";
import { constructionView } from "@creators-village/contracts";
import { applyWf2Batch, readWf2State } from "./wf2-state.js";
import { api as wf2Api, HttpError as Wf2HttpError } from "./api.js";
import { Link, navigate } from "./routing.js";
import { useSession } from "./session.js";
import { visibleWorldFrame } from "./viewport.js";
import { Header, Notice } from "./ui.js";
import { WorldNav, CameraControls, Panel } from "./VillageChrome.js";
export { api as wf2Api } from "./api.js";
type Me = {
  grants: { worldId: string; canContribute: boolean }[];
  requests: { requestId: string; state: string; worldId: string }[];
  receipts: { commandId: string; projectId: string }[];
};
let joinStart: Promise<{ continuationId: string; expiresAt: string }> | null =
  null;
function startJoin() {
  const token = new URLSearchParams(location.hash.slice(1)).get("request");
  if (token) {
    history.replaceState(null, "", location.pathname + location.search);
    joinStart = wf2Api("/api/wf2/join/continuations", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-WF2-Join": "1" },
      body: JSON.stringify({ token }),
    });
  }
  return joinStart;
}
function foundingHeader(s: Wf2State): FoundingWorld {
  const f = s.structures.find((v) => v.id === "founding-shelter")!,
    p = s.paths.find((v) => v.id === "founding-path")!;
  return {
    schemaVersion: 2,
    id: s.worldId,
    name: "Village",
    source: "creator",
    purpose: "development",
    createdAt: "2026-10-29T00:00:00Z",
    baseline: s.baseline,
    active: s.active,
    structure: {
      id: f.id,
      template: "gathering-shelter-1",
      name: "The Gathering Shelter",
      x: f.position.qx / 256,
      y: f.position.qy / 256,
      width: f.footprint.widthQ / 256,
      depth: f.footprint.depthQ / 256,
      height: f.position.height / 16,
      entrance: { x: f.entrance.qx / 256, y: f.entrance.qy / 256 },
      appearance: "hearthside-hero-01/commons",
    },
    path: {
      id: p.id,
      width: p.widthQ / 256,
      points: p.points.map((v) => ({ x: v.qx / 256, y: v.qy / 256 })),
    },
    publicCursor: s.cursor,
    topologyEpoch: s.topologyEpoch,
  };
}
export function ParticipationPage({
  worldId,
  entry,
}: {
  worldId?: string;
  entry?: WorldEntry;
}) {
  const world = worldId ?? null,
    joining = location.pathname === "/join";
  const session = useSession(),
    interaction = useVillageInteraction(),
    { panel, setPanel, selected } = interaction;
  const selectPlace = (id: string) => {
    const ref = canonicalPlace(objectRef(id), state);
    if (ref)
      interaction.send({
        type: "listPick",
        ref,
        view:
          panel === "projects" || panel === "history"
            ? "projects"
            : panel === "people"
              ? "people"
              : "places",
      });
  };
  const panelRef = useRef((id?: string) => {});
  panelRef.current = (id) =>
    interaction.send({ type: "worldPick", ref: objectRef(id) });
  const interactionRef = useRef(interaction);
  interactionRef.current = interaction;
  const [living, setLiving] = useState<LivingViewState | null>(null);
  const [lastAction, setLastAction] = useState("");
  const reloadWorld = useRef<() => Promise<void>>(async () => {});
  const person = session.person,
    loaded = session.loaded;
  const [own, setOwn] = useState<Me | null>(null),
    [state, setState] = useState<Wf2State | null>(null),
    [founder, setFounder] = useState<FoundingWorld | null>(null),
    [error, setError] = useState(""),
    [status, setStatus] = useState("Loading account"),
    [busy, setBusy] = useState(false),
    [drafts, setDrafts] = useState<Wf2Project[]>([]),
    [site, setSite] = useState({ qx: 1792, qy: 1280 }),
    [link, setLink] = useState(""),
    [receipt, setReceipt] = useState<{
      commandId: string;
      result: Record<string, unknown>;
    } | null>(null),
    [credits, setCredits] = useState<Record<string, string[]>>({}),
    [continuation, setContinuation] = useState(
      new URLSearchParams(location.search).get("continuation") ??
        sessionStorage.getItem("wf2-join-continuation"),
    ),
    [confirmedAccount, setConfirmedAccount] = useState(""),
    [request, setRequest] = useState<{
      requestId: string;
      state: string;
    } | null>(null),
    [renderError, setRenderError] = useState(""),
    [mapReady, setMapReady] = useState(false),
    [metrics, setMetrics] = useState<object | null>(null),
    [inviteId, setInviteId] = useState<string | null>(null);
  const host = useRef<HTMLDivElement>(null),
    view = useRef<Awaited<ReturnType<typeof mountFounding>> | null>(null),
    current = useRef<Wf2State | null>(null),
    updateChain = useRef(Promise.resolve());
  const orbs = useOrbWallet(world, person?.csrfToken, state?.cursor);
  const creator = Boolean(
    person?.developmentWorldId && person.developmentWorldId === world,
  );
  useEffect(() => {
    let cancelled = false;
    if (person)
      void wf2Api<Me>("/api/wf2/me")
        .then((me) => {
          if (!cancelled) setOwn(me);
        })
        .catch((e) => {
          if (!cancelled) setError(e.message);
        });
    else {
      setOwn(null);
      setStatus(loaded ? "Sign in to continue" : "Loading account");
    }
    if (joining) {
      const pending = startJoin();
      if (pending)
        void pending
          .then((v) => {
            if (cancelled) return;
            setContinuation(v.continuationId);
            sessionStorage.setItem("wf2-join-continuation", v.continuationId);
            history.replaceState(
              null,
              "",
              "/join?continuation=" + v.continuationId,
            );
          })
          .catch((e) => {
            if (!cancelled) setError(e.message);
          });
    }
    return () => {
      cancelled = true;
    };
  }, [joining, person, loaded]);
  useEffect(() => {
    if (!joining || !continuation || !person) return;
    let cancelled = false;
    void wf2Api<{ account: { login: string | null; displayName: string } }>(
      "/api/wf2/join/continuations/" + continuation,
    )
      .then((v) => {
        if (!cancelled)
          setConfirmedAccount(
            v.account.displayName +
              (v.account.login ? " (@" + v.account.login + ")" : ""),
          );
      })
      .catch((e) => {
        if (!cancelled) setError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, [joining, continuation, person]);
  const draftVersion = useRef(0);
  async function refreshPrivate() {
    if (!world || !creator) return;
    const version = ++draftVersion.current;
    const d = await wf2Api<{ projects: Wf2Project[] }>(
      `/api/wf2/worlds/${world}/projects?state=draft`,
    );
    if (version !== draftVersion.current) return;
    setDrafts(d.projects);
    return d.projects;
  }
  useEffect(() => {
    if (!world || !person) return;
    let cancelled = false,
      stream: EventSource | null = null,
      timer: ReturnType<typeof setInterval> | null = null,
      polling = false,
      booting = false;
    const install = (s: Wf2State) => {
      if (cancelled) return;
      current.current = s;
      setState(s);
      setFounder(null);
    };
    async function bootstrap() {
      if (booting || cancelled) return;
      booting = true;
      try {
        const s = readWf2State(
          await wf2Api(`/api/wf2/worlds/${world}/bootstrap`),
        );
        install(s);
        connect();
        setStatus("Connected");
        if (creator) await refreshPrivate();
      } catch (e) {
        if (cancelled) return;
        setStatus("World unavailable");
        setError((e as Error).message);
        if (creator)
          try {
            const f = await wf2Api<FoundingWorld>("/api/founding/" + world);
            if (!cancelled) {
              setFounder(f);
              setError("");
              setStatus("Ready · participation not enabled");
            }
          } catch {
            /* Enabled/private failures never fall back to a public world. */
          }
      } finally {
        booting = false;
      }
    }
    const apply = (b: Wf2Batch) => {
      if (cancelled || !current.current) return;
      try {
        install(applyWf2Batch(current.current, b));
      } catch {
        stream?.close();
        void bootstrap();
      }
    };
    function connect() {
      stream?.close();
      if (cancelled || !current.current || document.hidden) return;
      stream = new EventSource(
        `/api/wf2/worlds/${world}/stream?after=${current.current.cursor}`,
      );
      stream.addEventListener("batch", (e) => {
        try {
          apply(JSON.parse((e as MessageEvent).data));
          setStatus("Connected");
        } catch {
          void bootstrap();
        }
      });
      stream.addEventListener("reset", () => {
        stream?.close();
        void bootstrap();
      });
      stream.addEventListener("reauth", () => {
        stream?.close();
        current.current = null;
        setState(null);
        setCredits({});
        setStatus("Access changed — sign in or request approval");
      });
      stream.onopen = () => {
        if (!cancelled) {
          setStatus("Connected");
          void orbs.refresh();
        }
      };
      stream.onerror = () => {
        if (!cancelled) setStatus("Disconnected — recovering");
      };
    }
    async function poll() {
      if (cancelled || document.hidden || polling || !current.current) return;
      polling = true;
      try {
        if (!stream || stream.readyState !== EventSource.OPEN) {
          const r = await wf2Api<{ batches: Wf2Batch[] }>(
            `/api/wf2/worlds/${world}/events?after=${current.current.cursor}`,
          );
          for (const b of r.batches) apply(b);
          setStatus("Connected by recovery polling");
          if (!stream || stream.readyState === EventSource.CLOSED) connect();
        }
      } catch (e) {
        if ((e as Error).message === "RESET_REQUIRED") void bootstrap();
        else if (
          e instanceof Wf2HttpError &&
          [401, 403, 404].includes(e.status)
        ) {
          current.current = null;
          setState(null);
          setCredits({});
          setStatus("Access unavailable");
        } else setStatus("Disconnected — retrying without changing saved work");
      } finally {
        polling = false;
      }
    }
    const visibility = () => {
      if (document.hidden) {
        stream?.close();
        stream = null;
      } else if (current.current) {
        connect();
        void poll();
      } else void bootstrap();
    };
    reloadWorld.current = bootstrap;
    void bootstrap();
    timer = setInterval(() => void poll(), 2000);
    document.addEventListener("visibilitychange", visibility);
    const offline = () => {
      stream?.close();
      stream = null;
      setStatus("Disconnected — committed work is retained");
    };
    window.addEventListener("offline", offline);
    window.addEventListener("online", visibility);
    return () => {
      cancelled = true;
      stream?.close();
      if (timer) clearInterval(timer);
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("offline", offline);
      window.removeEventListener("online", visibility);
      current.current = null;
    };
  }, [world, person, creator]);
  const [placementPhase, setPlacementPhase] =
    useState<PlacementPhase>("catalogue");
  const busyRef = useRef(busy);
  busyRef.current = busy;
  const placementRef = useRef(placementPhase);
  placementRef.current = placementPhase;
  useEffect(() => {
    if (panel !== "plan") setPlacementPhase("catalogue");
  }, [panel]);
  const hoverSite = (sample: { x: number; y: number }) => {
    if (
      !interactionRef.current.state.planMode ||
      placementRef.current !== "placing"
    )
      return;
    const next = snappedSite(sample.x, sample.y);
    setSite((previous) =>
      previous.qx === next.qx && previous.qy === next.qy ? previous : next,
    );
  };
  const chooseSite = (sample: { x: number; y: number }) => {
    if (
      interactionRef.current.state.planMode &&
      placementRef.current === "placing"
    ) {
      hoverSite(sample);
      setPlacementPhase("confirm");
    }
  };
  const renderKey = state
    ? state.worldId + ":" + state.baseline.hash
    : founder
      ? founder.id + ":" + founder.baseline.hash
      : "";
  useEffect(() => {
    if (!renderKey || !host.current) return;
    let cancelled = false;
    const node = host.current;
    setRenderError("");
    setMapReady(false);
    node.dataset.renderState = "loading";
    void import("@creators-village/renderer")
      .then((m) =>
        m.mountFounding(
          node,
          current.current
            ? {
                ...foundingHeader(current.current),
                name: entry?.name ?? "Village",
              }
            : founder!,
          (id) => panelRef.current(id),
          chooseSite,
          () => visibleWorldFrame(node),
          setLiving,
          (id) => {
            if (!id && interactionRef.current.state.following)
              interactionRef.current.send({ type: "cameraManual" });
          },
          () =>
            interactionRef.current.state.planMode &&
            placementRef.current !== "catalogue",
          hoverSite,
          () => {
            if (interactionRef.current.state.planMode) {
              if (busyRef.current) return true;
              interactionRef.current.send({ type: "close" });
              return true;
            }
            return false;
          },
        ),
      )
      .then(async (v) => {
        if (cancelled) {
          v.destroy();
          return;
        }
        view.current = v;
        if (current.current) await v.updateCurrent(current.current);
        node.dataset.renderState = "ready";
        setMapReady(true);
      })
      .catch((e) => {
        if (!cancelled) {
          setRenderError(e.message);
          node.dataset.renderState = "failed";
        }
      });
    return () => {
      cancelled = true;
      view.current?.destroy();
      view.current = null;
    };
  }, [renderKey]);
  useEffect(() => {
    if (!state || !view.current) return;
    const v = view.current;
    updateChain.current = updateChain.current
      .then(() => v.updateCurrent(state))
      .catch((e) => setRenderError(e.message));
  }, [state]);
  useEffect(() => {
    if (!state || !world) return;
    let cancelled = false;
    const revision = state.creditRevision;
    setCredits({});
    void Promise.all(
      state.projects
        .filter((p) => p.state !== "draft" && !p.fundingModel)
        .map(async (p) => {
          const r = await wf2Api<{
            creditRevision: string;
            credits: { label: string }[];
          }>(`/api/wf2/worlds/${world}/projects/${p.id}/credits`);
          return { id: p.id, ...r };
        }),
    )
      .then((results) => {
        if (cancelled || current.current?.creditRevision !== revision) return;
        const next: Record<string, string[]> = {};
        for (const r of results)
          if (r.creditRevision === revision)
            next[r.id] = r.credits.map((c) => c.label);
        setCredits(next);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [state?.creditRevision, state?.projects.length, world]);
  async function act(kind: string, payload: object = {}, route?: string) {
    if (!person || busy) return;
    setBusy(true);
    setError("");
    const orbDraft =
      Boolean(orbs.supported) && ["CreateDraft", "ReviseDraft"].includes(kind);
    const url =
        route ??
        (orbDraft
          ? `/api/wf2/worlds/${world}/orbs/drafts`
          : `/api/wf2/worlds/${world}/commands`),
      input = { kind, payload, route: url };
    const key = "wf2-pending-command";
    let pending: { input: string; commandId: string } | null = null;
    try {
      pending = JSON.parse(sessionStorage.getItem(key) ?? "null");
    } catch {
      /* Invalid local retry state is discarded. */
    }
    const fingerprint = JSON.stringify(input),
      commandId =
        pending?.input === fingerprint
          ? pending.commandId
          : crypto.randomUUID();
    sessionStorage.setItem(
      key,
      JSON.stringify({ input: fingerprint, commandId }),
    );
    try {
      const r = await wf2Api<{
        commandId: string;
        result: Record<string, unknown>;
      }>(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Token": person.csrfToken,
        },
        body: JSON.stringify({
          commandId,
          commandSchema: orbDraft ? "f3-command-1" : "wf2-command-1",
          kind,
          payload,
        }),
      });
      setReceipt(r);
      setLastAction(
        kind === "Contribute"
          ? "Your contribution is recorded."
          : kind === "PublishProject"
            ? "Your community project is ready to build."
            : kind === "SetRecognition"
              ? "Your recognition preference is saved."
              : kind === "CreateDraft" || kind === "ReviseDraft"
                ? "Your private plan is saved. Review it before starting the project."
                : "Change saved.",
      );
      if (kind === "Contribute")
        setOwn((value) =>
          value
            ? {
                ...value,
                receipts: [
                  {
                    commandId: r.commandId,
                    projectId: r.result.projectId as string,
                  },
                  ...(value.receipts ?? []).filter(
                    (v) => v.projectId !== r.result.projectId,
                  ),
                ],
              }
            : value,
        );
      sessionStorage.removeItem(key);
      if (kind === "IssueInvitation") {
        setInviteId(r.result.inviteId as string);
        const l = await wf2Api<{ url: string }>(
          `/api/wf2/worlds/${world}/invitations/${r.result.inviteId}/link`,
        );
        setLink(location.origin + l.url);
      }
      if (kind === "RequestJoin") {
        setRequest(r.result as { requestId: string; state: string });
        setConfirmedAccount("");
        sessionStorage.removeItem("wf2-join-continuation");
      }
      if (kind === "EnablePlaytest") {
        await reloadWorld.current();
        setOwn(await wf2Api<Me>("/api/wf2/me"));
      }
      if (kind === "LeaveCommunity") {
        current.current = null;
        setState(null);
        setCredits({});
        setStatus("You have left. Rejoining requires creator approval.");
        setOwn(await wf2Api<Me>("/api/wf2/me"));
      }
      if (
        creator &&
        (panel !== "admission" ||
          [
            "CreateDraft",
            "ReviseDraft",
            "PublishProject",
            "CancelProject",
          ].includes(kind)) &&
        [
          "CreateDraft",
          "ReviseDraft",
          "PublishProject",
          "CancelProject",
          "IssueInvitation",
          "RevokeInvitation",
          "ApproveRequest",
          "RejectRequest",
          "BanMember",
          "UnbanMember",
        ].includes(kind)
      ) {
        const updatedDrafts = await refreshPrivate();
        if (kind === "CreateDraft" || kind === "ReviseDraft")
          view.current?.previewPlan(
            updatedDrafts?.find((p) => p.id === r.result.projectId) ?? null,
          );
      }
      if (kind === "PublishProject") {
        view.current?.previewPlan(null);
        await reloadWorld.current();
        interactionRef.current.send({
          type: "listPick",
          ref: { kind: "site", id: r.result.projectId as string },
          view: "projects",
        });
      }
      if (kind === "CancelProject") view.current?.previewPlan(null);
      return r;
    } catch (e) {
      setError(villageActionError(e));
    } finally {
      setBusy(false);
    }
  }

  const privacyContent = (
    <>
      {" "}
      <details>
        <summary>Participation and privacy</summary>
        <p>
          Admission requires creator approval. A request link grants no access.
          Leaving requires approval to rejoin; a ban requires explicit creator
          action first. Receipts are private. Named credit on a particular
          project and its building is optional and withdrawable. Minimal
          contribution, deduplication and eligibility records remain for the
          project/world lifetime; withdrawing a name does not delete accepted
          work. Account deletion requests need administrative review. Managed
          operational logs:14 days. Replay:7 days/10,000 batches with
          current-state recovery. This is not a promise of anonymity or
          universal deletion.
        </p>
      </details>
    </>
  );
  const receiptContent = (
    <>
      {" "}
      {own?.receipts?.length ? (
        <AccountRecognition
          grants={own.grants}
          receipts={own.receipts}
          act={act}
          busy={busy}
        />
      ) : null}
      {own?.receipts?.length ? (
        <section data-private>
          <h2>Your accepted contributions</h2>
          <p>
            Private receipt references remain available after leaving.
            Withdrawing credit does not erase accepted work.
          </p>
          {own.receipts.map((r) => (
            <div key={r.commandId}>
              <button
                onClick={() =>
                  void wf2Api<{
                    commandId: string;
                    result: Record<string, unknown>;
                  }>("/api/wf2/receipts/" + r.commandId)
                    .then(setReceipt)
                    .catch((e) => setError(e.message))
                }
              >
                View my original receipt
              </button>
              <button
                disabled={busy}
                onClick={() =>
                  void act(
                    "SetRecognition",
                    { projectId: r.projectId, optedIn: false },
                    "/api/wf2/privacy/commands",
                  )
                }
              >
                Withdraw credit using this receipt
              </button>
            </div>
          ))}
        </section>
      ) : null}
      {receipt && (
        <section aria-label="Your private receipt" data-private>
          <h2>Your private receipt</h2>
          <p>
            Command committed. Its original receipt is retained independently
            from current project status.
          </p>
          <details>
            <summary>Original receipt details</summary>
            <pre>{JSON.stringify(receipt.result, null, 2)}</pre>
          </details>
        </section>
      )}
      {person && (
        <details>
          <summary>Withdraw credit for an older receipt</summary>
          <p>
            The recent list contains up to 20 contributions. If you have an
            older receipt, its project reference still lets you withdraw your
            name after leaving, without changing accepted work.
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const projectId = new FormData(e.currentTarget).get("project");
              void act(
                "SetRecognition",
                { projectId, optedIn: false },
                "/api/wf2/privacy/commands",
              );
            }}
          >
            <label>
              Project reference from your receipt
              <input
                name="project"
                required
                pattern="[0-9a-fA-F-]{36}"
                autoComplete="off"
                data-private
              />
            </label>
            <button disabled={busy}>Withdraw credit for this reference</button>
          </form>
        </details>
      )}
    </>
  );
  useEffect(() => {
    const previous = interaction.state.selection,
      next = canonicalPlace(previous, state);
    if (
      previous &&
      next &&
      (previous.kind !== next.kind || previous.id !== next.id)
    )
      interactionRef.current.send({ type: "replaceSelection", ref: next });
  }, [selected, state]);
  useSelectionProjection(view, interaction.state, mapReady);
  useEffect(() => {
    if (panel !== "plan") {
      view.current?.previewPlan(null);
      view.current?.previewPlacement(null);
    }
  }, [panel, mapReady]);
  useEffect(() => {
    const ref = interactionRef.current.state.selection;
    if (!ref) return;
    const missing =
      ref.kind === "resident"
        ? living?.plan
          ? !living.plan.residents.some((r) => r.id === ref.id)
          : false
        : ref.kind === "structure"
          ? state
            ? !state.structures.some((s) => s.id === ref.id)
            : founder
              ? founder.structure.id !== ref.id
              : false
          : ref.kind === "site"
            ? state
              ? !state.projects.some((p) => p.id === ref.id)
              : false
            : true;
    if (missing)
      interactionRef.current.send({ type: "objectRemoved", id: ref.id });
  }, [selected, state, founder, living?.plan]);
  const panelTitle: Record<string, string> = {
    places: "Places",
    inspect: "Building",
    resident: "Inhabitant",
    projects: "Projects",
    people: "People",
    admission: creator ? "Community" : "Your membership",
    settings: "Village settings",
    plan: "Build",
    privacy: "Receipts and recognition",
    history: "Village milestones",
  };
  const canManage = Boolean(
    state &&
    creator &&
    (entry?.capabilities.plan || entry?.capabilities.enable),
  );
  const canAdmit = Boolean(
    state &&
    creator &&
    (entry?.capabilities.admit || entry?.capabilities.enable),
  );
  const canContribute = Boolean(
    state && own?.grants.some((g) => g.worldId === world && g.canContribute),
  );
  const name = entry?.name ?? "Village";
  const structures =
    state?.structures ??
    (founder
      ? [{ id: founder.structure.id, template: founder.structure.template }]
      : []);
  const placeRows = villagePlaces(state, founder);
  const selectedProject = projectForPlace(interaction.state.selection, state);
  // A contribution from another session can change this account's eligibility.
  // Refresh only its own receipts, never a participant directory.
  useEffect(() => {
    if (!person || !selectedProject || selectedProject.acceptedCount === 0)
      return;
    const c = new AbortController();
    void wf2Api<Me>("/api/wf2/me", { signal: c.signal })
      .then((v) => {
        if (!c.signal.aborted) setOwn(v);
      })
      .catch(() => {});
    return () => c.abort();
  }, [person, selectedProject?.id, selectedProject?.acceptedCount]);
  const selectedPlace = placeRows.find(
    (p) => p.ref.id === interaction.state.selection?.id || p.key === selected,
  );
  const projectDescription = (p: Wf2Project) =>
    describePlace(
      {
        id: "wf2-workshop-" + p.id,
        name: "Mending Shed",
        x: p.site.qx / 256,
        y: p.site.qy / 256,
      },
      placeRows,
    );
  const close = () => interaction.send({ type: "close" });
  if (!world)
    return (
      <div className="pi-site">
        <Header />
        <main className="pi-account-page">
          <h1>{joining ? "Join the community" : "Account & privacy"}</h1>
          {session.error && (
            <Notice kind="error" onRetry={() => void session.refresh()}>
              {session.error}
            </Notice>
          )}
          {error && <Notice kind="error">{error}</Notice>}
          {!loaded ? (
            <Notice>Checking your account…</Notice>
          ) : !person ? (
            <div className="pi-empty">
              <h2>
                {joining
                  ? "Confirm your Twitch identity"
                  : "Sign in to view your receipts"}
              </h2>
              <p>
                Signing in does not send a join request or create another
                village.
              </p>
              <a className="pi-button primary" href="/auth/twitch">
                Sign in with Twitch
              </a>
            </div>
          ) : null}
          {joining && (
            <section>
              <h2>Request admission</h2>
              {confirmedAccount ? (
                <>
                  <p>Continue as {confirmedAccount}?</p>
                  <button
                    disabled={busy}
                    onClick={() =>
                      void act(
                        "RequestJoin",
                        { continuationId: continuation },
                        "/api/wf2/join/commands",
                      )
                    }
                  >
                    Request creator approval
                  </button>
                </>
              ) : (
                <p>
                  {person
                    ? "Open a valid request link, or check your request below."
                    : "Sign in with Twitch to confirm your account. Signing in does not submit a request."}
                </p>
              )}
              {request && (
                <p>
                  Request recorded. A request does not grant village access.
                  Check approval for current status.
                </p>
              )}
              {own?.requests.map((r) => (
                <p key={r.requestId}>
                  Your request: {r.state}
                  {r.state === "pending" && (
                    <button
                      disabled={busy}
                      onClick={() =>
                        void act(
                          "LeaveCommunity",
                          {},
                          "/api/wf2/worlds/" + r.worldId + "/commands",
                        )
                      }
                    >
                      Withdraw this pending request
                    </button>
                  )}
                </p>
              ))}
              <button
                disabled={!person || busy}
                onClick={() =>
                  void wf2Api<Me>("/api/wf2/me")
                    .then(setOwn)
                    .catch((e) => setError(e.message))
                }
              >
                Check approval
              </button>
            </section>
          )}

          {!joining && person && (
            <>
              <p>
                Recognition is optional and project-specific. Your own receipts
                and withdrawal controls remain available after leaving a
                village.
              </p>
              {receiptContent}
              {privacyContent}
              <button
                className="pi-button"
                onClick={() =>
                  void wf2Api("/auth/logout", {
                    method: "POST",
                    headers: { "X-CSRF-Token": person.csrfToken },
                  })
                    .then(async () => {
                      await session.refresh();
                      navigate("/");
                    })
                    .catch((e) => setError(e.message))
                }
              >
                Sign out
              </button>
            </>
          )}
          {own?.grants.map((g) => (
            <p key={g.worldId}>
              <Link href={"/villages/" + g.worldId}>
                Enter approved development village
              </Link>
            </p>
          ))}
          {lastAction && <Notice>{lastAction}</Notice>}
        </main>
      </div>
    );
  return (
    <div
      className="pi-village ui3-shell"
      data-placement-phase={panel === "plan" ? placementPhase : undefined}
    >
      <span className="ux1-announcement" role="status">
        {interaction.notice
          ? "Stopped following " +
            (living?.plan.residents.find((r) => r.id === interaction.notice)
              ?.name ?? "the inhabitant") +
            "."
          : ""}
      </span>
      <WorldNav
        activePanel={
          interaction.state.selection &&
          interaction.state.returnView === "projects"
            ? "projects"
            : panel
        }
        onTab={(view) => interaction.send({ type: "tab", view })}
        entry={entry}
        name={name}
        status={status}
        projects={Boolean(state)}
        people={Boolean(state || founder)}
        community={Boolean(state && person)}
        manage={Boolean(person)}
      />
      <main className="pi-world-stage">
        <div
          ref={host}
          className="pi-canvas"
          aria-label="Explore the same persistent village"
        />
        <div className="pi-world-label">Private village</div>
        {!state && !founder && (
          <div className="pi-world-loading">
            <h2>
              {!loaded
                ? "Checking account…"
                : status.startsWith("Access") ||
                    status.startsWith("You have left")
                  ? "Village access changed"
                  : "Opening your village…"}
            </h2>
            <p>{status}</p>
            <Link className="pi-button" href="/communities">
              My Communities
            </Link>
            {!person && loaded && (
              <a className="pi-button primary" href="/auth/twitch">
                Sign in with Twitch
              </a>
            )}
            {error && <Notice kind="error">{error}</Notice>}
          </div>
        )}
        {(state || founder) && (
          <CameraControls
            disabled={!mapReady}
            reset={() => view.current?.reset()}
            zoom={(f) => view.current?.zoom(f)}
          />
        )}
        {renderError && (
          <div className="pi-world-alert">
            <Notice kind="error">
              Map unavailable: {renderError}. Places and project status remain
              available.
            </Notice>
          </div>
        )}
        {(state || founder) && !mapReady && !renderError && (
          <div className="pi-map-loading" role="status">
            Opening the saved landscape… Projects and places remain available.
          </div>
        )}
        {error && (state || founder) && (
          <div className="pi-world-alert">
            <Notice kind="error">
              {error}
              <button onClick={() => setError("")}>Dismiss</button>
            </Notice>
          </div>
        )}
        {busy && (
          <div className="pi-pending" role="status">
            Saving your action…
          </div>
        )}
        {lastAction && !busy && (
          <div className="pi-success" role="status">
            {lastAction}
            <button
              aria-label="Dismiss confirmation"
              onClick={() => setLastAction("")}
            >
              ×
            </button>
          </div>
        )}
        {creator &&
          new URLSearchParams(location.search).get("tools") === "renderer" &&
          /^(127\.|localhost$)/.test(location.hostname) && (
            <details className="f2-developer">
              <summary>Developer renderer tools</summary>
              <button onClick={() => setMetrics(view.current?.stats() ?? null)}>
                Measure renderer
              </button>
              {metrics && <pre>{JSON.stringify(metrics, null, 2)}</pre>}
            </details>
          )}
        {orbs.wallet && <OrbHUD wallet={orbs.wallet} error={orbs.error} />}
        {panel && (
          <Panel
            contextKey={
              ["inspect", "resident", "projects"].includes(panel)
                ? selected
                : panel
            }
            title={panelTitle[panel] ?? "Village tools"}
            onClose={() => {
              if (panel !== "plan" || !busy) close();
            }}
            onEscape={() => {
              if (panel === "plan" && !busy) close();
              else if (panel !== "plan") interaction.send({ type: "escape" });
            }}
            back={
              interaction.state.selection
                ? {
                    label:
                      interaction.state.returnView === "projects"
                        ? "Projects"
                        : interaction.state.returnView === "people"
                          ? "People"
                          : "Places",
                    onBack: () => interaction.send({ type: "back" }),
                  }
                : undefined
            }
            locate={
              interaction.state.selection &&
              mapReady &&
              (interaction.state.selection.kind !== "site" ||
                state?.projects.some(
                  (p) =>
                    p.id === interaction.state.selection!.id &&
                    !["cancelled", "draft"].includes(p.state),
                ))
                ? () =>
                    view.current?.focusSelection(interaction.state.selection!)
                : undefined
            }
            memory={
              interaction.memories[panel as "people" | "places" | "projects"]
            }
          >
            {panel === "places" && (
              <>
                <VillageDirectory
                  label="Places"
                  memory={interaction.memories.places}
                  items={placeRows.map((p) => ({
                    key: p.key,
                    name: p.name,
                    description: p.kind + " · " + p.description,
                    status: p.status,
                  }))}
                  select={(key) => {
                    const place = placeRows.find((p) => p.key === key);
                    if (place)
                      interaction.send({
                        type: "listPick",
                        ref: place.ref,
                        view: "places",
                      });
                  }}
                  empty="No places are available in this saved world."
                />
                {canManage && (
                  <button
                    className="pi-button primary"
                    onClick={() => setPanel("plan")}
                  >
                    Build
                  </button>
                )}
              </>
            )}
            {panel === "inspect" &&
              (selectedProject && state ? (
                <>
                  {" "}
                  {state.projects
                    .filter((p) => p.id === selectedProject?.id)
                    .map((p) => {
                      const construction = constructionView(
                        p,
                        state.structures,
                      );
                      const worker =
                        living?.plan.topologyEpoch === state.topologyEpoch
                          ? living.plan.residents.find((r) =>
                              r.goals?.some(
                                (g) =>
                                  g.activity === "work" &&
                                  g.structureId === construction.structureId,
                              ),
                            )
                          : undefined;
                      return (
                        <ProjectInspector
                          key={p.id}
                          project={p}
                          description={projectDescription(p)}
                          construction={construction}
                          creator={creator}
                          canContribute={canContribute}
                          accessLoaded={Boolean(own)}
                          alreadyContributed={Boolean(
                            own?.receipts?.some((r) => r.projectId === p.id),
                          )}
                          busy={busy}
                          onContribute={() =>
                            void act("Contribute", {
                              projectId: p.id,
                              planHash: p.planHash,
                              recognitionOptIn: false,
                            })
                          }
                          onRetry={() =>
                            void act("RetryCompletion", {
                              projectId: p.id,
                              expectedProjectRevision: p.revision,
                              planHash: p.planHash,
                            })
                          }
                          onCancel={() =>
                            void act("CancelProject", {
                              projectId: p.id,
                              expectedProjectRevision: p.revision,
                            })
                          }
                          workerName={worker?.name}
                          findWorker={() => {
                            if (worker) {
                              selectPlace(worker.id);
                              view.current?.focusResident(worker.id);
                            }
                          }}
                          funding={
                            p.fundingModel && person ? (
                              <OrbFunding
                                world={world!}
                                project={p}
                                csrf={person.csrfToken}
                                wallet={orbs.wallet}
                                canContribute={canContribute}
                                refresh={orbs.refresh}
                                creditRevision={state.creditRevision}
                              />
                            ) : undefined
                          }
                          credits={credits[p.id]}
                        />
                      );
                    })}
                </>
              ) : (
                <>
                  <h3>Gathering Shelter</h3>
                  <p className="ux1-meta">Gathering place · Founded</p>
                  <p>A shared place to meet and care for the village.</p>
                </>
              ))}
            {panel === "resident" && (
              <ResidentPanel
                living={living}
                id={selected}
                following={interaction.state.following === selected}
                focus={() => interaction.send({ type: "followToggle" })}
              />
            )}
            {panel === "projects" && state && (
              <>
                {!selected.startsWith("project:") && (
                  <VillageDirectory
                    label="Projects"
                    memory={interaction.memories.projects}
                    items={state.projects
                      .filter((p) => p.state !== "draft")
                      .map((p) => ({
                        key: "project:" + p.id,
                        name: "Mending Shed",
                        description: projectDescription(p),
                        status:
                          constructionView(p, state.structures).label +
                          " · " +
                          p.acceptedCount +
                          "/" +
                          p.goal +
                          (p.fundingModel ? " Orbs" : ""),
                        group: ["completed", "cancelled"].includes(p.state)
                          ? "History"
                          : "Current",
                      }))}
                    select={selectPlace}
                    empty="No published projects yet."
                  />
                )}
                {!selected.startsWith("project:") && canManage && (
                  <button
                    className="pi-button primary"
                    onClick={() => setPanel("plan")}
                  >
                    Build
                  </button>
                )}
                {!selected.startsWith("project:") &&
                  state.projects.some((p) => p.state !== "draft") && (
                    <button onClick={() => setPanel("history")}>
                      Project history
                    </button>
                  )}
              </>
            )}
            {panel === "plan" &&
              state &&
              (canManage ? (
                <WorkshopPlanner
                  phase={placementPhase}
                  setPhase={setPlacementPhase}
                  world={world!}
                  csrf={person!.csrfToken}
                  topology={state.topologyEpoch}
                  site={site}
                  setSite={setSite}
                  drafts={drafts.filter(
                    (d) => Boolean(d.fundingModel) === Boolean(orbs.supported),
                  )}
                  orbMode={Boolean(orbs.supported)}
                  busy={busy}
                  ready={mapReady && orbs.supported !== undefined}
                  command={act}
                  preview={(value) => view.current?.previewPlacement(value)}
                  showDraft={(value) => view.current?.previewPlan(value)}
                  cancel={() => setPanel("projects")}
                  activeProject={
                    state.projects.find((p) =>
                      ["open", "ready", "blocked"].includes(p.state),
                    )?.id
                  }
                  openProject={(id) =>
                    interaction.send({
                      type: "listPick",
                      ref: { kind: "site", id },
                      view: "projects",
                    })
                  }
                />
              ) : (
                <p>
                  Project planning is available only to the authorised creator.
                </p>
              ))}
            {panel === "people" && (
              <>
                <ResidentList
                  living={living}
                  select={selectPlace}
                  memory={interaction.memories.people}
                  following={interaction.state.following}
                />
              </>
            )}
            {panel === "admission" &&
              state &&
              (creator && canAdmit ? (
                <CommunityPanel
                  key={world + ":" + person?.csrfToken}
                  world={world!}
                  creatorName={person?.displayName ?? "Creator"}
                  busy={busy}
                  act={act}
                  link={link}
                  inviteId={inviteId}
                  csrf={person?.csrfToken}
                />
              ) : (
                <>
                  <p>
                    Your access is approved for this private village. Other
                    members’ identities are not listed here.
                  </p>
                  <ConfirmAction
                    label="Leave this community"
                    description="You will lose village access. Your contribution receipts remain in your account."
                    confirmLabel="Confirm leaving"
                    disabled={busy}
                    onConfirm={() => void act("LeaveCommunity")}
                  />
                </>
              ))}
            {panel === "settings" && (
              <>
                <p className="pi-muted">Appearance and account</p>{" "}
                {founder && creator && entry?.capabilities.enable && (
                  <section>
                    <h2>Enable the approved private playtest</h2>
                    <p>
                      Use this existing development world. Your original village
                      and saved geography stay intact.
                    </p>
                    <button
                      disabled={busy}
                      onClick={() =>
                        void act("EnablePlaytest", {
                          expectedBaselineHash: founder.baseline.hash,
                        })
                      }
                    >
                      Enable private participation
                    </button>
                  </section>
                )}
                <Link className="pi-text-link" href="/settings">
                  Account and privacy settings
                </Link>
                <VillageAtmosphere />
              </>
            )}
            {panel === "privacy" && (
              <>
                {receiptContent}
                {privacyContent}
                <Link href="/settings">Open account privacy settings</Link>
              </>
            )}
            {panel === "history" && (
              <>
                {state?.projects
                  .filter((p) => p.state !== "draft")
                  .map((p) => (
                    <article key={p.id}>
                      <h3>
                        {p.state === "completed"
                          ? "The community built a workshop"
                          : "A workshop project"}
                      </h3>
                      <p>
                        {p.acceptedCount}/{p.goal}{" "}
                        {p.fundingModel ? "Orbs" : "contributions"} · {p.state}
                      </p>
                      {p.state === "completed" && (
                        <button
                          onClick={() => selectPlace("wf2-workshop-" + p.id)}
                        >
                          Inspect the completed place
                        </button>
                      )}
                    </article>
                  ))}
                {!state?.projects.length && (
                  <p>
                    The village’s story begins with its gathering shelter.
                    Published projects will leave milestones here.
                  </p>
                )}
              </>
            )}
            {!person && <a href="/auth/twitch">Sign in with Twitch</a>}
          </Panel>
        )}
      </main>
    </div>
  );
}
