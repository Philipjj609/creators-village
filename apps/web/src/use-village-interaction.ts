import { useEffect, useReducer, useRef, useState } from "react";
import { navigate, useLocation } from "./routing.js";
import { newListMemory } from "./VillageDirectory.js";
import {
  interactionUrl,
  objectKey,
  readInteraction,
  selectionReducer,
  type InteractionEvent,
  type VillageInteraction,
} from "./village-selection.js";
export function useVillageInteraction() {
  const path = useLocation();
  const worldPath = useRef(location.pathname);
  const [state, reduce] = useReducer(
    (
      s: VillageInteraction,
      e: InteractionEvent | { type: "restore"; state: VillageInteraction },
    ) => (e.type === "restore" ? e.state : selectionReducer(s, e)),
    undefined,
    () => readInteraction(location.search),
  );
  const current = useRef(state);
  current.current = state;
  const memories = useRef({
    people: newListMemory(),
    places: newListMemory(),
    projects: newListMemory(),
  });
  const [notice, setNotice] = useState("");
  const send = (event: InteractionEvent) => {
    if (event.type === "cameraManual" && current.current.following)
      setNotice(current.current.following);
    else if (event.type !== "cameraManual") setNotice("");
    const next = selectionReducer(current.current, event),
      old = current.current;
    current.current = next;
    reduce(event);
    const url = interactionUrl(next, location.href);
    if (url !== location.pathname + location.search)
      navigate(url, Boolean(old.panel));
  };
  useEffect(() => {
    const changed = worldPath.current !== location.pathname;
    if (changed) {
      worldPath.current = location.pathname;
      memories.current = {
        people: newListMemory(),
        places: newListMemory(),
        projects: newListMemory(),
      };
    }
    if (
      changed ||
      interactionUrl(current.current, location.href) !==
        location.pathname + location.search
    ) {
      const next = readInteraction(location.search);
      current.current = next;
      reduce({ type: "restore", state: next });
    }
  }, [path]);
  return {
    state,
    notice,
    memories: memories.current,
    selected: objectKey(state.selection),
    panel: state.panel,
    send,
    setPanel: (view: string) =>
      view ? send({ type: "open", view }) : send({ type: "close" }),
  };
}
