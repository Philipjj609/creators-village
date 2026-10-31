import type { LivingViewState } from "@creators-village/renderer";

export function ResidentList({
  living,
  select,
}: {
  living: LivingViewState | null;
  select: (id: string) => void;
}) {
  return (
    <section aria-label="Fictional residents">
      <h3>Village residents</h3>
      <p className="pi-muted">
        Fictional inhabitants · separate from Twitch community members.
      </p>
      {living?.plan.residents.map((r) => (
        <button
          key={r.id}
          className="pi-place-row"
          onClick={() => select(r.id)}
        >
          <span>
            {r.name}
            <small className="lw-role">{r.role}</small>
          </span>
          <span aria-hidden="true">↗</span>
        </button>
      ))}
      {!living && (
        <p>Resident state is unavailable. Reconnect to refresh the village.</p>
      )}
      {living && !living.plan.residents.length && (
        <p>No residents can reach this part of the village yet.</p>
      )}
    </section>
  );
}
export function ResidentPanel({
  living,
  id,
  focus,
  overview,
}: {
  living: LivingViewState | null;
  id: string;
  focus: () => void;
  overview: () => void;
}) {
  const resident = living?.plan.residents.find((r) => r.id === id);
  const state = living?.states.find((s) => s.id === id);
  if (!resident || !state)
    return <p>Finding this resident… Reconnect if they remain unavailable.</p>;
  return (
    <section aria-label="Resident information">
      <p className="pi-muted">Fictional village resident</p>
      <h3>{resident.name}</h3>
      <dl className="lw-facts">
        <dt>Role</dt>
        <dd>{resident.role}</dd>
        <dt>Current activity</dt>
        <dd>
          {state.actionLabel ??
            (state.activity === "travel"
              ? `Travelling to ${state.location.toLowerCase()}`
              : `${state.activity[0]!.toUpperCase()}${state.activity.slice(1)}`)}
        </dd>
        <dt>{state.activity === "travel" ? "Destination" : "Location"}</dt>
        <dd>{state.location}</dd>
        {state.activity === "travel" && (
          <>
            <dt>On arrival</dt>
            <dd>
              {state.goalId === "social"
                ? "Conversation"
                : state.destinationActivity}
            </dd>
          </>
        )}
      </dl>
      <button className="pi-button primary" onClick={focus}>
        Follow resident
      </button>
      <button onClick={overview}>Return to overview</button>
    </section>
  );
}
