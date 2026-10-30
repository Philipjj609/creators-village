import { Brand as SharedBrand } from "./brand.js";
import { useEffect, useRef, type ReactNode } from "react";
import { Link, usePanel } from "./routing.js";
import { useSession } from "./session.js";
export function Icon({ name }: { name: string }) {
  const paths: Record<string, ReactNode> = {
    hammer: (
      <>
        <path d="m14 3 7 7-3 3-3-3-9 11-3-3 11-9-3-3z" />
      </>
    ),
    people: (
      <>
        <circle cx="9" cy="7" r="3" />
        <path d="M3 21v-4a6 6 0 0 1 12 0v4M16 4a3 3 0 0 1 0 6m2 4a5 5 0 0 1 3 5v2" />
      </>
    ),
    settings: (
      <>
        <path d="m9 3-1 3-3 1-2 3 2 3v3l3 2 1 3h5l1-3 3-2v-3l2-3-2-3-3-1-1-3z" />
        <circle cx="11.5" cy="12" r="3" />
      </>
    ),
    home: (
      <>
        <path d="m3 11 9-8 9 8M6 9v12h12V9M10 21v-7h4v7" />
      </>
    ),
    plus: <path d="M12 4v16M4 12h16" />,
    minus: <path d="M4 12h16" />,
    back: <path d="m10 5-7 7 7 7M3 12h18" />,
    close: <path d="m5 5 14 14M19 5 5 19" />,
    leaf: (
      <>
        <path d="M5 20C2 6 13 3 21 3c0 13-5 19-16 17ZM5 20 16 9" />
      </>
    ),
    receipt: (
      <>
        <path d="M5 3h14v18l-3-2-4 2-4-2-3 2zM8 8h8M8 12h6" />
      </>
    ),
  };
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name] ?? paths.home}
    </svg>
  );
}
export function Brand() {
  return <SharedBrand className="pi-brand" />;
}
export function Header() {
  const { person, loaded } = useSession();
  return (
    <header className="pi-header">
      <Brand />
      <nav aria-label="Main navigation">
        <Link href="/villages/showcase-fern">Explore a beginning</Link>
        {person ? (
          <Link className="pi-button primary" href="/communities">
            My Communities
          </Link>
        ) : loaded ? (
          <a className="pi-button primary" href="/auth/twitch">
            Connect with Twitch <span aria-hidden="true">↗</span>
          </a>
        ) : (
          <span className="pi-muted">Checking account…</span>
        )}
      </nav>
    </header>
  );
}
export function Notice({
  children,
  kind = "info",
  onRetry,
}: {
  children: ReactNode;
  kind?: "info" | "error";
  onRetry?: () => void;
}) {
  return (
    <div
      className={`pi-notice ${kind}`}
      role={kind === "error" ? "alert" : "status"}
    >
      {children}
      {onRetry && (
        <button className="pi-button" onClick={onRetry}>
          Retry
        </button>
      )}
    </div>
  );
}
export function Panel({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  const ref = useRef<HTMLElement>(null),
    close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>("button")?.focus();
    const key = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") {
        ev.preventDefault();
        close.current();
      }
    };
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("keydown", key);
      if (previous?.isConnected) previous.focus();
    };
  }, [title]);
  return (
    <aside className="pi-panel" role="dialog" aria-label={title} ref={ref}>
      <header>
        <h2>{title}</h2>
        <button className="pi-icon" aria-label="Close panel" onClick={onClose}>
          <Icon name="close" />
        </button>
      </header>
      <div className="pi-panel-body">{children}</div>
    </aside>
  );
}
export function WorldNav({
  name,
  status,
  people,
  manage,
  projects = true,
}: {
  name: string;
  status?: string;
  people?: boolean;
  manage?: boolean;
  projects?: boolean;
}) {
  const [panel, setPanel] = usePanel();
  return (
    <header className="pi-world-nav">
      <Link className="pi-back" href="/communities" aria-label="My Communities">
        <Icon name="back" />
        <span>My Communities</span>
      </Link>
      <div className="pi-world-title">
        <h1>{name}</h1>
        {status && (
          <span className="pi-sync" role="status">
            {status}
          </span>
        )}
      </div>
      <nav aria-label="Village tools">
        {projects && (
          <button
            className="pi-icon"
            aria-label="Community projects"
            aria-pressed={panel === "projects"}
            onClick={() => setPanel(panel === "projects" ? "" : "projects")}
          >
            <Icon name="hammer" />
          </button>
        )}
        {people && (
          <button
            className="pi-icon"
            aria-label="Community and admission"
            aria-pressed={panel === "people"}
            onClick={() => setPanel(panel === "people" ? "" : "people")}
          >
            <Icon name="people" />
          </button>
        )}
        {manage && (
          <button
            className="pi-icon"
            aria-label="Village settings and management"
            aria-pressed={panel === "settings"}
            onClick={() => setPanel(panel === "settings" ? "" : "settings")}
          >
            <Icon name="settings" />
          </button>
        )}
      </nav>
    </header>
  );
}
export function CameraControls({
  reset,
  zoom,
  places,
  disabled = false,
}: {
  reset: () => void;
  zoom: (factor: number) => void;
  places: () => void;
  disabled?: boolean;
}) {
  return (
    <div className="pi-map-tools" aria-label="Camera controls">
      <button
        disabled={disabled}
        className="pi-icon"
        aria-label="Village overview"
        onClick={reset}
      >
        <Icon name="home" />
      </button>
      <button
        className="pi-icon"
        aria-label="Zoom in"
        disabled={disabled}
        onClick={() => zoom(1.3)}
      >
        <Icon name="plus" />
      </button>
      <button
        className="pi-icon"
        aria-label="Zoom out"
        disabled={disabled}
        onClick={() => zoom(1 / 1.3)}
      >
        <Icon name="minus" />
      </button>
      <button className="pi-button" onClick={places}>
        Places
      </button>
    </div>
  );
}
