import { useEffect, type RefObject } from "react";
import type { WorldSelection } from "@creators-village/renderer";
import type { VillageInteraction } from "./village-selection.js";
export type SelectionView = {
  setSelection: (ref: WorldSelection | null) => void;
  focusSelection: (ref: WorldSelection, mode?: "frame" | "nudge") => void;
  followResident?: (id: string | null) => void;
};
export function useSelectionProjection(
  view: RefObject<SelectionView | null>,
  state: VillageInteraction,
  ready: boolean,
) {
  const key = state.selection
    ? state.selection.kind + ":" + state.selection.id
    : "";
  useEffect(() => {
    if (!ready) return;
    view.current?.setSelection(state.selection);
    let second = 0;
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => {
        if (state.selection)
          view.current?.focusSelection(
            state.selection,
            state.origin === "world" ? "nudge" : "frame",
          );
      });
    });
    let resizeFrame = 0;
    const resize = () => {
      cancelAnimationFrame(resizeFrame);
      resizeFrame = requestAnimationFrame(() => {
        resizeFrame = requestAnimationFrame(() => {
          if (state.selection)
            view.current?.focusSelection(state.selection, "frame");
        });
      });
    };
    window.addEventListener("resize", resize);
    return () => {
      window.removeEventListener("resize", resize);
      cancelAnimationFrame(resizeFrame);
      cancelAnimationFrame(first);
      cancelAnimationFrame(second);
    };
  }, [key, state.panel, ready]);
  useEffect(() => {
    if (ready) view.current?.followResident?.(state.following);
  }, [state.following, ready]);
}
