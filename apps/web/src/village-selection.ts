export type ObjectRef = {
  kind: "resident" | "structure" | "site" | "landmark";
  id: string;
};
export type VillageInteraction = {
  selection: ObjectRef | null;
  origin: "list" | "world" | null;
  following: string | null;
  panel: string;
  returnView: string;
  planMode: boolean;
};
export const initialInteraction: VillageInteraction = {
  selection: null,
  origin: null,
  following: null,
  panel: "",
  returnView: "",
  planMode: false,
};
export type InteractionEvent =
  | { type: "worldPick"; ref: ObjectRef | null }
  | { type: "replaceSelection"; ref: ObjectRef }
  | { type: "listPick"; ref: ObjectRef; view?: string }
  | { type: "open" | "tab"; view: string }
  | { type: "back" | "close" | "escape" | "cameraManual" | "followToggle" }
  | { type: "planMode"; on: boolean }
  | { type: "objectRemoved"; id: string };
export const objectDomain = (r: ObjectRef) =>
  r.kind === "resident" ? "people" : "places";
export const detailPanel = (r: ObjectRef) =>
  r.kind === "resident"
    ? "resident"
    : r.kind === "site"
      ? "inspect"
      : r.kind === "landmark"
        ? "landmark"
        : "inspect";
export function objectRef(id?: string): ObjectRef | null {
  if (!id) return null;
  return id.startsWith("project:")
    ? { kind: "site", id: id.slice(8) }
    : id.startsWith("landmark:")
      ? { kind: "landmark", id: id.slice(9) }
      : { kind: id.includes(":lw1:") ? "resident" : "structure", id };
}
export const objectKey = (r: ObjectRef | null) =>
  !r
    ? ""
    : r.kind === "site"
      ? "project:" + r.id
      : r.kind === "landmark"
        ? "landmark:" + r.id
        : r.id;
const clear = (s: VillageInteraction, panel = ""): VillageInteraction => ({
  ...s,
  selection: null,
  following: null,
  origin: null,
  panel,
  returnView: "",
  planMode: panel === "plan",
});
export function selectionReducer(
  s: VillageInteraction,
  e: InteractionEvent,
): VillageInteraction {
  switch (e.type) {
    case "replaceSelection":
      return {
        ...s,
        selection: e.ref,
        panel: detailPanel(e.ref),
        following: null,
      };
    case "close":
      return clear(s);
    case "back":
      return clear(
        s,
        s.returnView || (s.selection ? objectDomain(s.selection) : ""),
      );
    case "escape":
      return s.selection
        ? s.origin === "list"
          ? selectionReducer(s, { type: "back" })
          : clear(s)
        : clear(s);
    case "cameraManual":
      return { ...s, following: null };
    case "followToggle":
      return s.selection?.kind === "resident"
        ? { ...s, following: s.following ? null : s.selection.id }
        : s;
    case "objectRemoved":
      return s.selection?.id === e.id
        ? selectionReducer(s, { type: "back" })
        : s;
    case "planMode":
      return e.on ? { ...clear(s, "plan"), planMode: true } : clear(s);
    case "open":
      return clear(s, e.view);
    case "tab":
      return clear(s, s.panel === e.view && !s.selection ? "" : e.view);
    case "worldPick":
      if (s.planMode) return s;
      if (
        !e.ref ||
        (s.selection?.kind === e.ref.kind && s.selection.id === e.ref.id)
      )
        return s.origin === "list"
          ? selectionReducer(s, { type: "back" })
          : clear(s);
      return {
        ...clear(s),
        selection: e.ref,
        origin:
          s.origin === "list" &&
          s.selection &&
          objectDomain(s.selection) === objectDomain(e.ref)
            ? "list"
            : "world",
        returnView:
          s.origin === "list" &&
          s.selection &&
          objectDomain(s.selection) === objectDomain(e.ref)
            ? s.returnView
            : objectDomain(e.ref),
        panel: detailPanel(e.ref),
      };
    case "listPick":
      return {
        ...clear(s),
        selection: e.ref,
        origin: "list",
        returnView:
          e.ref.kind !== "resident" && e.view === "projects"
            ? "projects"
            : objectDomain(e.ref),
        panel: detailPanel(e.ref),
      };
  }
}
export function readInteraction(search: string): VillageInteraction {
  const q = new URLSearchParams(search),
    panel = q.get("panel") ?? "",
    item = q.get("item"),
    split = item?.indexOf(":") ?? -1;
  const kind = item?.slice(0, split),
    id = item?.slice(split + 1);
  if (id && ["resident", "structure", "site", "landmark"].includes(kind!)) {
    const ref = { kind, id } as ObjectRef;
    return {
      ...initialInteraction,
      selection: ref,
      panel: detailPanel(ref),
      origin: q.get("from") ? "list" : "world",
      returnView: ["people", "places", "projects"].includes(q.get("from") ?? "")
        ? q.get("from")!
        : objectDomain(ref),
    };
  }
  return {
    ...initialInteraction,
    panel: ["inspect", "landmark"].includes(panel)
      ? "places"
      : panel === "resident"
        ? "people"
        : panel,
    planMode: panel === "plan",
  };
}
export function interactionUrl(s: VillageInteraction, href: string) {
  const u = new URL(href);
  for (const k of ["panel", "item", "from"]) u.searchParams.delete(k);
  if (s.panel) u.searchParams.set("panel", s.panel);
  if (s.selection) {
    u.searchParams.set("item", s.selection.kind + ":" + s.selection.id);
    if (s.origin === "list") u.searchParams.set("from", s.returnView);
  }
  return u.pathname + u.search;
}
