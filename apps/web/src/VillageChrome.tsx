import type { ListMemory } from "./VillageDirectory.js";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { Communities, WorldEntry } from "@creators-village/contracts";
import { api } from "./api.js";
import { useSession } from "./session.js";
import { Link } from "./routing.js";
import { Icon } from "./ui.js";
import "./village-shell.css";

function MapIcon({ name }: { name: string }) {
  if (!["overview", "places", "settings"].includes(name))
    return <Icon name={name} />;
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {name === "overview" ? (
        <path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5M8 8h8v8H8z" />
      ) : name === "places" ? (
        <>
          <path d="m3 10 9-7 9 7M5 9v12h14V9M10 21v-7h4v7" />
        </>
      ) : name === "settings" ? (
        <>
          <path
            d="m10 2-.5 3-2 1.2L5 5 2 10l2.5 2v2L2 16l3 5 2.5-1.2 2 1.2.5 3h4l.5-3 2-1.2L19 21l3-5-2.5-2v-2L22 10l-3-5-2.5 1.2-2-1.2L14 2Z"
            transform="translate(1 0) scale(.9)"
          />
          <circle cx="12" cy="12" r="3" />
        </>
      ) : (
        <Icon name={name} />
      )}
    </svg>
  );
}
export function WorldNav({
  name,
  status,
  entry,
  people = true,
  community = false,
  manage,
  projects = true,
  activePanel,
  onTab,
}: {
  name: string;
  entry?: WorldEntry | undefined;
  status?: string;
  people?: boolean;
  community?: boolean;
  manage?: boolean;
  projects?: boolean;
  activePanel: string;
  onTab: (view: string) => void;
}) {
  const { person } = useSession();
  const actor = person?.csrfToken;
  const [creator, setCreator] = useState<{
    actor: string;
    world: string;
    name: string;
  } | null>(null);
  useEffect(() => {
    if (!actor || !entry || entry.isCreator || entry.source === "showcase")
      return;
    const controller = new AbortController();
    void (async () => {
      let cursor: string | null = null;
      do {
        const page: Communities = await api<Communities>(
          "/api/communities" +
            (cursor ? "?after=" + encodeURIComponent(cursor) : ""),
          { signal: controller.signal },
        );
        const match = [...page.own, ...page.joined].find(
          (w) => w.id === entry.id,
        );
        if (match) {
          if (!controller.signal.aborted && match.creatorDisplayName)
            setCreator({
              actor,
              world: entry.id,
              name: match.creatorDisplayName,
            });
          return;
        }
        cursor = page.nextJoinedCursor;
      } while (cursor && !controller.signal.aborted);
    })().catch(() => {
      /* Identity remains omitted when unavailable. */
    });
    return () => controller.abort();
  }, [actor, entry?.id, entry?.isCreator, entry?.source]);
  const creatorName = entry?.isCreator
    ? person?.displayName
    : creator && creator.actor === actor && creator.world === entry?.id
      ? creator.name
      : undefined;
  const healthy = Boolean(
    status?.startsWith("Connected") || status === "Ready to explore",
  );
  const panel = activePanel;
  const toggle = onTab;
  return (
    <>
      <header className="ui3-identity">
        <Link
          className="ui3-back"
          href="/communities"
          aria-label="My Communities"
          title="My Communities"
        >
          <Icon name="back" />
          <span>My Communities</span>
        </Link>
        <div className="pi-world-title">
          <h1 title={name}>
            <span className="ui31-world-name">{name}</span>
            {healthy && (
              <span
                className="ux1-connected"
                role="status"
                aria-label={status}
                title={status}
              />
            )}
          </h1>
          {creatorName && (
            <span className="ui4-creator" data-private>
              By {creatorName}
            </span>
          )}
        </div>
      </header>
      {status && !healthy && (
        <div
          className="ui4-connection"
          role="status"
          data-connected={
            status === "Connected" || status === "Ready to explore"
          }
        >
          <span aria-hidden="true" />
          {status}
        </div>
      )}
      <nav className="ui3-tools" aria-label="Village tools">
        {people && (
          <button
            aria-pressed={panel === "people" || panel === "resident"}
            onClick={() => toggle("people")}
            title="People"
          >
            <Icon name="people" />
            <span>People</span>
          </button>
        )}
        <button
          aria-pressed={
            panel === "places" ||
            panel === "inspect" ||
            panel === "construction" ||
            panel === "landmark"
          }
          onClick={() => toggle("places")}
          title="Places"
        >
          <MapIcon name="places" />
          <span>Places</span>
        </button>
        {projects && (
          <button
            aria-pressed={panel === "projects"}
            onClick={() => toggle("projects")}
            title="Community projects"
          >
            <Icon name="hammer" />
            <span>Projects</span>
          </button>
        )}
        {community && (
          <button
            aria-label="Community and admission"
            aria-pressed={panel === "admission"}
            onClick={() => toggle("admission")}
            title="Community and admission"
          >
            <Icon name="people" />
            <span>Community</span>
          </button>
        )}
        {manage && (
          <button
            className="ui3-settings"
            aria-label="Village settings and management"
            aria-pressed={panel === "settings"}
            onClick={() => toggle("settings")}
            title="Village settings"
          >
            <MapIcon name="settings" />
          </button>
        )}
      </nav>
    </>
  );
}
export function CameraControls({
  reset,
  zoom,
  disabled = false,
}: {
  reset: () => void;
  zoom: (factor: number) => void;
  disabled?: boolean;
}) {
  return (
    <div className="pi-map-tools" role="group" aria-label="Camera controls">
      {[
        { name: "overview", label: "Village overview", action: reset },
        { name: "plus", label: "Zoom in", action: () => zoom(1.3) },
        { name: "minus", label: "Zoom out", action: () => zoom(1 / 1.3) },
      ].map((v) => (
        <button
          key={v.name}
          className="pi-icon"
          disabled={disabled}
          aria-label={v.label}
          title={v.label}
          onClick={v.action}
        >
          <MapIcon name={v.name} />
        </button>
      ))}
    </div>
  );
}
export function Panel({
  title,
  children,
  onClose,
  contextKey,
  back,
  locate,
  onEscape,
  memory,
}: {
  contextKey?: string;
  back?: { label: string; onBack: () => void } | undefined;
  locate?: (() => void) | undefined;
  onEscape?: (() => void) | undefined;
  memory?: ListMemory | undefined;
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  const ref = useRef<HTMLElement>(null),
    callback = useRef(onClose),
    timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  callback.current = onClose;
  const [closing, setClosing] = useState(false);
  const returnTarget = useRef<HTMLElement | null>(null);
  const requestClose = () => {
    if (timer.current) return;
    if (matchMedia("(prefers-reduced-motion: reduce)").matches)
      callback.current();
    else {
      setClosing(true);
      timer.current = setTimeout(() => callback.current(), 140);
    }
  };
  const escape = useRef(onEscape);
  escape.current = onEscape;
  const close = useRef(requestClose);
  close.current = requestClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const originPanel = ref.current;

    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        if (escape.current) escape.current();
        else close.current();
      }
    };
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("keydown", key);
      if (timer.current) clearTimeout(timer.current);
      const target =
        returnTarget.current ??
        (previous?.isConnected &&
        previous !== document.body &&
        !originPanel?.contains(previous)
          ? previous
          : null);
      if (target?.isConnected) target.focus({ preventScroll: true });
    };
  }, []);
  useEffect(() => {
    const node = ref.current,
      shell = node?.closest<HTMLElement>(".ui3-shell");
    if (!node || !shell) return;
    const observer = new ResizeObserver(() =>
      shell.style.setProperty(
        "--ui3-sheet-height",
        node.getBoundingClientRect().height + "px",
      ),
    );
    observer.observe(node);
    return () => {
      observer.disconnect();
      shell.style.removeProperty("--ui3-sheet-height");
    };
  }, []);
  useEffect(() => {
    setClosing(false);
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    returnTarget.current =
      ref.current
        ?.closest(".ui3-shell")
        ?.querySelector<HTMLElement>(".ui3-tools [aria-pressed=true]") ?? null;
    const row =
      !back && memory
        ? [
            ...(ref.current?.querySelectorAll<HTMLElement>(
              "[data-object-key]",
            ) ?? []),
          ].find((n) => n.dataset.objectKey === memory.lastViewedId)
        : null;
    if (row) {
      row.focus({ preventScroll: true });
      return;
    }
    ref.current
      ?.querySelector<HTMLButtonElement>(back ? ".ux1-back" : ".ui3-close")
      ?.focus({ preventScroll: true });
  }, [title, contextKey]);
  useLayoutEffect(() => {
    const body = ref.current?.querySelector<HTMLElement>(".pi-panel-body");
    if (!body || back || !memory) return;
    body.scrollTop = memory.scrollTop;
    const row = [
      ...body.querySelectorAll<HTMLElement>("[data-object-key]"),
    ].find((n) => n.dataset.objectKey === memory.lastViewedId);
    row?.focus({ preventScroll: true });
  }, [contextKey, Boolean(back)]);
  return (
    <aside
      className={
        "pi-panel" +
        (back ? " ux1-detail" : "") +
        (closing ? " ui3-closing" : "")
      }
      role="dialog"
      aria-label={title}
      ref={ref}
    >
      <header>
        {back ? (
          <button className="ux1-back" onClick={back.onBack}>
            <Icon name="back" />
            {back.label}
          </button>
        ) : (
          <h2>{title}</h2>
        )}
        {locate && (
          <button
            className="pi-icon ux1-locate"
            onClick={locate}
            aria-label="Show in village"
            title="Show in village"
          >
            <MapIcon name="overview" />
          </button>
        )}
        <button
          className="pi-icon ui3-close"
          aria-label="Close panel"
          title="Close panel (Escape)"
          onClick={requestClose}
        >
          <Icon name="close" />
        </button>
      </header>
      <div
        className="pi-panel-body"
        onScroll={(e) => {
          if (!back && memory) memory.scrollTop = e.currentTarget.scrollTop;
        }}
      >
        {children}
      </div>
    </aside>
  );
}
