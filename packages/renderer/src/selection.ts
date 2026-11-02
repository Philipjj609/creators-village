/** Rendering projection only. No authority or member identity is encoded here. */
export type WorldSelection = {
  kind: "resident" | "structure" | "site" | "landmark";
  id: string;
};
export function projectSelection(
  ref: WorldSelection | null,
  clearObject: () => void,
  selectResident: (id: string) => void,
  drawObject: (ref: WorldSelection) => void,
) {
  clearObject();
  selectResident(ref?.kind === "resident" ? ref.id : "");
  if (ref && ref.kind !== "resident") drawObject(ref);
}
export function selectionFrame(
  point: { x: number; y: number },
  frame: { x: number; y: number; width: number; height: number },
  extent: { width: number; height: number },
  scale: number,
  mode: "frame" | "nudge",
) {
  const halfW = Math.min(frame.width / 2, (extent.width * scale) / 2 + 12),
    halfH = Math.min(frame.height / 2, (extent.height * scale) / 2 + 12);
  return mode === "frame"
    ? { x: frame.x + frame.width / 2, y: frame.y + frame.height / 2 }
    : {
        x: Math.max(
          frame.x + halfW,
          Math.min(point.x, frame.x + frame.width - halfW),
        ),
        y: Math.max(
          frame.y + halfH,
          Math.min(point.y, frame.y + frame.height - halfH),
        ),
      };
}
