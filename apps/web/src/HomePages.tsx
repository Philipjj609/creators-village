import { useEffect, useState } from "react";
import type { Communities, WorldEntry } from "@creators-village/contracts";
import { api } from "./api.js";
import { Link } from "./routing.js";
import { useSession } from "./session.js";
import { Header, Icon, Notice } from "./ui.js";
export { Landing } from "./LandingPage.js";
function WorldCard({ world }: { world: WorldEntry }) {
  return (
    <Link className="pi-world-card" href={"/villages/" + world.id}>
      <div className="pi-card-preview">
        <small className="pi-preview-label">Representative artwork</small>
        <img
          src={
            world.version === 1
              ? "/assets/hearthside-hero-01/home.png"
              : "/assets/hearthside-hero-01/commons.png"
          }
          alt=""
          loading="lazy"
        />
        <span>
          {world.purpose === "development"
            ? "Private development world"
            : world.version === 1
              ? "Original village · v1"
              : "Saved village"}
        </span>
      </div>
      <div className="pi-card-copy">
        <h3 data-private>{world.name}</h3>
        <p>
          {world.purpose === "development"
            ? "Separate test world · your original village stays intact"
            : world.version === 1
              ? "Your original world and saved history"
              : "One landscape, ready to grow together"}
        </p>
        <span className="pi-card-enter">
          Enter village <span aria-hidden="true">↗</span>
        </span>
      </div>
    </Link>
  );
}
export function MyCommunities() {
  const { person, loaded, error: accountError, refresh } = useSession(),
    [data, setData] = useState<Communities | null>(null),
    [error, setError] = useState(""),
    [retry, setRetry] = useState(0),
    [more, setMore] = useState(false);
  useEffect(() => {
    let live = true;
    setData(null);
    if (!person) return;
    void api<Communities>("/api/communities")
      .then((d) => {
        if (live) {
          setData(d);
          setError("");
        }
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
    };
  }, [person, retry]);
  async function loadMore() {
    if (!data?.nextJoinedCursor || more) return;
    setMore(true);
    try {
      const d = await api<Communities>(
        "/api/communities?after=" + encodeURIComponent(data.nextJoinedCursor),
      );
      setData((old) =>
        old
          ? {
              ...d,
              joined: [
                ...old.joined,
                ...d.joined.filter(
                  (w) => !old.joined.some((o) => o.id === w.id),
                ),
              ],
            }
          : d,
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setMore(false);
    }
  }
  return (
    <div className="pi-site">
      <Header />
      <main className="pi-communities">
        <div className="pi-page-heading">
          <span className="pi-eyebrow">Your places, together</span>
          <h1>My Communities</h1>
          <p>One village of your own. More places to belong.</p>
        </div>
        {accountError && (
          <Notice kind="error" onRetry={() => void refresh()}>
            {accountError}
          </Notice>
        )}
        {!loaded ? (
          <Notice>Finding your communities…</Notice>
        ) : !person ? (
          <section className="pi-empty">
            <Icon name="people" />
            <h2>Bring your Twitch identity</h2>
            <p>
              Sign in to find your saved village and approved communities. We
              won’t create a village automatically.
            </p>
            <a className="pi-button primary" href="/auth/twitch">
              Connect with Twitch
            </a>
          </section>
        ) : (
          <>
            {error && (
              <Notice kind="error" onRetry={() => setRetry((n) => n + 1)}>
                {error}
              </Notice>
            )}
            {!data && !error && <Notice>Loading your saved places…</Notice>}
            {data && (
              <>
                <section className="pi-community-section">
                  <div className="pi-section-heading">
                    <h2>Your creator village</h2>
                    <span data-private>{person.displayName}</span>
                  </div>
                  {data.own.length ? (
                    <div className="pi-world-grid">
                      {data.own.map((w) => (
                        <WorldCard key={w.id} world={w} />
                      ))}
                    </div>
                  ) : (
                    <div className="pi-empty compact">
                      <h3>A beginning of your own</h3>
                      <p>
                        {data.creation.allowed
                          ? "Found a landscape with a gathering shelter and room to grow."
                          : "New village creation is paused during the private playtest. Your account has not created another village."}
                      </p>
                      {data.creation.allowed ? (
                        <Link className="pi-button primary" href="/create">
                          Found a village
                        </Link>
                      ) : (
                        <Link
                          className="pi-button"
                          href="/villages/showcase-fern"
                        >
                          Explore a founding example
                        </Link>
                      )}
                    </div>
                  )}
                </section>
                {data.creation.allowed && data.creation.development && (
                  <p className="pi-muted">
                    <Link href="/create">
                      Create your authorised separate development world
                    </Link>{" "}
                    · your original village stays unchanged.
                  </p>
                )}
                <section className="pi-community-section">
                  <div className="pi-section-heading">
                    <h2>From creators you follow</h2>
                    <span>Follow discovery not connected</span>
                  </div>
                  <div className="pi-follow-state">
                    <Icon name="people" />
                    <div>
                      <h3>Your follows stay yours</h3>
                      <p>
                        Current Twitch sign-in provides identity only. Loading
                        followed channels requires an additional permission we
                        haven’t requested. No creators are listed here as
                        follows.
                      </p>
                      <p className="pi-muted">
                        You can still explore an example or use a private
                        community request link. Following never grants building
                        permissions.
                      </p>
                    </div>
                  </div>
                </section>
                <section className="pi-community-section">
                  <div className="pi-section-heading">
                    <h2>Communities you’ve joined</h2>
                    <span>Explicitly approved membership</span>
                  </div>
                  {data.joined.length ? (
                    <>
                      <div className="pi-world-grid">
                        {data.joined.map((w) => (
                          <WorldCard key={w.id} world={w} />
                        ))}
                      </div>
                      {data.nextJoinedCursor && (
                        <button
                          className="pi-button"
                          onClick={() => void loadMore()}
                          disabled={more}
                        >
                          {more ? "Loading…" : "More communities"}
                        </button>
                      )}
                    </>
                  ) : (
                    <div className="pi-empty compact">
                      <h3>Your next shared place</h3>
                      <p>
                        Open a creator’s private request link and ask to join.
                        Approved communities will appear here, separately from
                        Twitch follows.
                      </p>
                    </div>
                  )}
                </section>
                <div className="pi-actions">
                  <Link className="pi-text-link" href="/settings">
                    Receipts, recognition & account settings
                  </Link>
                  <Link className="pi-text-link" href="/villages/showcase-fern">
                    Explore a public beginning →
                  </Link>
                </div>
              </>
            )}
          </>
        )}
      </main>
    </div>
  );
}
