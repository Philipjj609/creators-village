import { useEffect, useRef, useState } from "react";
import type { Communities } from "@creators-village/contracts";
import { api, HttpError } from "./api.js";
import { Icon, Notice } from "./ui.js";
import { Link } from "./routing.js";

type Discovery = Communities["followDiscovery"];
const STALE_MS = 15 * 60 * 1000;

export const followMessages: Record<string, string> = {
  REFRESH_TOO_SOON: "Please wait a minute before refreshing again.",
  RECONNECT_REQUIRED:
    "Twitch needs to be reconnected to see who you follow. Your villages are unaffected.",
  PROVIDER_UNAVAILABLE: "Twitch is not responding right now. Try again soon.",
  NOT_FOLLOWING:
    "You no longer follow this creator on Twitch, so it can’t be joined from here.",
  COMMUNITY_FULL: "This village has reached its member limit for now.",
  FORBIDDEN: "You can’t join this village from here.",
  NOT_FOUND: "That village is no longer open to followers.",
};
export function followError(e: unknown) {
  return e instanceof HttpError
    ? (followMessages[e.message] ?? "That didn’t work. Please try again.")
    : "That didn’t work. Please try again.";
}
export function bannerFor(search: string) {
  const value = new URLSearchParams(search).get("follows");
  return value === "connected"
    ? { kind: "info" as const, text: "Twitch follows connected." }
    : value === "declined"
      ? {
          kind: "info" as const,
          text: "Twitch follows weren’t connected. Nothing changed.",
        }
      : value === "failed"
        ? {
            kind: "error" as const,
            text: "Connecting Twitch follows didn’t complete. Please try again.",
          }
        : null;
}

/**
 * "Villages you follow" inside My Communities. Discovery is only a hint: joining happens
 * when you press Join, and unfollowing only hides a village here (never removes membership).
 */
export function FollowDiscovery({
  discovery,
  csrf,
  onChanged,
}: {
  discovery: Discovery;
  csrf: string;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const auto = useRef(false);
  const banner = bannerFor(
    typeof window === "undefined" ? "" : window.location.search,
  );
  const post = (path: string, body?: object) =>
    api<unknown>(path, {
      method: "POST",
      headers: { "X-CSRF-Token": csrf, "Content-Type": "application/json" },
      body: JSON.stringify(body ?? {}),
    });
  async function run(key: string, action: () => Promise<unknown>) {
    if (busy) return;
    setBusy(key);
    setMessage("");
    try {
      await action();
    } catch (e) {
      setMessage(followError(e));
    } finally {
      setBusy(null);
      onChanged();
    }
  }
  const connected = discovery.status === "connected";
  const synced = discovery.syncedAt ? Date.parse(discovery.syncedAt) : 0;
  // Periodic synchronization is page-driven: refresh once on open when the cache is stale.
  useEffect(() => {
    if (!connected || auto.current) return;
    auto.current = true;
    if (Date.now() - synced > STALE_MS)
      void run("refresh", () => post("/api/communities/follows/refresh"));
  }, [connected]);
  if (!discovery.available)
    return (
      <div className="cui-discovery">
        <Icon name="leaf" />
        <p>
          Twitch-follow discovery isn’t connected yet. A follow doesn’t grant
          village access.
        </p>
        <Link className="cui-text-link" href="/villages/showcase-fern">
          Explore the public example ↗
        </Link>
      </div>
    );
  return (
    <div className="cui-follow" aria-live="polite">
      <h3>Villages you follow</h3>
      {banner && <Notice kind={banner.kind}>{banner.text}</Notice>}
      {!connected ? (
        <>
          <p className="cui-muted">
            Optional: let Creator’s Village read which channels you follow on
            Twitch, only to show villages whose creators have opened them to
            followers. Your sign-in stays as it is, and following never grants
            access by itself.
          </p>
          <a className="cui-button secondary" href="/auth/twitch/follows">
            Connect Twitch follows
          </a>
        </>
      ) : (
        <>
          <p className="cui-muted">
            Only villages whose creators have opened them to followers appear
            here. Unfollowing hides a village from this list; it never removes a
            village you’ve already joined.
          </p>
          <div className="cui-follow-actions">
            <button
              className="cui-button secondary"
              disabled={Boolean(busy)}
              onClick={() =>
                void run("refresh", () =>
                  post("/api/communities/follows/refresh"),
                )
              }
            >
              {busy === "refresh" ? "Refreshing…" : "Refresh"}
            </button>
            <small>
              {discovery.syncedAt
                ? "Updated " + new Date(discovery.syncedAt).toLocaleTimeString()
                : "Not refreshed yet"}
            </small>
          </div>
          {discovery.villages?.length ? (
            <ul className="cui-request-list">
              {discovery.villages.map((v) => (
                <li key={v.worldId}>
                  <div>
                    <strong>{v.name}</strong>
                    <small> by {v.creatorDisplayName}</small>
                    <p className="cui-muted">
                      Joining lets you visit this village.{" "}
                      {v.followersCanContribute
                        ? "The creator also lets followers contribute Orbs."
                        : "Contributing is up to the creator."}
                    </p>
                  </div>
                  <button
                    className="cui-button primary"
                    disabled={Boolean(busy)}
                    onClick={() =>
                      void run("join:" + v.worldId, () =>
                        post("/api/communities/follows/join", {
                          worldId: v.worldId,
                        }),
                      )
                    }
                  >
                    {busy === "join:" + v.worldId ? "Joining…" : "Join village"}
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="cui-muted" role="status">
              No villages you follow are open to followers yet.
            </p>
          )}
          <button
            className="cui-text-link"
            disabled={Boolean(busy)}
            onClick={() =>
              void run("disconnect", () =>
                post("/api/communities/follows/disconnect"),
              )
            }
          >
            Stop using Twitch follows
          </button>
        </>
      )}
      {message && <Notice kind="error">{message}</Notice>}
    </div>
  );
}
