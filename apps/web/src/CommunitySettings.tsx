import { useEffect, useState } from "react";
import { api, HttpError } from "./api.js";

type Settings = {
  followerJoinEnabled: boolean;
  followerCanContribute: boolean;
  memberLimit: number;
  legacyMemberLimit: number;
  limitIsLegacy: boolean;
  maxMemberLimit: number;
  activeMembers: number;
  revision: string;
  available: boolean;
};
export type MemberPermissions = {
  memberId: string;
  revision: string;
  state: string;
  joinSource: "invitation" | "follower";
  permissions: {
    canContribute: boolean;
    canCreateProjects: boolean;
    canManageConstruction: boolean;
    canModerate: boolean;
  };
};
const labels: Record<keyof MemberPermissions["permissions"], string> = {
  canContribute: "Contribute Orbs",
  canCreateProjects: "Create projects",
  canManageConstruction: "Manage construction",
  canModerate: "Moderate members",
};
const json = (csrf: string, body: object, method = "PUT") => ({
  method,
  headers: { "X-CSRF-Token": csrf, "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

/** Creator-only (the server answers 403 to everyone else, and this renders nothing). */
export function CommunitySettings({
  world,
  csrf,
}: {
  world: string;
  csrf: string;
}) {
  const [s, setS] = useState<Settings | null>(null),
    [hidden, setHidden] = useState(false),
    [error, setError] = useState(""),
    [saved, setSaved] = useState(false),
    [busy, setBusy] = useState(false);
  const path = "/api/worlds/" + world + "/community-settings";
  useEffect(() => {
    let alive = true;
    api<Settings>(path)
      .then((v) => alive && setS(v))
      .catch((e) => {
        if (alive && e instanceof HttpError && [403, 404].includes(e.status))
          setHidden(true);
        else if (alive) setError("Community settings are unavailable.");
      });
    return () => {
      alive = false;
    };
  }, [path]);
  if (hidden) return null;
  if (!s) return error ? <p role="status">{error}</p> : null;
  async function save(next: Settings) {
    setBusy(true);
    setError("");
    setSaved(false);
    try {
      setS(
        await api<Settings>(
          path,
          json(csrf, {
            followerJoinEnabled: next.followerJoinEnabled,
            followerCanContribute: next.followerCanContribute,
            memberLimit: next.memberLimit,
            expectedRevision: next.revision,
          }),
        ),
      );
      setSaved(true);
    } catch (e) {
      setError(
        e instanceof HttpError && e.message === "STALE_TARGET"
          ? "Settings changed elsewhere. Reload and try again."
          : "Settings could not be saved.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="f2-settings" aria-label="Community settings">
      <h3>Community settings</h3>
      <p>
        Invitations always work. Optionally let people who follow you on Twitch
        discover and join without individual approval.
      </p>
      <label>
        <input
          type="checkbox"
          checked={s.followerJoinEnabled}
          disabled={busy || !s.available}
          onChange={(e) =>
            setS({ ...s, followerJoinEnabled: e.target.checked })
          }
        />{" "}
        Let followers join
      </label>
      {!s.available && (
        <small>Follower joining isn’t enabled on this server.</small>
      )}
      <label>
        <input
          type="checkbox"
          checked={s.followerCanContribute}
          disabled={busy}
          onChange={(e) =>
            setS({ ...s, followerCanContribute: e.target.checked })
          }
        />{" "}
        New followers can contribute Orbs
      </label>
      <small>
        Followers can always view. Creating projects, managing construction and
        moderating are never granted automatically.
      </small>
      <label>
        Member limit
        <input
          type="number"
          min={1}
          max={s.maxMemberLimit}
          value={s.memberLimit}
          disabled={busy}
          onChange={(e) =>
            setS({ ...s, memberLimit: Math.floor(Number(e.target.value)) })
          }
        />
      </label>
      <small>
        {s.activeMembers} members now.{" "}
        {s.limitIsLegacy
          ? "Using the original small-group limit of " +
            s.legacyMemberLimit +
            " until you save."
          : "Limits membership only; it doesn’t change how many residents live in the village."}
      </small>
      <button
        className="pi-button primary"
        disabled={busy || s.memberLimit < 1 || s.memberLimit > s.maxMemberLimit}
        onClick={() => void save(s)}
      >
        {busy ? "Saving…" : "Save settings"}
      </button>
      {saved && <p role="status">Saved.</p>}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}

/** Per-member permission editor. Membership stays until the member leaves or is banned. */
export function MemberAccess({
  world,
  memberId,
  csrf,
  onChanged,
}: {
  world: string;
  memberId: string;
  csrf: string;
  onChanged: () => void;
}) {
  const [m, setM] = useState<MemberPermissions | null>(null),
    [hidden, setHidden] = useState(false),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const path = "/api/worlds/" + world + "/members/" + memberId + "/permissions";
  useEffect(() => {
    let alive = true;
    api<MemberPermissions>(path)
      .then((v) => alive && setM(v))
      .catch((e) => {
        if (alive && e instanceof HttpError && [403, 404].includes(e.status))
          setHidden(true);
        else if (alive) setError("Permissions are unavailable.");
      });
    return () => {
      alive = false;
    };
  }, [path]);
  if (hidden) return null;
  if (!m) return error ? <p role="status">{error}</p> : null;
  async function set(key: keyof MemberPermissions["permissions"], on: boolean) {
    if (!m) return;
    setBusy(true);
    setError("");
    try {
      setM(
        await api<MemberPermissions>(
          path,
          json(csrf, {
            expectedMembershipRevision: m.revision,
            permissions: { ...m.permissions, [key]: on },
          }),
        ),
      );
      onChanged();
    } catch {
      setError("Permissions changed elsewhere or could not be saved. Reload.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <fieldset className="f2-permissions" disabled={busy}>
      <legend>
        Permissions
        {m.joinSource === "follower" ? " · joined as a follower" : ""}
      </legend>
      {(Object.keys(labels) as (keyof typeof labels)[]).map((key) => (
        <label key={key}>
          <input
            type="checkbox"
            checked={m.permissions[key]}
            onChange={(e) => void set(key, e.target.checked)}
          />{" "}
          {labels[key]}
        </label>
      ))}
      {error && <p role="alert">{error}</p>}
    </fieldset>
  );
}
