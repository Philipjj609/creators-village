import type { FoundingWorld, Wf2State } from "@creators-village/contracts";
import type { ObjectRef } from "./village-selection.js";
export type NamedPlace = { id: string; name: string; x: number; y: number };
const bearings = [
  "East",
  "Southeast",
  "South",
  "Southwest",
  "West",
  "Northwest",
  "North",
  "Northeast",
];
/** Logical persisted axes, never screen coordinates. Stable ID breaks equal-distance ties. */
export function describePlace(target: NamedPlace, places: NamedPlace[]) {
  const nearest = places
    .filter((p) => p.id !== target.id)
    .map((p) => ({ p, d: Math.hypot(target.x - p.x, target.y - p.y) }))
    .sort((a, b) => a.d - b.d || a.p.id.localeCompare(b.p.id))[0];
  if (!nearest) return "In the village clearing";
  const { p, d } = nearest,
    direction =
      bearings[
        (Math.round(
          Math.atan2(target.y - p.y, target.x - p.x) / (Math.PI / 4),
        ) +
          8) %
          8
      ]!;
  if (d < 6) return "Beside " + p.name;
  if (d < 16) return direction + " of " + p.name;
  return "Out past " + p.name + ", to the " + direction.toLowerCase();
}
export type PlaceRow = NamedPlace & {
  key: string;
  ref: ObjectRef;
  description: string;
  status: string;
  kind: string;
};
export function villagePlaces(
  state: Wf2State | null,
  founder: FoundingWorld | null,
): PlaceRow[] {
  const rows: Omit<PlaceRow, "description">[] = [];
  if (state) {
    for (const s of state.structures)
      rows.push({
        id: s.id,
        key: s.id,
        ref: { kind: "structure", id: s.id },
        name:
          s.template === "wf2-workshop-1"
            ? "Mending Shed"
            : "Gathering Shelter",
        x: (s.position.qx + s.footprint.widthQ / 2) / 256,
        y: (s.position.qy + s.footprint.depthQ / 2) / 256,
        status: s.template === "wf2-workshop-1" ? "Completed" : "Founded",
        kind: "Building",
      });
    for (const p of state.projects) {
      const id = "wf2-workshop-" + p.id;
      if (
        ["open", "ready", "blocked"].includes(p.state) &&
        !state.structures.some((s) => s.id === id)
      )
        rows.push({
          id,
          key: id,
          ref: { kind: "site", id: p.id },
          name: "Mending Shed",
          x: p.site.qx / 256,
          y: p.site.qy / 256,
          status:
            p.state === "blocked"
              ? "Needs attention"
              : p.acceptedCount +
                "/" +
                p.goal +
                (p.fundingModel ? " Orbs" : " contributions"),
          kind: "Construction site",
        });
    }
  } else if (founder)
    rows.push({
      id: founder.structure.id,
      key: founder.structure.id,
      ref: { kind: "structure", id: founder.structure.id },
      name: founder.structure.name,
      x: founder.structure.x,
      y: founder.structure.y,
      status: "Founded",
      kind: "Building",
    });
  return rows.map((r) => ({ ...r, description: describePlace(r, rows) }));
}
