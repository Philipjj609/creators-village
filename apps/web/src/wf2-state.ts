import type { Wf2State, Wf2Batch } from "@creators-village/contracts";
import { isWf2State, isWf2Batch } from "@creators-village/contracts";
const decimal = (v: unknown): v is string =>
  typeof v === "string" &&
  /^(0|[1-9][0-9]{0,18})$/.test(v) &&
  BigInt(v) <= 9223372036854775807n;
export function readWf2State(value: unknown): Wf2State {
  if (!isWf2State(value)) throw Error("Unsupported or incomplete world state");
  const s = value as Wf2State;
  if (
    !s ||
    s.stateSchema !== "wf2-state-1" ||
    !decimal(s.cursor) ||
    !decimal(s.creditRevision) ||
    !decimal(s.topologyEpoch) ||
    !decimal(s.replayFloor) ||
    !/^[0-9a-f]{64}$/.test(s.baseline?.hash) ||
    !Array.isArray(s.structures) ||
    !Array.isArray(s.paths) ||
    !Array.isArray(s.projects) ||
    !Array.isArray(s.currentChunkRevisions)
  )
    throw Error("Unsupported or incomplete world state");
  return s;
}
export function applyWf2Batch(state: Wf2State, input: unknown): Wf2State {
  if (!isWf2Batch(input)) throw Error("RESET_REQUIRED");
  const b = input as Wf2Batch;
  if (
    !b ||
    b.batchSchema !== "wf2-batch-1" ||
    b.worldId !== state.worldId ||
    !decimal(b.fromCursor) ||
    !decimal(b.toCursor) ||
    !decimal(b.creditRevision) ||
    !decimal(b.topologyEpoch) ||
    !Array.isArray(b.changes) ||
    !Array.isArray(b.changedChunks)
  )
    throw Error("RESET_REQUIRED");
  if (BigInt(b.toCursor) <= BigInt(state.cursor)) return state;
  const kinds = [
    "ProjectOpened",
    "WorkAccepted",
    "ProjectReady",
    "ConstructionCompleted",
    "ProjectCancelled",
    "CompletionBlocked",
    "RecognitionChanged",
  ];
  if (!kinds.includes(b.kind) || !b.changes.length || b.changes.length > 200)
    throw Error("RESET_REQUIRED");
  for (const c of b.changes) {
    if (c.type === "project") {
      const p = c.value;
      if (
        !p ||
        !Number.isInteger(p.goal) ||
        p.goal < 1 ||
        p.goal > 100 ||
        !Number.isInteger(p.acceptedCount) ||
        p.acceptedCount < 0 ||
        p.acceptedCount > p.goal ||
        !/^[0-9a-f]{64}$/.test(p.planHash) ||
        !p.site ||
        !Number.isInteger(p.site.qx) ||
        !Number.isInteger(p.site.qy) ||
        !Array.isArray(p.path?.points)
      )
        throw Error("RESET_REQUIRED");
    } else if (c.type === "structure") {
      const s = c.value;
      if (
        !s ||
        !s.position ||
        !s.footprint ||
        ![
          s.position.qx,
          s.position.qy,
          s.position.height,
          s.footprint.widthQ,
          s.footprint.depthQ,
        ].every(Number.isInteger) ||
        s.footprint.widthQ <= 0 ||
        s.footprint.depthQ <= 0
      )
        throw Error("RESET_REQUIRED");
    } else if (c.type === "path") {
      if (
        !c.value ||
        !Array.isArray(c.value.points) ||
        c.value.points.length < 2 ||
        !c.value.points.every(
          (p) => Number.isInteger(p.qx) && Number.isInteger(p.qy),
        )
      )
        throw Error("RESET_REQUIRED");
    }
  }
  if (b.kind === "ConstructionCompleted") {
    const p = b.changes.find((c) => c.type === "project"),
      s = b.changes.find((c) => c.type === "structure"),
      r = b.changes.find((c) => c.type === "path");
    if (
      b.changes.length !== 3 ||
      p?.type !== "project" ||
      p.value.state !== "completed" ||
      p.value.acceptedCount !== p.value.goal ||
      !p.value.nonCreatorConditionMet ||
      s?.type !== "structure" ||
      r?.type !== "path" ||
      s.value.id !== "wf2-workshop-" + p.value.id ||
      r.value.id !== "wf2-path-" + p.value.id
    )
      throw Error("RESET_REQUIRED");
  }
  if (
    b.fromCursor !== state.cursor ||
    BigInt(b.toCursor) !== BigInt(state.cursor) + 1n ||
    BigInt(b.creditRevision) < BigInt(state.creditRevision) ||
    BigInt(b.topologyEpoch) < BigInt(state.topologyEpoch)
  )
    throw Error("RESET_REQUIRED");
  const next = {
    ...state,
    structures: [...state.structures],
    paths: [...state.paths],
    projects: [...state.projects],
    currentChunkRevisions: [...state.currentChunkRevisions],
    cursor: b.toCursor,
    creditRevision: b.creditRevision,
    topologyEpoch: b.topologyEpoch,
  };
  const upsert = <T extends { id: string; revision: string }>(
    list: T[],
    v: T,
  ) => {
    if (!v || typeof v.id !== "string" || !decimal(v.revision))
      throw Error("RESET_REQUIRED");
    const i = list.findIndex((x) => x.id === v.id);
    if (i < 0) list.push(v);
    else {
      if (BigInt(v.revision) < BigInt(list[i]!.revision))
        throw Error("RESET_REQUIRED");
      list[i] = v;
    }
  };
  for (const c of b.changes) {
    if (c.type === "project") upsert(next.projects, c.value);
    else if (c.type === "structure") upsert(next.structures, c.value);
    else if (c.type === "path") upsert(next.paths, c.value);
    else if (c.type !== "creditInvalidation") throw Error("RESET_REQUIRED");
  }
  for (const c of b.changedChunks) {
    if (
      !Number.isInteger(c.x) ||
      !Number.isInteger(c.y) ||
      !decimal(c.revision)
    )
      throw Error("RESET_REQUIRED");
    const i = next.currentChunkRevisions.findIndex(
      (v) => v.x === c.x && v.y === c.y,
    );
    if (i < 0) throw Error("RESET_REQUIRED");
    if (BigInt(c.revision) < BigInt(next.currentChunkRevisions[i]!.revision))
      throw Error("RESET_REQUIRED");
    next.currentChunkRevisions[i] = c;
  }
  return next;
}
