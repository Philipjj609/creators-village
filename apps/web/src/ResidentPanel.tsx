import type { LivingViewState } from "@creators-village/renderer";
import { VillageDirectory, type ListMemory } from "./VillageDirectory.js";
import { residentActivity } from "./resident-copy.js";
export function ResidentList({
  living,
  select,
  memory,
  following,
}: {
  living: LivingViewState | null;
  select: (id: string) => void;
  memory: ListMemory;
  following: string | null;
}) {
  return (
    <section aria-label="Fictional inhabitants">
      <p className="ux1-section-label">Fictional inhabitants</p>
      <VillageDirectory
        label="People"
        memory={memory}
        items={(living?.plan.residents ?? []).map((r) => ({
          key: r.id,
          name: r.name,
          search: r.name + " " + r.role,
          description:
            r.role +
            " · " +
            residentActivity(living?.states.find((s) => s.id === r.id)),
          status: following === r.id ? "Following" : undefined,
        }))}
        select={select}
        empty={
          living
            ? "No inhabitants are available in this village."
            : "Inhabitants are loading…"
        }
      />
    </section>
  );
}
export function ResidentPanel({
  living,
  id,
  focus,
  following,
}: {
  living: LivingViewState | null;
  id: string;
  focus: () => void;
  following: boolean;
}) {
  const resident = living?.plan.residents.find((r) => r.id === id);
  const state = living?.states.find((s) => s.id === id);
  if (!resident || !state) return <p>Loading this resident…</p>;
  return (
    <section aria-label="Resident information">
      <h3>{resident.name}</h3>
      <p className="ui4-role">Fictional inhabitant · {resident.role}</p>
      <dl className="lw-facts">
        <dt>Current activity</dt>
        <dd>{residentActivity(state)}</dd>
        <dt>{state.activity === "travel" ? "Destination" : "Location"}</dt>
        <dd>{state.location}</dd>
      </dl>
      <button
        className="pi-button primary"
        onClick={focus}
        aria-pressed={following}
      >
        {following ? "Following" : "Follow"}
      </button>
    </section>
  );
}
