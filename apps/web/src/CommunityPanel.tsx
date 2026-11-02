import { useEffect, useRef, useState } from "react";
import { api } from "./api.js";
import { ConfirmAction } from "./village-panels.js";
import { admissionPageCursor } from "./village-panel-state.js";
import { CommunitySettings, MemberAccess } from "./CommunitySettings.js";
type Admission = {
  requests: {
    requestId: string;
    revision: string;
    displayName: string;
    login: string | null;
  }[];
  members: {
    memberId: string;
    revision: string;
    displayName: string;
    login: string | null;
    state: string;
  }[];
};
export function CommunityPanel({
  world,
  creatorName,
  busy,
  act,
  link,
  inviteId,
  csrf,
}: {
  world: string;
  creatorName: string;
  busy: boolean;
  act: (k: string, p?: object) => Promise<unknown>;
  link: string;
  inviteId: string | null;
  /** Needed for creator-only settings and permission edits; omitted renders the R1 panel. */
  csrf?: string | undefined;
}) {
  const [data, setData] = useState<Admission | null>(null),
    [error, setError] = useState(""),
    [query, setQuery] = useState(""),
    [loading, setLoading] = useState(false),
    [cursor, setCursor] = useState<string | null>(null),
    [history, setHistory] = useState(false);
  const pages = useRef(1),
    flight = useRef(false),
    alive = useRef(true),
    abort = useRef<AbortController | null>(null);
  const refreshRef = useRef<() => void>(() => {});
  async function refresh(more = false) {
    if (flight.current) return;
    flight.current = true;
    setLoading(true);
    const c = new AbortController();
    abort.current = c;
    try {
      let after: string | null = null;
      const result: Admission = { requests: [], members: [] };
      let next: string | null = null;
      for (let i = 0; i < pages.current + (more ? 1 : 0); i++) {
        const r: Admission = await api(
          "/api/wf2/worlds/" +
            world +
            "/admission" +
            (after ? "?after=" + encodeURIComponent(after) : ""),
          { signal: c.signal },
        );
        result.requests.push(...r.requests);
        result.members.push(...r.members);
        next = admissionPageCursor(r);
        if (!next) break;
        after = next;
      }
      if (!alive.current || c.signal.aborted) return;
      result.requests = [
        ...new Map(result.requests.map((r) => [r.requestId, r])).values(),
      ];
      result.members = [
        ...new Map(result.members.map((r) => [r.memberId, r])).values(),
      ];
      if (more) pages.current++;
      setData(result);
      setCursor(next);
      setError("");
    } catch (e) {
      if (alive.current && !c.signal.aborted)
        setError("Community updates are unavailable. Retry to refresh.");
    } finally {
      flight.current = false;
      if (alive.current) setLoading(false);
    }
  }
  refreshRef.current = () => void refresh();
  useEffect(() => {
    alive.current = true;
    void refresh();
    const changed = () => {
      if (!document.hidden) refreshRef.current();
    };
    const timer = setInterval(changed, 10000);
    document.addEventListener("visibilitychange", changed);
    window.addEventListener("online", changed);
    return () => {
      alive.current = false;
      abort.current?.abort();
      clearInterval(timer);
      document.removeEventListener("visibilitychange", changed);
      window.removeEventListener("online", changed);
    };
  }, [world]);
  async function action(k: string, p?: object) {
    const r = await act(k, p);
    if (alive.current) await refresh();
    return r;
  }
  const q = query.trim().toLocaleLowerCase();
  return (
    <section className="f2-community" aria-label="Creator community management">
      <div className="f2-invitation">
        <h3>Invite your community</h3>
        <p>One-use links last 24 hours. You approve each request.</p>
        <button
          className="pi-button primary"
          disabled={busy}
          onClick={() => void action("IssueInvitation")}
        >
          Create invitation link
        </button>
        {link && (
          <label>
            Share privately
            <input
              readOnly
              data-private
              value={link}
              onFocus={(e) => e.target.select()}
            />
          </label>
        )}
        {inviteId && (
          <ConfirmAction
            label="Revoke invitation"
            description="The unused link will stop accepting requests."
            confirmLabel="Revoke link"
            disabled={busy}
            onConfirm={() => void action("RevokeInvitation", { inviteId })}
          />
        )}
      </div>
      {csrf && <CommunitySettings world={world} csrf={csrf} />}
      {error && (
        <p role="status">
          {error}
          <button disabled={loading} onClick={() => void refresh()}>
            Retry community updates
          </button>
        </p>
      )}
      {!data && <p role="status">Loading community…</p>}
      {!!data?.requests.length && (
        <div>
          <h3>Requests · {data.requests.length}</h3>
          {data.requests.map((r) => (
            <div className="f2-member" key={r.requestId}>
              <strong data-private>{r.displayName}</strong>
              <button
                disabled={busy}
                onClick={() =>
                  void action("ApproveRequest", {
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
                  void action("RejectRequest", {
                    requestId: r.requestId,
                    expectedRequestRevision: r.revision,
                  })
                }
              >
                Decline
              </button>
            </div>
          ))}
        </div>
      )}
      <h3>Members</h3>
      <label>
        Search members
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search loaded members"
        />
      </label>
      <div
        className="f2-members"
        role="region"
        aria-label="Community members"
        tabIndex={0}
      >
        {creatorName.toLocaleLowerCase().includes(q) && (
          <p data-private>
            <strong>{creatorName}</strong>
            <small>Creator</small>
          </p>
        )}
        {data?.members
          .filter(
            (m) =>
              m.state === "active" &&
              m.displayName.toLocaleLowerCase().includes(q),
          )
          .map((m) => (
            <div className="f2-member" key={m.memberId}>
              <strong data-private>{m.displayName}</strong>
              <details>
                <summary>Manage access</summary>
                {csrf && (
                  <MemberAccess
                    world={world}
                    memberId={m.memberId}
                    csrf={csrf}
                    onChanged={() => void refresh()}
                  />
                )}
                <ConfirmAction
                  label="Ban member"
                  description="Remove this member’s village access. Recorded contributions remain."
                  confirmLabel="Confirm ban"
                  disabled={busy}
                  onConfirm={() =>
                    void action("BanMember", {
                      memberId: m.memberId,
                      expectedMembershipRevision: m.revision,
                    })
                  }
                />
              </details>
            </div>
          ))}
      </div>
      {cursor && (
        <button disabled={loading || busy} onClick={() => void refresh(true)}>
          {loading ? "Loading…" : "More members and requests"}
        </button>
      )}
      {!!data?.members.some((m) => m.state !== "active") && (
        <details
          open={history}
          onToggle={(e) => setHistory(e.currentTarget.open)}
        >
          <summary>Past access decisions</summary>
          {data.members
            .filter((m) => m.state !== "active")
            .map((m) => (
              <div key={m.memberId}>
                <span data-private>{m.displayName}</span> ·{" "}
                {m.state === "banned"
                  ? "Banned"
                  : m.state === "left"
                    ? "Left"
                    : "Not approved"}
                {m.state === "banned" && (
                  <ConfirmAction
                    label="Remove ban"
                    description="They will still need approval to rejoin."
                    confirmLabel="Confirm remove ban"
                    disabled={busy}
                    onConfirm={() =>
                      void action("UnbanMember", {
                        memberId: m.memberId,
                        expectedMembershipRevision: m.revision,
                      })
                    }
                  />
                )}
              </div>
            ))}
        </details>
      )}
    </section>
  );
}
