import { useCallback, useEffect, useRef, useState } from "react";
import {
  ORB_POLICY,
  type OrbWallet,
  type Wf2Project,
} from "@creators-village/contracts";
import { startOrbSync, contributionAmount } from "./orb-sync.js";
import { api, HttpError } from "./api.js";
export function useOrbWallet(
  world: string | null,
  csrf: string | undefined,
  cursor?: string,
) {
  const [value, setValue] = useState<OrbWallet | null>(null),
    [error, setError] = useState(""),
    [supported, setSupported] = useState<boolean | undefined>(undefined);
  const sync = useRef<ReturnType<typeof startOrbSync> | null>(null);
  const refresh = useCallback(
    () => sync.current?.refresh(false) ?? Promise.resolve(),
    [],
  );
  useEffect(() => {
    setValue(null);
    setSupported(undefined);
    setError("");
    if (!world || !csrf) return;
    const c = new AbortController();
    const controller = startOrbSync({
      visible: () => !document.hidden,
      read: (heartbeat) =>
        api<OrbWallet>(
          `/api/wf2/worlds/${world}/orbs/${heartbeat ? "heartbeat" : "wallet"}`,
          {
            method: heartbeat ? "POST" : "GET",
            headers: { "X-CSRF-Token": csrf },
            signal: c.signal,
          },
        ),
      value: (wallet) => {
        setSupported(true);
        setValue(wallet);
        setError("");
      },
      error: (e) => {
        if (c.signal.aborted) return true;
        if (e instanceof HttpError && [401, 403, 404].includes(e.status)) {
          setSupported(false);
          setValue(null);
          return true;
        }
        setError("Orbs are reconnecting. Your saved balance is safe.");
        return false;
      },
    });
    sync.current = controller;
    const resume = () => void controller.refresh(true);
    void controller.refresh(true);
    document.addEventListener("visibilitychange", resume);
    window.addEventListener("online", resume);
    window.addEventListener("focus", resume);
    window.addEventListener("pageshow", resume);
    return () => {
      controller.stop();
      c.abort();
      if (sync.current === controller) sync.current = null;
      document.removeEventListener("visibilitychange", resume);
      window.removeEventListener("online", resume);
      window.removeEventListener("focus", resume);
      window.removeEventListener("pageshow", resume);
    };
  }, [world, csrf]);
  useEffect(() => {
    void refresh();
  }, [cursor, refresh]);
  return { wallet: value, supported, error, refresh };
}
export function OrbHUD({
  wallet,
  error,
}: {
  wallet: OrbWallet;
  error: string;
}) {
  const [open, setOpen] = useState(false),
    [seconds, setSeconds] = useState(Math.ceil(wallet.nextAwardInMs / 1000));
  useEffect(() => {
    const start = Date.now(),
      timer = setInterval(
        () =>
          setSeconds(
            Math.max(
              0,
              Math.ceil((wallet.nextAwardInMs - (Date.now() - start)) / 1000),
            ),
          ),
        1000,
      );
    setSeconds(Math.ceil(wallet.nextAwardInMs / 1000));
    return () => clearInterval(timer);
  }, [wallet]);
  return (
    <aside
      className="orb-hud"
      aria-label="Community Orbs"
      onKeyDown={(e) => {
        if (e.key === "Escape" && open) {
          e.preventDefault();
          e.stopPropagation();
          setOpen(false);
          e.currentTarget.querySelector("button")?.focus();
        }
      }}
    >
      <button
        onClick={() => setOpen(!open)}
        aria-label={`${wallet.balance} community Orbs${error ? ", balance reconnecting" : ""}`}
        aria-controls="community-orb-details"
        aria-expanded={open}
        title={`Community Orbs · next interval in ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`}
      >
        <span aria-hidden="true" className="orb-icon">
          ◈
        </span>
        <output key={wallet.balance} aria-live="polite">
          {wallet.balance}
        </output>
        <span>Orbs</span>
      </button>
      {open && (
        <div
          id="community-orb-details"
          role="region"
          aria-label="Orb earning details"
        >
          <strong>Your community Orbs</strong>
          <p>
            {wallet.award} Orbs per {wallet.intervalMs / 60000} minutes of time
            in this village, up to {wallet.cap} through earning.
          </p>
          <p>
            {wallet.balance >= wallet.cap
              ? "Earning is paused at the cap."
              : `Next interval: ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`}
          </p>
          <small>
            Separate from Twitch Channel Points. Time away does not earn Orbs.
          </small>
          {error && <p>{error}</p>}
        </div>
      )}
    </aside>
  );
}
export function OrbFunding({
  world,
  project: p,
  csrf,
  wallet,
  canContribute,
  refresh,
  creditRevision,
}: {
  world: string;
  project: Wf2Project;
  csrf: string;
  wallet: OrbWallet | null;
  canContribute: boolean;
  refresh: () => Promise<void>;
  creditRevision: string;
}) {
  const [amount, setAmount] = useState(5),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [history, setHistory] = useState<
      { id: string; amount: number; name: string | null }[] | null
    >(null);
  useEffect(() => {
    let alive = true,
      flight = false;
    const c = new AbortController();
    const load = async () => {
      if (flight || document.hidden) return;
      flight = true;
      try {
        const r = await api<{ contributions: NonNullable<typeof history> }>(
          `/api/wf2/worlds/${world}/orbs/projects/${p.id}/history`,
          { signal: c.signal },
        );
        if (alive) setHistory(r.contributions);
      } catch {
        if (alive && !c.signal.aborted) setHistory(null);
      } finally {
        flight = false;
      }
    };
    void load();
    const t = setInterval(() => void load(), 15000);
    return () => {
      alive = false;
      c.abort();
      clearInterval(t);
    };
  }, [world, p.id, p.revision, creditRevision]);
  const max = Math.max(
    0,
    Math.min(wallet?.balance ?? 0, p.goal - p.acceptedCount),
  );
  const selectedAmount = contributionAmount(amount, max);
  const disabled = busy || !wallet || max < 1;
  useEffect(() => {
    setAmount((old) => contributionAmount(old, max));
  }, [max]);
  async function contribute() {
    if (busy || !canContribute || selectedAmount < 1 || selectedAmount > max)
      return;
    setBusy(true);
    setError("");
    const key = "f3-pending-fund:" + world + ":" + p.id,
      fingerprint = p.planHash + ":" + selectedAmount;
    let pending: { fingerprint: string; commandId: string } | null = null;
    try {
      pending = JSON.parse(sessionStorage.getItem(key) ?? "null");
    } catch {}
    const commandId =
      pending?.fingerprint === fingerprint
        ? pending.commandId
        : crypto.randomUUID();
    sessionStorage.setItem(key, JSON.stringify({ fingerprint, commandId }));
    try {
      const result = await api<{ balance: number }>(
        `/api/wf2/worlds/${world}/orbs/fund`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
          body: JSON.stringify({
            commandId,
            projectId: p.id,
            planHash: p.planHash,
            amount: selectedAmount,
          }),
        },
      );
      sessionStorage.removeItem(key);
      setAmount(Math.max(1, Math.min(ORB_POLICY.award, result.balance)));
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Contribution unavailable. Retry safely.",
      );
      if (e instanceof HttpError && e.status < 500)
        sessionStorage.removeItem(key);
    } finally {
      await refresh();
      setBusy(false);
    }
  }
  return (
    <div className="orb-funding">
      {p.state === "open" &&
        (canContribute ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void contribute();
            }}
          >
            <div
              className="orb-amount-controls"
              role="group"
              aria-label="Choose your contribution"
            >
              <span>Orbs to contribute</span>
              <input
                type="range"
                aria-label="Contribution amount slider"
                min={max > 0 ? 1 : 0}
                max={max}
                step={1}
                value={selectedAmount}
                disabled={disabled}
                onChange={(e) =>
                  setAmount(contributionAmount(Number(e.target.value), max))
                }
                aria-valuetext={`${selectedAmount} Orbs, up to ${max}`}
              />
              <input
                aria-label="Orbs to contribute"
                disabled={disabled}
                type="number"
                inputMode="numeric"
                min={max > 0 ? 1 : 0}
                max={max}
                step={1}
                value={selectedAmount}
                onChange={(e) =>
                  setAmount(contributionAmount(Number(e.target.value), max))
                }
              />
            </div>
            <p>
              {wallet
                ? `${wallet.balance} available · ${p.goal - p.acceptedCount} needed`
                : "Checking your wallet…"}
            </p>
            <button className="pi-button primary" disabled={disabled}>
              {busy ? "Contributing…" : "Contribute Orbs"}
            </button>
            <small>Recognition is optional in Account settings.</small>
          </form>
        ) : (
          <p>Only authorized community participants can contribute.</p>
        ))}
      {error && (
        <p role="alert">
          {error.replaceAll("_", " ").toLowerCase()}. Refresh your balance or
          try a smaller amount.
        </p>
      )}
      <h4>Community contributions</h4>
      {history === null ? (
        <p role="status">
          Contribution history is unavailable. It will retry automatically.
        </p>
      ) : history.length ? (
        <ul aria-label="Orb contribution history">
          {history.map((c) => (
            <li key={c.id}>
              <span>{c.name ?? "Community contribution"}</span>
              <strong>{c.amount} Orbs</strong>
            </li>
          ))}
        </ul>
      ) : (
        <p>Be the first to help build this place.</p>
      )}
    </div>
  );
}
