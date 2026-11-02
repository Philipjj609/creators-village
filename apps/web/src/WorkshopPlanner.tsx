import { ORB_POLICY } from "@creators-village/contracts";
import { useEffect, useRef, useState } from "react";
import type { PlacementCheck, Wf2Project } from "@creators-village/contracts";
import { api } from "./api.js";
import { villageActionError } from "./village-panel-state.js";
export type PlacementPhase = "catalogue" | "placing" | "confirm";
type Site = { qx: number; qy: number };
export function WorkshopPlanner(props: {
  orbMode?: boolean;
  world: string;
  csrf: string;
  topology: string;
  site: Site;
  setSite: (s: Site) => void;
  drafts: Wf2Project[];
  busy: boolean;
  ready: boolean;
  phase: PlacementPhase;
  setPhase: (p: PlacementPhase) => void;
  command: (
    kind: string,
    payload: object,
  ) => Promise<{ result: Record<string, unknown> } | undefined>;
  preview: (
    v:
      | (Site & {
          status: "checking" | "valid" | "invalid";
          baseHeight?: number;
          path?: { points: { qx: number; qy: number }[]; widthQ: number };
          extension?: { points: { qx: number; qy: number }[]; widthQ: number };
        })
      | null,
  ) => void;
  showDraft: (p: Wf2Project | null) => void;
  cancel: () => void;
  activeProject?: string | undefined;
  openProject: (id: string) => void;
}) {
  const { world, csrf, topology, site, phase } = props;
  const [check, setCheck] = useState<PlacementCheck | null>(null),
    [failed, setFailed] = useState(false),
    [retry, setRetry] = useState(0),
    [message, setMessage] = useState("Choose clear, level ground.");
  useEffect(() => {
    if (phase === "catalogue") return;
    const frame = requestAnimationFrame(() =>
      document
        .querySelector<HTMLButtonElement>(
          phase === "confirm"
            ? "[data-placement-confirm]"
            : ".f2-placement-controls button",
        )
        ?.focus({ preventScroll: true }),
    );
    return () => cancelAnimationFrame(frame);
  }, [phase]);
  useEffect(() => {
    if (phase !== "confirm" || !check?.valid) return;
    const focused = document.activeElement;
    if (focused?.tagName === "CANVAS")
      document
        .querySelector<HTMLButtonElement>("[data-placement-confirm]")
        ?.focus({ preventScroll: true });
  }, [phase, check?.valid]);
  const latest = useRef(props),
    key =
      world +
      ":" +
      topology +
      ":" +
      props.orbMode +
      ":" +
      site.qx +
      ":" +
      site.qy,
    validKey = useRef(""),
    publishing = useRef(false);
  latest.current = props;
  useEffect(() => {
    const online = () => setRetry((v) => v + 1);
    window.addEventListener("online", online);
    return () => window.removeEventListener("online", online);
  }, []);
  useEffect(() => {
    validKey.current = "";
    setCheck(null);
    setFailed(false);
    if (phase === "catalogue" || !props.ready) {
      latest.current.preview(null);
      return;
    }
    const c = new AbortController();
    let active = true;
    setMessage("Checking this site…");
    latest.current.preview({ ...site, status: "checking" });
    const timer = setTimeout(() => {
      void api<PlacementCheck>(
        "/api/wf2/worlds/" +
          world +
          (props.orbMode ? "/orbs/placement-check" : "/placement-check"),
        {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
          body: JSON.stringify({ site }),
          signal: c.signal,
        },
      )
        .then((r) => {
          if (!active) return;
          if (
            r.version !== "cv-placement-1" ||
            (r.valid && (r.site.qx !== site.qx || r.site.qy !== site.qy))
          )
            throw Error("Choose the site again.");
          setCheck(r);
          validKey.current = r.valid ? key : "";
          setMessage(
            r.valid
              ? "Room for the workshop and its connecting path."
              : "Choose clear, level ground away from water, trees, rocks, buildings and roads. Leave room for the entrance and path.",
          );
          latest.current.preview({
            ...site,
            status: r.valid ? "valid" : "invalid",
            ...(r.valid
              ? {
                  baseHeight: r.site.baseHeight,
                  path: r.path,
                  ...(r.extension ? { extension: r.extension } : {}),
                }
              : {}),
          });
        })
        .catch((e) => {
          if (active) {
            setFailed(true);
            setMessage(villageActionError(e));
          }
        });
    }, 650);
    return () => {
      active = false;
      c.abort();
      clearTimeout(timer);
    };
  }, [
    world,
    csrf,
    topology,
    site.qx,
    site.qy,
    phase,
    props.ready,
    props.orbMode,
    retry,
  ]);
  useEffect(() => () => latest.current.preview(null), []);
  const move = (x: number, y: number) => {
    props.setPhase("placing");
    props.setSite({
      qx: Math.max(-65536, Math.min(65536, site.qx + x)),
      qy: Math.max(-65536, Math.min(65536, site.qy + y)),
    });
  };
  async function publish() {
    if (
      !check?.valid ||
      validKey.current !== key ||
      publishing.current ||
      props.activeProject
    )
      return;
    publishing.current = true;
    try {
      const draft = props.drafts[0];
      const same =
        draft && draft.site.qx === site.qx && draft.site.qy === site.qy;
      let result: Record<string, unknown> | undefined = same
        ? {
            projectId: draft.id,
            projectRevision: draft.revision,
            planHash: draft.planHash,
          }
        : undefined;
      if (!result)
        result = (
          await props.command(draft ? "ReviseDraft" : "CreateDraft", {
            site,
            ...(draft
              ? { projectId: draft.id, expectedProjectRevision: draft.revision }
              : {}),
          })
        )?.result;
      if (result)
        await props.command("PublishProject", {
          projectId: result.projectId,
          expectedProjectRevision: String(result.projectRevision ?? "1"),
          planHash: result.planHash,
        });
    } finally {
      publishing.current = false;
    }
  }
  if (phase === "catalogue")
    return (
      <section className="f2-build-catalogue" aria-label="Available buildings">
        <p>Choose what to build together.</p>
        {props.activeProject && (
          <p>
            Finish the current workshop before starting another.{" "}
            <button onClick={() => props.openProject(props.activeProject!)}>
              View current project
            </button>
          </p>
        )}
        <button
          className="f2-template"
          disabled={props.busy || !!props.activeProject || !props.ready}
          onClick={() => {
            props.showDraft(null);
            props.setPhase("placing");
          }}
        >
          <img
            src="/assets/cv-artlab-ve01-workshop-03/workshop.png"
            alt="Illustrated workshop template"
          />
          <strong>Mending Shed</strong>
          <span>A workshop for mending and shared work.</span>
          <small>
            Workshop ·{" "}
            {props.orbMode
              ? `${ORB_POLICY.workshopCost} Orbs`
              : "community construction"}
          </small>
          <span>Choose workshop</span>
        </button>
        {props.drafts[0] && (
          <button
            onClick={() => {
              props.setSite({
                qx: props.drafts[0]!.site.qx,
                qy: props.drafts[0]!.site.qy,
              });
              props.setPhase("confirm");
            }}
          >
            Continue saved site
          </button>
        )}
      </section>
    );
  return (
    <section className="f2-placement-controls" aria-label="Workshop placement">
      <p>
        {phase === "placing"
          ? "Move over the landscape, then click or tap to choose a site."
          : "Build the workshop here?"}
      </p>
      <p
        role="status"
        aria-live="polite"
        className={check?.valid ? "f1-site-valid" : ""}
      >
        {message}
      </p>
      <div
        role="group"
        aria-label="Move workshop site"
        className="f1-site-moves"
      >
        {[
          [-128, 0, "northwest", "↖"],
          [0, -128, "northeast", "↗"],
          [0, 128, "southwest", "↙"],
          [128, 0, "southeast", "↘"],
        ].map(([x, y, label, icon]) => (
          <button
            key={label}
            aria-label={"Move site " + label}
            disabled={props.busy}
            onClick={() => move(Number(x), Number(y))}
          >
            {icon}
          </button>
        ))}
      </div>
      {failed && (
        <button disabled={props.busy} onClick={() => setRetry((v) => v + 1)}>
          Retry site check
        </button>
      )}
      {phase === "placing" ? (
        <button
          disabled={props.busy || !check?.valid || validKey.current !== key}
          onClick={() => props.setPhase("confirm")}
        >
          Choose this site
        </button>
      ) : (
        <>
          <button
            className="pi-button primary"
            data-placement-confirm
            disabled={
              props.busy ||
              !check?.valid ||
              validKey.current !== key ||
              !!props.activeProject
            }
            onClick={() => void publish()}
          >
            Confirm construction
          </button>
          <button
            disabled={props.busy}
            onClick={() => props.setPhase("placing")}
          >
            Move site
          </button>
        </>
      )}
      <button disabled={props.busy} onClick={props.cancel}>
        Cancel placement
      </button>
    </section>
  );
}
