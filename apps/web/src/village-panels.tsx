import { contributionAccess } from "./village-panel-state.js";
import { useRef, useState, type ReactNode } from "react";
import type { Wf2Project, constructionView } from "@creators-village/contracts";
export function ConfirmAction({
  label,
  description,
  confirmLabel,
  onConfirm,
  disabled = false,
}: {
  label: string;
  description: string;
  confirmLabel: string;
  onConfirm: () => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false),
    trigger = useRef<HTMLButtonElement>(null);
  const cancel = () => {
    setOpen(false);
    trigger.current?.focus();
  };
  return (
    <div
      className="ui4-confirm"
      onKeyDown={(e) => {
        if (open && e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          cancel();
        }
      }}
    >
      <button ref={trigger} disabled={disabled} onClick={() => setOpen(true)}>
        {label}
      </button>
      {open && (
        <div
          role="group"
          aria-label={"Confirm " + label.toLowerCase()}
          className="ui4-confirm-body"
        >
          <p>{description}</p>
          <button
            className="ui4-danger"
            autoFocus
            disabled={disabled}
            onClick={() => {
              onConfirm();
              cancel();
            }}
          >
            {confirmLabel}
          </button>
          <button disabled={disabled} onClick={cancel}>
            Keep unchanged
          </button>
        </div>
      )}
    </div>
  );
}
export function ProjectInspector({
  project: p,
  description,
  construction,
  creator,
  canContribute,
  accessLoaded,
  alreadyContributed,
  busy,
  onContribute,
  onRetry,
  onCancel,
  workerName,
  findWorker,
  credits,
  funding,
}: {
  project: Wf2Project;
  description: string;
  construction: ReturnType<typeof constructionView>;
  creator: boolean;
  canContribute: boolean;
  accessLoaded: boolean;
  alreadyContributed: boolean;
  busy: boolean;
  onContribute: () => void;
  onRetry: () => void;
  onCancel: () => void;
  workerName?: string | undefined;
  findWorker: () => void;
  credits: string[] | undefined;
  funding?: ReactNode;
}) {
  const eligibility = contributionAccess(
    p,
    accessLoaded,
    canContribute,
    alreadyContributed,
  );
  const eligible = eligibility.allowed;
  return (
    <section
      className="wf2-project ui4-project"
      aria-label="Construction project"
      data-construction-phase={construction.phase}
    >
      <h3>Mending Shed</h3>
      <span className="ui4-stage">
        {p.state === "completed"
          ? "Completed"
          : p.state === "cancelled"
            ? "Cancelled"
            : construction.label}
      </span>
      <p className="f2-purpose">
        A place for mending and shared workshop activity.
      </p>
      {p.state === "completed" ? (
        <p className="f2-complete">
          Built together · {p.acceptedCount}{" "}
          {p.fundingModel ? "Orbs contributed" : "accepted contributions"}
        </p>
      ) : p.state === "cancelled" ? (
        <p>
          {p.fundingModel
            ? `${p.acceptedCount} Orbs returned; contribution history retained.`
            : `${p.acceptedCount} accepted contributions retained in receipts.`}
        </p>
      ) : (
        <>
          <progress
            aria-label={
              p.fundingModel
                ? "Accepted Orb funding"
                : "Accepted construction contributions"
            }
            value={p.acceptedCount}
            max={p.goal}
          />
          <p className="ui4-progress-copy">
            {p.acceptedCount} of {p.goal}{" "}
            {p.fundingModel ? "Orbs contributed" : "contributions accepted"}
          </p>
        </>
      )}
      <p className="ux1-meta">Workshop project · {description}</p>
      {p.state === "blocked" && (
        <p role="status">
          Construction needs attention. Accepted work is retained.
        </p>
      )}
      {p.state === "ready" && <p role="status">Finishing construction…</p>}
      {!["completed", "cancelled"].includes(p.state) &&
        !p.nonCreatorConditionMet && (
          <p className="ui4-eligibility">
            An approved member other than the creator must take part.
          </p>
        )}
      {p.state === "open" && !p.fundingModel && (
        <div className="ui4-contribution">
          {!eligible ? (
            <p role={!accessLoaded ? "status" : undefined}>
              {eligibility.message}
            </p>
          ) : (
            <>
              <p>
                Your name stays private unless you choose recognition in Account
                settings.
              </p>
              <button
                className="pi-button primary"
                disabled={busy || !eligible}
                onClick={onContribute}
              >
                Contribute to workshop
              </button>
            </>
          )}
        </div>
      )}
      {p.blockedCode && (
        <p role="status">
          The creator can retry completion. Your accepted work is safe.
        </p>
      )}
      {creator && p.state === "blocked" && (
        <button disabled={busy} onClick={onRetry}>
          Retry completion
        </button>
      )}
      {workerName && construction.phase === "completed" && (
        <p>
          {workerName} has a workplace here.{" "}
          <button onClick={findWorker}>Find {workerName}</button>
        </p>
      )}
      {funding}
      {credits?.length ? (
        <p data-private>With thanks to {credits.join(", ")}.</p>
      ) : null}
      {creator && !["cancelled", "completed"].includes(p.state) && (
        <details className="ui4-management">
          <summary>Project management</summary>
          <ConfirmAction
            label="Cancel project"
            description={
              p.fundingModel
                ? "Cancel this project and return all contributed Orbs. Contribution history and receipts remain available."
                : "Release this site and cancel the project. Recorded contributions and receipts remain available."
            }
            confirmLabel="Confirm cancellation"
            onConfirm={onCancel}
            disabled={busy}
          />
        </details>
      )}
    </section>
  );
}
