import { Type, type TProperties } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
const object = <T extends TProperties>(fields: T) =>
  Type.Object(fields, { additionalProperties: false });
const id = Type.String({
  pattern: "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$",
});
const rev = Type.String({ pattern: "^[1-9][0-9]{0,18}$" }),
  cursor = Type.String({ pattern: "^(0|[1-9][0-9]{0,18})$" }),
  digest = Type.String({ pattern: "^[0-9a-f]{64}$" });
const q = Type.Integer({ minimum: -65536, maximum: 65536 }),
  height = Type.Integer({ minimum: -32768, maximum: 32767 });
const point = object({ qx: q, qy: q }),
  short = Type.String({ maxLength: 1000 }),
  nullable = Type.Union([short, Type.Null()]);
const labelId = Type.String({ minLength: 1, maxLength: 100 });
export const Wf2CommandResultWire = object({
  commandId: id,
  status: Type.Literal("committed"),
  result: Type.Union([
    object({
      worldId: id,
      communityId: id,
      stateSchema: Type.Literal("wf2-state-1"),
    }),
    object({ inviteId: id, expiresAt: Type.String() }),
    object({ inviteId: id, revoked: Type.Literal(true) }),
    object({ requestId: id, memberId: id, state: Type.Literal("active") }),
    object({
      requestId: id,
      state: Type.Union([Type.Literal("rejected"), Type.Literal("pending")]),
    }),
    object({ state: Type.Literal("left") }),
    object({
      memberId: id,
      state: Type.Union([Type.Literal("banned"), Type.Literal("left")]),
    }),
    object({
      projectId: id,
      projectRevision: rev,
      planRevision: rev,
      planHash: digest,
    }),
    object({
      projectId: id,
      state: Type.Literal("open"),
      projectRevision: rev,
      committedCursor: rev,
    }),
    object({
      contributionId: id,
      projectId: id,
      acceptedAmount: Type.Literal(1),
      completionQueued: Type.Boolean(),
      committedCursor: rev,
    }),
    object({ projectId: id, optedIn: Type.Boolean(), consentRevision: rev }),
    object({
      projectId: id,
      state: Type.Union([Type.Literal("cancelled"), Type.Literal("ready")]),
      projectRevision: rev,
    }),
  ]),
});
const footprint = object({
  widthQ: Type.Integer({ minimum: 1, maximum: 131072 }),
  depthQ: Type.Integer({ minimum: 1, maximum: 131072 }),
});
export const Wf2ProjectWire = object({
  id,
  revision: rev,
  planRevision: rev,
  planHash: digest,
  state: Type.Union(
    ["draft", "open", "ready", "blocked", "completed", "cancelled"].map((v) =>
      Type.Literal(v),
    ),
  ),
  goal: Type.Integer({ minimum: 1, maximum: 100 }),
  acceptedCount: Type.Integer({ minimum: 0, maximum: 100 }),
  nonCreatorConditionMet: Type.Boolean(),
  blockedCode: nullable,
  template: Type.Literal("wf2-workshop-1"),
  site: object({
    qx: q,
    qy: q,
    baseHeight: height,
    widthQ: Type.Literal(1536),
    depthQ: Type.Literal(1536),
    entrance: point,
    appearance: Type.Literal("hearthside-hero-01/workshop"),
    assetManifestHash: digest,
  }),
  path: object({
    points: Type.Array(point, { minItems: 2, maxItems: 256 }),
    widthQ: Type.Literal(384),
  }),
});
export const Wf2StructureWire = object({
  id: labelId,
  template: Type.Union([
    Type.Literal("gathering-shelter-1"),
    Type.Literal("wf2-workshop-1"),
  ]),
  position: object({ qx: q, qy: q, height }),
  footprint,
  entrance: point,
  appearance: Type.Union([
    Type.Literal("hearthside-hero-01/commons"),
    Type.Literal("hearthside-hero-01/workshop"),
  ]),
  assetManifestHash: digest,
  revision: rev,
});
export const Wf2PathWire = object({
  id: labelId,
  widthQ: Type.Integer({ minimum: 1, maximum: 65536 }),
  points: Type.Array(point, { minItems: 2, maxItems: 256 }),
  revision: rev,
});
const chunkRevision = object({
  x: Type.Integer({ minimum: -8, maximum: 7 }),
  y: Type.Integer({ minimum: -8, maximum: 7 }),
  revision: rev,
});
export const Wf2StateWire = object({
  stateSchema: Type.Literal("wf2-state-1"),
  worldId: id,
  baseline: object({
    format: Type.Literal(2),
    generator: Type.Literal("commons-geography-1"),
    profile: Type.Literal("gentle-512-32-2"),
    seed: Type.String({ minLength: 1, maxLength: 512 }),
    min: Type.Literal(-256),
    size: Type.Literal(512),
    chunkSize: Type.Literal(32),
    heightUnits: Type.Literal(16),
    hash: digest,
    landform: Type.Union(
      ["creek-bend", "lake-edge", "wooded-ridge"].map((v) => Type.Literal(v)),
    ),
    certificate: object({
      version: Type.Literal(1),
      valid: Type.Literal(true),
      opportunities: Type.Integer({ minimum: 0 }),
      expansionOpportunities: Type.Integer({ minimum: 0 }),
      exits: Type.Integer({ minimum: 0 }),
      repairs: Type.Array(short),
    }),
  }),
  active: object({
    centerX: Type.Integer({ minimum: -256, maximum: 256 }),
    centerY: Type.Integer({ minimum: -256, maximum: 256 }),
    radius: Type.Integer({ minimum: 1, maximum: 256 }),
    version: Type.Literal(1),
  }),
  cursor: rev,
  replayFloor: cursor,
  topologyEpoch: rev,
  creditRevision: rev,
  structures: Type.Array(Wf2StructureWire),
  paths: Type.Array(Wf2PathWire),
  projects: Type.Array(Wf2ProjectWire),
  currentChunkRevisions: Type.Array(chunkRevision, {
    minItems: 256,
    maxItems: 256,
  }),
});
export const Wf2BatchWire = object({
  batchSchema: Type.Literal("wf2-batch-1"),
  worldId: id,
  batchId: id,
  fromCursor: rev,
  toCursor: rev,
  kind: Type.Union(
    [
      "ProjectOpened",
      "WorkAccepted",
      "ProjectReady",
      "ConstructionCompleted",
      "ProjectCancelled",
      "CompletionBlocked",
      "RecognitionChanged",
    ].map((v) => Type.Literal(v)),
  ),
  changes: Type.Array(
    Type.Union([
      object({ type: Type.Literal("project"), value: Wf2ProjectWire }),
      object({ type: Type.Literal("structure"), value: Wf2StructureWire }),
      object({ type: Type.Literal("path"), value: Wf2PathWire }),
      object({ type: Type.Literal("creditInvalidation"), projectId: id }),
    ]),
    { minItems: 1, maxItems: 200 },
  ),
  topologyEpoch: rev,
  creditRevision: rev,
  changedChunks: Type.Array(chunkRevision, { maxItems: 256 }),
});
export const Wf2EventsWire = object({
  batchSchema: Type.Literal("wf2-batch-1"),
  fromCursor: cursor,
  toCursor: cursor,
  headCursor: rev,
  replayFloor: cursor,
  batches: Type.Array(Wf2BatchWire, { maxItems: 200 }),
});
export const Wf2CreditsWire = object({
  creditRevision: rev,
  credits: Type.Array(object({ creditId: id, label: short })),
});
export const Wf2MeWire = object({
  grants: Type.Array(object({ worldId: id, canContribute: Type.Boolean() })),
  requests: Type.Array(
    object({
      requestId: id,
      state: Type.Union(
        ["pending", "approved", "rejected", "withdrawn"].map((v) =>
          Type.Literal(v),
        ),
      ),
      worldId: id,
    }),
    { maxItems: 20 },
  ),
  receipts: Type.Array(object({ commandId: id, projectId: id }), {
    maxItems: 20,
  }),
});
export const Wf2AdmissionWire = object({
  requests: Type.Array(
    object({
      requestId: id,
      revision: rev,
      submittedAt: Type.String(),
      login: nullable,
      displayName: short,
    }),
    { maxItems: 20 },
  ),
  members: Type.Array(
    object({
      memberId: id,
      revision: rev,
      state: Type.Union(
        ["pending", "active", "left", "banned", "rejected"].map((v) =>
          Type.Literal(v),
        ),
      ),
      login: nullable,
      displayName: short,
    }),
    { maxItems: 20 },
  ),
});
export const Wf2ErrorWire = object({
  error: object({
    code: Type.Union(
      [
        "INVALID_INPUT",
        "UNSUPPORTED_SCHEMA",
        "AUTH_REQUIRED",
        "FORBIDDEN",
        "ONBOARDING_CLOSED",
        "NOT_FOUND",
        "STALE_TARGET",
        "PLAN_CHANGED",
        "ACTIVE_PROJECT_LIMIT",
        "COHORT_LIMIT",
        "ALREADY_CONTRIBUTED",
        "TARGET_REACHED",
        "PROJECT_NOT_OPEN",
        "INVITE_USED",
        "COMMAND_ID_REUSED",
        "INVITE_EXPIRED",
        "RATE_LIMITED",
        "TEMPORARY_UNAVAILABLE",
        "CLIENT_UPDATE_REQUIRED",
        "RESET_REQUIRED",
      ].map((v) => Type.Literal(v)),
    ),
    retryable: Type.Boolean(),
    requestId: id,
  }),
});
export const isWf2State = (value: unknown) => Value.Check(Wf2StateWire, value);
export const isWf2Batch = (value: unknown) => Value.Check(Wf2BatchWire, value);
