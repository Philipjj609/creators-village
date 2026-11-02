import { useCallback, useEffect, useRef, useState } from "react";
import type { Communities, WorldEntry } from "@creators-village/contracts";
import { api, HttpError } from "./api.js";
import { Link } from "./routing.js";
import { useSession } from "./session.js";
import { Wordmark } from "./brand.js";
import { Icon, Notice } from "./ui.js";
import { SectionLink } from "./section-link.js";
import {
  appendJoined,
  requestView,
  type CommunityAccount,
} from "./community-view.js";
import { FollowDiscovery } from "./FollowDiscovery.js";
import "./communities.css";

function Header() {
  const { person, loaded } = useSession();
  return (
    <header className="cui-header">
      <div className="cui-header-inner">
        <Link
          className="cui-brand"
          href="/"
          aria-label="Creator’s Village home"
        >
          <Wordmark />
        </Link>
        <nav aria-label="Main navigation">
          <Link href="/communities" aria-current="page">
            My Communities
          </Link>
        </nav>
        {person ? (
          <Link
            className="cui-account"
            href="/settings"
            aria-label="Account and privacy"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M12.00,2.00 L13.95,2.19 L15.06,4.61 L16.44,5.35 L19.07,4.93 L20.31,6.44 L19.39,8.94 L19.85,10.44 L22.00,12.00 L21.81,13.95 L19.39,15.06 L18.65,16.44 L19.07,19.07 L17.56,20.31 L15.06,19.39 L13.56,19.85 L12.00,22.00 L10.05,21.81 L8.94,19.39 L7.56,18.65 L4.93,19.07 L3.69,17.56 L4.61,15.06 L4.15,13.56 L2.00,12.00 L2.19,10.05 L4.61,8.94 L5.35,7.56 L4.93,4.93 L6.44,3.69 L8.94,4.61 L10.44,4.15 Z" />
              <circle cx="12" cy="12" r="3.3" />
            </svg>
            <span>Account</span>
          </Link>
        ) : loaded ? (
          <a className="cui-button primary" href="/auth/twitch">
            <img
              src="/landing-art/ui1-01/twitch-glitch-white.svg"
              width="16"
              height="19"
              alt=""
            />
            Join with Twitch
          </a>
        ) : (
          <span className="cui-muted" role="status">
            Checking account…
          </span>
        )}
      </div>
    </header>
  );
}
function WorldCard({
  world,
  feature = false,
  joined = false,
}: {
  world: WorldEntry;
  feature?: boolean;
  joined?: boolean;
}) {
  const privateTest = world.purpose === "development";
  const status = privateTest
    ? "Private test village"
    : world.version === 1
      ? "Original village"
      : "Saved village";
  return (
    <article className={"cui-world" + (feature ? " cui-feature" : "")}>
      <div className="cui-world-art">
        <img
          src={
            "/landing-art/ui1-01/" +
            (feature ? "cv-hero-village-mobile-1100.webp" : "belong-720.webp")
          }
          width={feature ? 1100 : 720}
          height={feature ? 696 : 451}
          alt="Illustrated village with cottages and shared paths; promotional artwork"
          loading={feature ? "eager" : "lazy"}
        />
      </div>
      <div className="cui-world-copy">
        <div className="cui-badges">
          <span className={"cui-badge " + (privateTest ? "violet" : "muted")}>
            {status}
          </span>
          {joined && <span className="cui-badge sage">Approved member</span>}
        </div>
        <h3 data-private>{world.name}</h3>
        {world.creatorDisplayName && (
          <p className="cui-creator" data-private>
            Created by <strong>{world.creatorDisplayName}</strong>
          </p>
        )}
        {!joined && (
          <p className="cui-world-note">
            {privateTest
              ? "Separate from your original village. Entry stays limited to you and approved participants."
              : world.version === 1
                ? "Your original world and its saved history."
                : "Your shared landscape, ready for your next visit."}
          </p>
        )}
        <div className="cui-card-actions">
          <Link
            className={"cui-button " + (feature ? "primary" : "secondary")}
            href={"/villages/" + world.id}
          >
            Enter village <span aria-hidden="true">↗</span>
          </Link>
          {world.isCreator &&
            (world.capabilities.plan ||
              world.capabilities.admit ||
              world.capabilities.enable) && (
              <Link
                className="cui-text-link"
                href={"/villages/" + world.id + "?panel=settings"}
              >
                Village settings
              </Link>
            )}
        </div>
      </div>
    </article>
  );
}
function failure(error: unknown, subject: string) {
  return error instanceof HttpError &&
    (error.status === 401 || error.status === 403)
    ? "Your connection needs to be checked. Retry or reconnect with Twitch."
    : "We couldn’t load " + subject + ". Please try again.";
}
export function MyCommunities() {
  const { person, loaded, error: accountError, refresh } = useSession();
  const actor = person?.csrfToken ?? "";
  const activeActor = useRef(actor);
  activeActor.current = actor;
  const [snapshot, setSnapshot] = useState<{
    actor: string;
    data: Communities;
  } | null>(null);
  const [accountSnapshot, setAccountSnapshot] = useState<{
    actor: string;
    data: CommunityAccount;
  } | null>(null);
  const [error, setError] = useState(""),
    [requestError, setRequestError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [refreshMessage, setRefreshMessage] = useState("");
  const refreshLock = useRef<string | null>(null);
  const [more, setMore] = useState(false),
    [moreError, setMoreError] = useState("");
  const moreLock = useRef(false);
  const dataVersion = useRef(0);
  const [invite, setInvite] = useState<{
    actor: string;
    id: string;
    ready: boolean;
    used: boolean;
  } | null>(null);
  const data = snapshot?.actor === actor ? snapshot.data : null;
  const account =
    accountSnapshot?.actor === actor ? accountSnapshot.data : null;
  const visibleCount = useRef(0);
  visibleCount.current = data?.joined.length ?? 0;
  const refreshRequests = useCallback(async () => {
    if (!actor || refreshLock.current === actor || moreLock.current) return;
    refreshLock.current = actor;
    const version = ++dataVersion.current;
    moreLock.current = false;
    setMore(false);
    setMoreError("");
    setRefreshing(true);
    setRefreshMessage("Refreshing status…");
    setError("");
    setRequestError("");
    let continuation: string | null = null;
    try {
      continuation = sessionStorage.getItem("wf2-join-continuation");
    } catch {
      /* Storage is optional. */
    }
    const id =
      continuation && /^[0-9a-f-]{36}$/i.test(continuation)
        ? continuation
        : null;
    const count = visibleCount.current;
    const communities = async () => {
      let next = await api<Communities>("/api/communities");
      // Revalidate every already-visible page, retaining pagination depth.
      while (next.nextJoinedCursor && next.joined.length < count) {
        const page = await api<Communities>(
          "/api/communities?after=" + encodeURIComponent(next.nextJoinedCursor),
        );
        next = { ...page, joined: appendJoined(next.joined, page.joined) };
      }
      return next;
    };
    const results = await Promise.allSettled([
      communities(),
      api<CommunityAccount>("/api/wf2/me"),
      id
        ? api<{ confirmed: boolean; expiresAt: string }>(
            "/api/wf2/join/continuations/" + id,
          )
            .then((v) => ({
              actor,
              id,
              used: v.confirmed,
              ready: !v.confirmed && Date.parse(v.expiresAt) > Date.now(),
            }))
            .catch(() => ({ actor, id, used: false, ready: false }))
        : Promise.resolve(null),
    ]);
    if (activeActor.current !== actor || dataVersion.current !== version)
      return;
    const [worlds, requests, invitation] = results;
    if (worlds.status === "fulfilled")
      setSnapshot({ actor, data: worlds.value });
    else {
      if (
        worlds.reason instanceof HttpError &&
        [401, 403].includes(worlds.reason.status)
      )
        setSnapshot(null);
      setError(failure(worlds.reason, "your communities"));
    }
    if (requests.status === "fulfilled")
      setAccountSnapshot({ actor, data: requests.value });
    else {
      if (
        requests.reason instanceof HttpError &&
        [401, 403].includes(requests.reason.status)
      )
        setAccountSnapshot(null);
      setRequestError(failure(requests.reason, "your requests"));
    }
    if (invitation.status === "fulfilled") setInvite(invitation.value);
    setRefreshMessage(
      worlds.status === "fulfilled" && requests.status === "fulfilled"
        ? "Status updated."
        : "Some status could not be refreshed. Try again.",
    );
    refreshLock.current = null;
    setRefreshing(false);
  }, [actor]);
  useEffect(() => {
    void refreshRequests();
    const visible = () => {
      if (actor && !document.hidden) void refreshRequests();
    };
    document.addEventListener("visibilitychange", visible);
    return () => {
      document.removeEventListener("visibilitychange", visible);
      dataVersion.current += 1;
      refreshLock.current = null;
      moreLock.current = false;
    };
  }, [actor, refreshRequests]);
  async function loadMore() {
    if (
      !data?.nextJoinedCursor ||
      moreLock.current ||
      refreshLock.current === actor
    )
      return;
    moreLock.current = true;
    const version = dataVersion.current;
    setMore(true);
    setMoreError("");
    try {
      const next = await api<Communities>(
        "/api/communities?after=" + encodeURIComponent(data.nextJoinedCursor),
      );
      if (activeActor.current === actor && dataVersion.current === version)
        setSnapshot((old) =>
          old?.actor === actor
            ? {
                actor,
                data: {
                  ...next,
                  joined: appendJoined(old.data.joined, next.joined),
                },
              }
            : old,
        );
    } catch (e) {
      if (activeActor.current === actor && dataVersion.current === version)
        setMoreError(failure(e, "more communities"));
    } finally {
      if (activeActor.current === actor && dataVersion.current === version) {
        moreLock.current = false;
        setMore(false);
      }
    }
  }
  const currentInvite = invite?.actor === actor ? invite : null;
  const owned = data?.own.filter((w) => w.purpose !== "development") ?? [];
  const development =
    data?.own.filter((w) => w.purpose === "development") ?? [];
  const primary = owned.find((w) => w.purpose === "active") ?? owned[0];
  const otherOwned = [...owned, ...development].filter(
    (w) => w.id !== primary?.id,
  );
  const joined = [...(data?.joined ?? [])].sort(
    (a, b) =>
      (a.creatorDisplayName ?? a.name).localeCompare(
        b.creatorDisplayName ?? b.name,
        "en",
        { sensitivity: "base", numeric: true },
      ) ||
      a.name.localeCompare(b.name, "en", {
        sensitivity: "base",
        numeric: true,
      }) ||
      a.id.localeCompare(b.id),
  );
  const pendingRequests =
    account?.requests.filter((r) => r.state === "pending") ?? [];
  const pastRequests =
    account?.requests.filter((r) => r.state !== "pending") ?? [];
  function requestList(requests: CommunityAccount["requests"]) {
    return (
      <ul className="cui-request-list">
        {requests.map((request) => {
          const view = requestView(request, account?.grants ?? []);
          const number =
            (account?.requests.findIndex(
              (r) => r.requestId === request.requestId,
            ) ?? 0) + 1;
          return (
            <li key={request.requestId}>
              <div>
                <h3>Community request {number}</h3>
                <p>{view.detail}</p>
              </div>
              <span className={"cui-badge " + view.tone}>{view.label}</span>
              <Link className="cui-text-link" href="/join">
                Review request →
              </Link>
            </li>
          );
        })}
      </ul>
    );
  }
  return (
    <div className="pi-site cui-surface">
      <SectionLink className="cui-skip" targetId="communities-main">
        Skip to communities
      </SectionLink>
      <Header />
      <main className="cui-main" id="communities-main" tabIndex={-1}>
        <div className="cui-page-heading">
          <div>
            <p className="cui-eyebrow">YOUR PLACES, TOGETHER</p>
            <h1>My Communities</h1>
            <p>Your village and the communities you belong to.</p>
          </div>
          {person && (
            <SectionLink
              className="cui-text-link"
              targetId="community-requests"
            >
              Invitations & requests <span aria-hidden="true">↓</span>
            </SectionLink>
          )}
        </div>
        {accountError && (
          <Notice kind="error" onRetry={() => void refresh()}>
            {accountError}
          </Notice>
        )}
        {!loaded ? (
          <div className="cui-loading" role="status">
            Finding your communities…
          </div>
        ) : !person ? (
          <section className="cui-welcome">
            <div>
              <p className="cui-eyebrow">A PLACE TO RETURN TO</p>
              <h2>Bring your community closer</h2>
              <p>
                Connect with Twitch to find your saved village and approved
                communities.
              </p>
              <a className="cui-button primary" href="/auth/twitch">
                <img
                  src="/landing-art/ui1-01/twitch-glitch-white.svg"
                  width="17"
                  height="20"
                  alt=""
                />
                Join with Twitch
              </a>
              <Link className="cui-text-link" href="/villages/showcase-fern">
                Explore a village example →
              </Link>
            </div>
            <img
              src="/landing-art/ui1-01/cv-hero-village-mobile-1100.webp"
              width="1100"
              height="696"
              alt="Promotional village illustration"
            />
            <span className="cui-welcome-note">
              Signing in doesn’t create a village or send a join request.
            </span>
          </section>
        ) : (
          <>
            {error && !data && (
              <div className="cui-error">
                <Notice kind="error" onRetry={() => void refreshRequests()}>
                  {error}
                </Notice>
                <a className="cui-text-link" href="/auth/twitch">
                  Reconnect with Twitch
                </a>
              </div>
            )}
            {!data && !error && (
              <div className="cui-loading" role="status">
                Opening your saved places…
              </div>
            )}
            {data && (
              <>
                <section
                  className="cui-section"
                  aria-labelledby="your-village-title"
                >
                  <div className="cui-section-heading">
                    <h2 id="your-village-title">Your village</h2>
                    <span data-private>{person.displayName}</span>
                  </div>
                  {primary ? (
                    <>
                      <WorldCard world={primary} feature />
                    </>
                  ) : (
                    <div className="cui-empty">
                      <Icon name="home" />
                      <div>
                        <h3>A beginning of your own</h3>
                        <p>
                          {data.creation.allowed
                            ? "Start with a gathering shelter, a first path and room to grow."
                            : data.creation.reason === "job-in-progress"
                              ? "A village is already being prepared. Check again shortly."
                              : "Village creation is currently paused. You can still explore an example."}
                        </p>
                        <Link
                          className="cui-button secondary"
                          href={
                            data.creation.allowed
                              ? "/create"
                              : "/villages/showcase-fern"
                          }
                        >
                          {data.creation.allowed
                            ? "Found a village"
                            : "Explore a village example"}{" "}
                          <span aria-hidden="true">↗</span>
                        </Link>
                      </div>
                    </div>
                  )}
                  {otherOwned.length > 0 && (
                    <div
                      className="cui-secondary-places"
                      aria-label="Additional authorized villages"
                    >
                      {otherOwned.map((w) => (
                        <div className="cui-secondary-place" key={w.id}>
                          <div>
                            <span className="cui-muted">
                              {w.purpose === "development"
                                ? "Private test village"
                                : "Earlier saved village"}
                            </span>
                            <h3 data-private>{w.name}</h3>
                          </div>
                          <div className="cui-secondary-actions">
                            <Link
                              className="cui-text-link"
                              href={"/villages/" + w.id}
                            >
                              Enter village ↗
                            </Link>
                            {w.isCreator &&
                              (w.capabilities.plan ||
                                w.capabilities.admit ||
                                w.capabilities.enable) && (
                                <Link
                                  className="cui-text-link"
                                  href={"/villages/" + w.id + "?panel=settings"}
                                >
                                  Village settings
                                </Link>
                              )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  {primary &&
                    data.creation.allowed &&
                    data.creation.development && (
                      <Link className="cui-text-link" href="/create">
                        Create your separate private test village →
                      </Link>
                    )}
                </section>
                <section className="cui-section" aria-labelledby="joined-title">
                  <div className="cui-section-heading">
                    <h2 id="joined-title">Your Communities</h2>
                  </div>
                  {data.joined.length ? (
                    <>
                      <div className="cui-grid">
                        {joined.map((w) => (
                          <WorldCard key={w.id} world={w} joined />
                        ))}
                      </div>
                      {moreError && <Notice kind="error">{moreError}</Notice>}
                      <p className="cui-pagination-status" role="status">
                        {more
                          ? "Loading more communities…"
                          : data.joined.length +
                            " " +
                            (data.joined.length === 1
                              ? "community shown"
                              : "communities shown")}
                      </p>
                      {data.nextJoinedCursor && (
                        <button
                          className="cui-button secondary cui-more"
                          onClick={() => void loadMore()}
                          disabled={more}
                          aria-disabled={more || refreshing}
                        >
                          {more
                            ? "Loading communities…"
                            : moreError
                              ? "Try loading more again"
                              : "More communities"}
                        </button>
                      )}
                    </>
                  ) : (
                    <div className="cui-empty">
                      <Icon name="people" />
                      <div>
                        <h3>Your next shared place</h3>
                        <p>
                          Open a creator’s private request link. Once approved,
                          their community will appear here.
                        </p>
                        <Link className="cui-text-link" href="/join">
                          Check your requests →
                        </Link>
                      </div>
                    </div>
                  )}
                </section>
              </>
            )}
            <section
              className="cui-section cui-requests"
              id="community-requests"
              tabIndex={-1}
              aria-labelledby="requests-title"
            >
              <div className="cui-section-heading">
                <h2 id="requests-title">Invitations & requests</h2>
                <button
                  className="cui-text-link"
                  onClick={() => void refreshRequests()}
                  aria-disabled={refreshing || more}
                  aria-busy={refreshing}
                >
                  Refresh status
                </button>
              </div>
              <p className="cui-refresh-status" role="status">
                {refreshMessage}
              </p>
              <p className="cui-section-note">
                Have a link from a creator? Open it to review the invitation.
                Nothing is sent until you confirm.
              </p>
              {currentInvite?.ready && (
                <div className="cui-invitation">
                  <span className="cui-badge violet">Invited</span>
                  <p>Review the invitation before requesting approval.</p>
                  <Link
                    className="cui-button secondary"
                    href={
                      "/join?continuation=" +
                      encodeURIComponent(currentInvite.id)
                    }
                  >
                    Review invitation →
                  </Link>
                </div>
              )}
              {requestError ? (
                <Notice kind="error" onRetry={() => void refreshRequests()}>
                  {requestError}
                </Notice>
              ) : !account ? (
                <p className="cui-muted" role="status">
                  Checking your requests…
                </p>
              ) : (
                <>
                  {pendingRequests.length > 0
                    ? requestList(pendingRequests)
                    : !currentInvite?.ready && (
                        <p className="cui-muted">
                          No invitations or requests need your attention.
                        </p>
                      )}
                  {pastRequests.length > 0 && (
                    <details className="cui-request-history">
                      <summary>Request history</summary>
                      {requestList(pastRequests)}
                    </details>
                  )}
                </>
              )}
              {data && (
                <FollowDiscovery
                  discovery={data.followDiscovery}
                  csrf={actor}
                  onChanged={() => void refreshRequests()}
                />
              )}
            </section>
          </>
        )}
      </main>
      <footer className="cui-footer">
        <Link className="cui-brand" href="/">
          <Wordmark />
        </Link>
      </footer>
    </div>
  );
}
