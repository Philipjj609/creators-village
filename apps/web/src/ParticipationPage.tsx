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
import { applyWf2Batch, readWf2State } from "./wf2-state.js";
import { api as wf2Api, HttpError as Wf2HttpError } from "./api.js";
import { Link, navigate, usePanel } from "./routing.js";
import { useSession } from "./session.js";
import { visibleWorldFrame } from "./viewport.js";
import { Header, WorldNav, CameraControls, Panel, Notice } from "./ui.js";
export { api as wf2Api } from "./api.js";
type Me = {
  grants: { worldId: string; canContribute: boolean }[];
  requests: { requestId: string; state: string; worldId: string }[];
  receipts: { commandId: string; projectId: string }[];
};
type Admission = {
  requests: {
    requestId: string;
    revision: string;
    login: string | null;
    displayName: string;
  }[];
  members: {
    memberId: string;
    revision: string;
    state: string;
    login: string | null;
    displayName: string;
  }[];
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
    name: "Private development village",
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
    [panel, setPanel] = usePanel();
  const [selected, setSelected] = useState("founding-shelter");
  const selectPlace = (id = "founding-shelter") => {
    setSelected(id);
    setPanel(id.includes(":lw1:") ? "resident" : "inspect");
    view.current?.selectResident(id);
  };
  const panelRef = useRef(selectPlace);
  const [living, setLiving] = useState<LivingViewState | null>(null);
  panelRef.current = selectPlace;
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
    [admission, setAdmission] = useState<Admission | null>(null),
    [drafts, setDrafts] = useState<Wf2Project[]>([]),
    [site, setSite] = useState({ qx: 1792, qy: 1280 }),
    [optIn, setOptIn] = useState<Record<string, boolean>>({}),
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
  async function refreshPrivate() {
    if (!world || !creator) return;
    const [a, d] = await Promise.all([
      wf2Api<Admission>(`/api/wf2/worlds/${world}/admission`),
      wf2Api<{ projects: Wf2Project[] }>(
        `/api/wf2/worlds/${world}/projects?state=draft`,
      ),
    ]);
    setAdmission(a);
    setDrafts(d.projects);
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
        if (!cancelled) setStatus("Connected");
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
                name: entry?.name ?? "Private development village",
              }
            : founder!,
          (id) => panelRef.current(id),
          (sample) =>
            setSite({
              qx: Math.round(sample.x * 2) * 128,
              qy: Math.round(sample.y * 2) * 128,
            }),
          () => visibleWorldFrame(node),
          setLiving,
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
        .filter((p) => p.state !== "draft")
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
    const url = route ?? `/api/wf2/worlds/${world}/commands`,
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
          commandSchema: "wf2-command-1",
          kind,
          payload,
        }),
      });
      setReceipt(r);
      setLastAction(
        kind === "Contribute"
          ? "Your contribution is recorded."
          : kind === "PublishProject"
            ? "The fixed project is published."
            : kind === "SetRecognition"
              ? "Your recognition preference is saved."
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
      if (creator && kind !== "EnablePlaytest") await refreshPrivate();
    } catch (e) {
      setError((e as Error).message);
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
  const panelTitle: Record<string, string> = {
    places: "Places",
    inspect: "Place inspection",
    resident: "Resident inspection",
    projects: "Community projects",
    people: creator ? "Private admission" : "Your membership",
    settings: "Settings and management",
    plan: "Plan a workshop",
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
  const name = entry?.name ?? "Development village";
  const structures =
    state?.structures ??
    (founder
      ? [{ id: founder.structure.id, template: founder.structure.template }]
      : []);
  const close = () => setPanel("");
  const inspect = () =>
    void view.current
      ?.focusStructure(selected)
      .catch((e) => setRenderError(e.message));
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
    <div className="pi-village">
      <WorldNav
        name={name}
        status={status}
        projects={Boolean(state)}
        people={Boolean(state && person)}
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
            places={() => setPanel("places")}
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
        {panel && (
          <Panel title={panelTitle[panel] ?? "Village tools"} onClose={close}>
            {panel === "places" && (
              <>
                <p>Choose a place to inspect.</p>
                {structures.map((s) => (
                  <button
                    className="pi-place-row"
                    key={s.id}
                    onClick={() => selectPlace(s.id)}
                  >
                    {s.template === "wf2-workshop-1"
                      ? "Inspect the Mending Shed"
                      : "Inspect the Gathering Shelter"}
                    <span aria-hidden="true">↗</span>
                  </button>
                ))}
                <button onClick={() => view.current?.previewPlan(null)}>
                  Hide plan preview
                </button>
                <ResidentList living={living} select={selectPlace} />
              </>
            )}
            {panel === "inspect" && (
              <>
                <h3>
                  {selected === "founding-shelter"
                    ? "The Gathering Shelter"
                    : "The Mending Shed"}
                </h3>
                <p>
                  {selected === "founding-shelter"
                    ? "The village’s founding gathering place. Its identity stays with the world as the community builds."
                    : "A workshop built through the community’s approved shared project."}
                </p>
                {structures.some((s) => s.id === selected) && (
                  <dl className="lw-facts">
                    <dt>Function</dt>
                    <dd>
                      {selected === "founding-shelter"
                        ? "Gathering and shelter"
                        : "Mending and workshop space"}
                    </dd>
                    <dt>Saved status</dt>
                    <dd>
                      {selected === "founding-shelter"
                        ? "Founded with this village"
                        : "Completed structure"}
                    </dd>
                  </dl>
                )}
                {state?.projects
                  .filter(
                    (p) =>
                      p.state === "completed" &&
                      selected === "wf2-workshop-" + p.id,
                  )
                  .map((p) => (
                    <section
                      key={p.id}
                      aria-label="Related construction project"
                    >
                      <h4>Construction record</h4>
                      <p>
                        {p.acceptedCount}/{p.goal} accepted contributions ·{" "}
                        {p.state}
                      </p>
                      <p>
                        {credits[p.id]?.length
                          ? `With thanks to ${credits[p.id]!.join(", ")}`
                          : credits[p.id]
                            ? "No named attribution is currently displayed."
                            : "Named recognition is refreshing or unavailable."}
                      </p>
                      <button onClick={() => setPanel("history")}>
                        Related project history
                      </button>
                    </section>
                  ))}
                <button className="pi-button primary" onClick={inspect}>
                  Take a closer look
                </button>
                <button onClick={() => view.current?.reset()}>
                  Village overview
                </button>
                {state && (
                  <button onClick={() => setPanel("projects")}>
                    View community projects
                  </button>
                )}
              </>
            )}
            {panel === "resident" && (
              <ResidentPanel
                living={living}
                id={selected}
                focus={() => view.current?.focusResident(selected)}
                overview={() => view.current?.reset()}
              />
            )}
            {panel === "projects" && state && (
              <>
                <p className="pi-muted">
                  Private test policy · one deliberate contribution per account
                  per project. Two people for this test, no wallet or passive
                  rewards.
                </p>{" "}
                {state.projects.map((p) => (
                  <section key={p.id} className="wf2-project">
                    <h2>Community workshop</h2>
                    <p>
                      {p.acceptedCount}/{p.goal} contributions · {p.state}
                    </p>
                    <p>
                      Location {p.site.qx / 256}, {p.site.qy / 256}. Workshop
                      and connecting path are fixed after publication.
                    </p>
                    {p.state === "open" &&
                      canContribute &&
                      !own?.receipts?.some((r) => r.projectId === p.id) && (
                        <>
                          <label>
                            <input
                              type="checkbox"
                              checked={optIn[p.id] ?? false}
                              onChange={(e) => {
                                const checked = e.target.checked;
                                setOptIn((previous) => ({
                                  ...previous,
                                  [p.id]: checked,
                                }));
                              }}
                            />{" "}
                            Name me on this project and its resulting building
                            (optional)
                          </label>
                          <button
                            className="pi-button primary"
                            disabled={busy}
                            onClick={() =>
                              void act("Contribute", {
                                projectId: p.id,
                                planHash: p.planHash,
                                recognitionOptIn: optIn[p.id] ?? false,
                              })
                            }
                          >
                            Contribute once to this project
                          </button>
                        </>
                      )}
                    {own?.receipts?.some((r) => r.projectId === p.id) && (
                      <p>
                        Your contribution is recorded. Current project status is
                        shown above.
                      </p>
                    )}
                    {p.blockedCode && (
                      <p role="status">
                        Construction blocked: {p.blockedCode}. Accepted
                        contributions are retained.
                      </p>
                    )}
                    {creator && p.state === "blocked" && (
                      <button
                        disabled={busy}
                        onClick={() =>
                          void act("RetryCompletion", {
                            projectId: p.id,
                            expectedProjectRevision: p.revision,
                            planHash: p.planHash,
                          })
                        }
                      >
                        Retry the same plan
                      </button>
                    )}
                    {creator &&
                      !["cancelled", "completed"].includes(p.state) && (
                        <button
                          disabled={busy}
                          onClick={() =>
                            void act("CancelProject", {
                              projectId: p.id,
                              expectedProjectRevision: p.revision,
                            })
                          }
                        >
                          Cancel project and release reservations
                        </button>
                      )}
                    {own?.receipts?.some((r) => r.projectId === p.id) && (
                      <>
                        <button
                          disabled={busy}
                          onClick={() =>
                            void act(
                              "SetRecognition",
                              { projectId: p.id, optedIn: false },
                              "/api/wf2/privacy/commands",
                            )
                          }
                        >
                          Withdraw my named credit
                        </button>
                        <button
                          disabled={busy}
                          onClick={() =>
                            void act("SetRecognition", {
                              projectId: p.id,
                              optedIn: true,
                            })
                          }
                        >
                          Opt into named credit for this project/building
                        </button>
                      </>
                    )}
                    {credits[p.id]?.length ? (
                      <p data-private>
                        With thanks to {credits[p.id]!.join(", ")}
                      </p>
                    ) : null}
                  </section>
                ))}
                {state.projects.length === 0 && (
                  <p>
                    No published projects yet. The creator can plan a workshop.
                  </p>
                )}
                {canManage && (
                  <button
                    className="pi-button primary"
                    onClick={() => setPanel("plan")}
                  >
                    Plan a workshop
                  </button>
                )}
                <button onClick={() => setPanel("history")}>
                  Village milestones
                </button>
              </>
            )}
            {panel === "plan" &&
              state &&
              (canManage ? (
                <>
                  {" "}
                  <section>
                    <h2>Plan a workshop</h2>
                    <p>
                      Tap terrain to choose a center, then preview a draft. The
                      server validates terrain, footprint, entrance and a
                      connecting path; it reserves nothing until publication.
                    </p>
                    <label>
                      East coordinate
                      <input
                        type="number"
                        step="0.5"
                        value={site.qx / 256}
                        onChange={(e) =>
                          setSite({
                            ...site,
                            qx: Math.round(Number(e.target.value) * 2) * 128,
                          })
                        }
                      />
                    </label>
                    <label>
                      South coordinate
                      <input
                        type="number"
                        step="0.5"
                        value={site.qy / 256}
                        onChange={(e) =>
                          setSite({
                            ...site,
                            qy: Math.round(Number(e.target.value) * 2) * 128,
                          })
                        }
                      />
                    </label>
                    <button
                      disabled={busy}
                      onClick={() => void act("CreateDraft", { site })}
                    >
                      Preview workshop plan
                    </button>
                    {drafts.map((p) => (
                      <div key={p.id}>
                        <p>
                          Draft at {p.site.qx / 256}, {p.site.qy / 256}; 6×6
                          footprint and {p.path.points.length}-point path. Goal:{" "}
                          {p.goal} deliberate contributions.
                        </p>
                        <button onClick={() => view.current?.previewPlan(p)}>
                          Show this draft on the map
                        </button>
                        <button
                          className="pi-button primary"
                          disabled={busy}
                          onClick={() =>
                            void act("PublishProject", {
                              projectId: p.id,
                              expectedProjectRevision: p.revision,
                              planHash: p.planHash,
                            })
                          }
                        >
                          Publish this fixed plan
                        </button>
                        <button
                          disabled={busy}
                          onClick={() =>
                            void act("ReviseDraft", {
                              projectId: p.id,
                              expectedProjectRevision: p.revision,
                              site,
                            })
                          }
                        >
                          Move draft to selected site
                        </button>
                        <button
                          disabled={busy}
                          onClick={() =>
                            void act("CancelProject", {
                              projectId: p.id,
                              expectedProjectRevision: p.revision,
                            })
                          }
                        >
                          Discard draft
                        </button>
                      </div>
                    ))}
                  </section>
                </>
              ) : (
                <p>
                  Project planning is available only to the authorised creator.
                </p>
              ))}
            {panel === "people" &&
              state &&
              (creator && canAdmit ? (
                <>
                  {" "}
                  <section>
                    <h2>Private admission</h2>
                    <button
                      disabled={busy}
                      onClick={() => void act("IssueInvitation")}
                    >
                      Create one-use, 24-hour request link
                    </button>
                    <button
                      onClick={() =>
                        void refreshPrivate().catch((e) => setError(e.message))
                      }
                    >
                      Refresh admission
                    </button>
                    {link && (
                      <label>
                        Share this privately
                        <input
                          readOnly
                          data-private
                          value={link}
                          onFocus={(e) => e.target.select()}
                        />
                      </label>
                    )}
                    {inviteId && (
                      <button
                        disabled={busy}
                        onClick={() =>
                          void act("RevokeInvitation", { inviteId })
                        }
                      >
                        Revoke unused request link
                      </button>
                    )}
                    {admission?.requests.map((r) => (
                      <div key={r.requestId}>
                        <p>
                          <span data-private>
                            {r.displayName}{" "}
                            {r.login ? "(@" + r.login + ")" : ""}
                          </span>
                        </p>
                        <button
                          disabled={busy}
                          onClick={() =>
                            void act("ApproveRequest", {
                              requestId: r.requestId,
                              expectedRequestRevision: r.revision,
                            })
                          }
                        >
                          Approve
                        </button>
                        <button
                          disabled={busy}
                          onClick={() =>
                            void act("RejectRequest", {
                              requestId: r.requestId,
                              expectedRequestRevision: r.revision,
                            })
                          }
                        >
                          Decline
                        </button>
                      </div>
                    ))}
                    {admission?.members.map((m) => (
                      <div key={m.memberId}>
                        <p>
                          <span data-private>{m.displayName}</span> · {m.state}
                        </p>
                        <button
                          disabled={busy}
                          onClick={() =>
                            void act(
                              m.state === "banned"
                                ? "UnbanMember"
                                : "BanMember",
                              {
                                memberId: m.memberId,
                                expectedMembershipRevision: m.revision,
                              },
                            )
                          }
                        >
                          {m.state === "banned"
                            ? "Unban — approval still required"
                            : "Ban member"}
                        </button>
                      </div>
                    ))}
                  </section>
                </>
              ) : (
                <>
                  <p>
                    Your access is approved for this private village. Other
                    members’ identities are not listed here.
                  </p>
                  <button
                    disabled={busy}
                    onClick={() => void act("LeaveCommunity")}
                  >
                    Leave this community
                  </button>
                </>
              ))}
            {panel === "settings" && (
              <>
                <p className="pi-muted">
                  {creator ? "Creator controls" : "Your village settings"}
                </p>{" "}
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
                {state && canManage && (
                  <button onClick={() => setPanel("plan")}>
                    Plan a workshop
                  </button>
                )}
                {state && canAdmit && (
                  <button onClick={() => setPanel("people")}>
                    Manage admission
                  </button>
                )}
                <button onClick={() => setPanel("privacy")}>
                  Receipts and recognition
                </button>
                <Link className="pi-text-link" href="/settings">
                  Account and privacy settings
                </Link>
                {privacyContent}
                {state && (
                  <details>
                    <summary>Technical diagnostics</summary>
                    <button
                      onClick={() => {
                        const stats = view.current?.stats();
                        if (stats) {
                          const { baselineHash: _hash, ...safe } = stats;
                          setMetrics(safe);
                        }
                      }}
                    >
                      Measure renderer
                    </button>
                    {metrics && (
                      <pre data-wf2-metrics>
                        {JSON.stringify(metrics, null, 2)}
                      </pre>
                    )}
                  </details>
                )}
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
                        {p.acceptedCount}/{p.goal} contributions · {p.state}
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
