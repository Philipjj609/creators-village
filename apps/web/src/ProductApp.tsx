import { useEffect, useState } from "react";
import type { WorldEntry, Communities } from "@creators-village/contracts";
import { Landing, MyCommunities } from "./HomePages.js";
import { ParticipationPage } from "./ParticipationPage.js";
import { BasicVillage } from "./BasicVillage.js";
import { FoundingPage } from "./FoundingPage.js";
import { api, HttpError } from "./api.js";
import { useLocation, Link } from "./routing.js";
import { SessionProvider, useSession } from "./session.js";
import { Header, Notice } from "./ui.js";
function VillageRoute({ id }: { id: string }) {
  const { person, loaded } = useSession(),
    [entry, setEntry] = useState<WorldEntry | null>(null),
    [error, setError] = useState(""),
    [retry, setRetry] = useState(0);
  useEffect(() => {
    let live = true;
    setEntry(null);
    setError("");
    if (!loaded) return;
    void api<WorldEntry>("/api/worlds/" + encodeURIComponent(id) + "/entry")
      .then((w) => {
        if (live) setEntry(w);
      })
      .catch((e) => {
        if (live)
          setError(
            e instanceof HttpError && e.status === 429
              ? "Too many requests. Please try again shortly; your saved world is unchanged."
              : e instanceof HttpError && e.status >= 500
                ? "We couldn’t reach the saved village. Please retry."
                : "This village is unavailable or you do not have access.",
          );
      });
    return () => {
      live = false;
    };
  }, [id, person, loaded, retry]);
  if (!entry)
    return (
      <div className="pi-site">
        <Header />
        <main className="pi-account-page">
          {error ? (
            <>
              <h1>Village unavailable</h1>
              <Notice kind="error" onRetry={() => setRetry((n) => n + 1)}>
                {error}
              </Notice>
              <Link className="pi-button" href="/communities">
                My Communities
              </Link>
              {!person && (
                <a className="pi-button primary" href="/auth/twitch">
                  Sign in with Twitch
                </a>
              )}
            </>
          ) : (
            <>
              <h1>Opening the village…</h1>
              <p role="status">
                {loaded
                  ? "Checking this world’s saved version and access."
                  : "Checking your account."}
              </p>
            </>
          )}
        </main>
      </div>
    );
  return entry.reader === "participation" ? (
    <ParticipationPage worldId={id} entry={entry} />
  ) : (
    <BasicVillage entry={entry} />
  );
}
function CreateRoute() {
  const { person, loaded } = useSession(),
    [availability, setAvailability] = useState<Communities | null>(null),
    [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    if (person)
      void api<Communities>("/api/communities")
        .then((d) => {
          if (live) setAvailability(d);
        })
        .catch((e) => {
          if (live) setError(e.message);
        });
    return () => {
      live = false;
    };
  }, [person]);
  if (availability?.creation.allowed) return <FoundingPage startCreation />;
  return (
    <div className="pi-site">
      <Header />
      <main className="pi-account-page">
        <h1>A place to begin</h1>
        {error ? (
          <Notice kind="error">{error}</Notice>
        ) : !loaded || (person && !availability) ? (
          <Notice>Checking village availability…</Notice>
        ) : !person ? (
          <>
            <p>
              Connect your Twitch identity to check whether creation is
              available. No village is created automatically.
            </p>
            <a className="pi-button primary" href="/auth/twitch">
              Connect with Twitch
            </a>
          </>
        ) : (
          <>
            <p>
              {availability?.own.length
                ? "Your existing village is ready in My Communities. We won’t substitute or recreate it."
                : "New village creation is not available during the private playtest. Existing saves and requests stay intact."}
            </p>
            <Link className="pi-button primary" href="/communities">
              My Communities
            </Link>
            <Link className="pi-text-link" href="/villages/showcase-fern">
              Explore a beginning
            </Link>
          </>
        )}
      </main>
    </div>
  );
}
function Routes() {
  const path = useLocation(),
    url = new URL(path, location.origin),
    q = url.searchParams;
  let id: string | null = null;
  if (url.pathname.startsWith("/villages/")) {
    try {
      id = decodeURIComponent(url.pathname.slice(10));
    } catch {
      id = "invalid";
    }
  } else if (url.pathname === "/playtest") id = q.get("world");
  else if (url.pathname === "/") {
    id = q.get("village") ?? q.get("world");
    if (!id && q.has("founding") && q.get("founding") !== "new")
      id =
        "showcase-" +
        (["fern", "willow", "hearth", "brook"].includes(q.get("founding") ?? "")
          ? q.get("founding")
          : "fern");
  }
  useEffect(() => {
    document.body.classList.toggle("pi-world-open", Boolean(id));
    return () => document.body.classList.remove("pi-world-open");
  }, [id]);
  if (id) return <VillageRoute key={id} id={id} />;
  if (url.pathname === "/join" || url.pathname === "/settings")
    return <ParticipationPage />;
  if (url.pathname === "/communities" || url.pathname === "/playtest")
    return <MyCommunities />;
  if (
    url.pathname === "/create" ||
    (url.pathname === "/" && q.get("founding") === "new")
  )
    return <CreateRoute />;
  if (url.pathname === "/") return <Landing />;
  return (
    <div className="pi-site">
      <Header />
      <main className="pi-account-page">
        <h1>This path doesn’t lead to a village.</h1>
        <p>The page is unavailable. Your saved worlds have not changed.</p>
        <Link className="pi-button primary" href="/communities">
          My Communities
        </Link>
        <Link className="pi-text-link" href="/">
          Home
        </Link>
      </main>
    </div>
  );
}
export function ProductApp() {
  return (
    <SessionProvider>
      <Routes />
    </SessionProvider>
  );
}
