import { Type, type Static, type TProperties } from "@sinclair/typebox";
const object = <T extends TProperties>(p: T) =>
  Type.Object(p, { additionalProperties: false });
export const Wf2Uuid = Type.String({ format: "uuid" });
export const Wf2Decimal = Type.String({ pattern: "^(0|[1-9][0-9]{0,18})$" });
const digest = Type.String({ pattern: "^[0-9a-f]{64}$" });
const site = object({
  qx: Type.Integer({ minimum: -65536, maximum: 65536, multipleOf: 128 }),
  qy: Type.Integer({ minimum: -65536, maximum: 65536, multipleOf: 128 }),
});
const project = { projectId: Wf2Uuid };
const expected = { ...project, expectedProjectRevision: Wf2Decimal };
const request = { requestId: Wf2Uuid, expectedRequestRevision: Wf2Decimal };
const member = { memberId: Wf2Uuid, expectedMembershipRevision: Wf2Decimal };
const payloads = {
  EnablePlaytest: object({ expectedBaselineHash: digest }),
  IssueInvitation: object({}),
  RevokeInvitation: object({ inviteId: Wf2Uuid }),
  ApproveRequest: object(request),
  RejectRequest: object(request),
  LeaveCommunity: object({}),
  BanMember: object(member),
  UnbanMember: object(member),
  CreateDraft: object({ site }),
  ReviseDraft: object({ ...expected, site }),
  PublishProject: object({ ...expected, planHash: digest }),
  Contribute: object({
    ...project,
    planHash: digest,
    recognitionOptIn: Type.Boolean(),
  }),
  SetRecognition: object({ ...project, optedIn: Type.Boolean() }),
  CancelProject: object(expected),
  RetryCompletion: object({ ...expected, planHash: digest }),
  RequestJoin: object({ continuationId: Wf2Uuid }),
};
function variant<K extends keyof typeof payloads>(kind: K) {
  return object({
    commandId: Wf2Uuid,
    commandSchema: Type.Literal("wf2-command-1"),
    kind: Type.Literal(kind),
    payload: payloads[kind],
  });
}
export const Wf2CommandSchema = Type.Union(
  (Object.keys(payloads) as (keyof typeof payloads)[]).map(variant),
);
export type Wf2Command = Static<typeof Wf2CommandSchema>;
export const Wf2WorldParams = object({ worldId: Wf2Uuid });
export const Wf2ContinuationSchema = object({
  token: Type.String({ pattern: "^[0-9a-f]{64}$" }),
});
export const WF2_TEST_RULESET = "cp1-wf2-test-1" as const;
export type Wf2Project = {
  fundingModel?: "community-orbs-1";
  pathExtension?: { points: { qx: number; qy: number }[]; widthQ: number };
  id: string;
  revision: string;
  planRevision: string;
  planHash: string;
  state: "draft" | "open" | "ready" | "blocked" | "completed" | "cancelled";
  goal: number;
  acceptedCount: number;
  nonCreatorConditionMet: boolean;
  blockedCode: string | null;
  template: string;
  site: {
    qx: number;
    qy: number;
    baseHeight: number;
    widthQ: number;
    depthQ: number;
    entrance: { qx: number; qy: number };
    appearance: string;
    assetManifestHash: string;
  };
  path: { points: { qx: number; qy: number }[]; widthQ: number };
};
export type Wf2Structure = {
  id: string;
  template: string;
  position: { qx: number; qy: number; height: number };
  footprint: { widthQ: number; depthQ: number };
  entrance: { qx: number; qy: number };
  appearance: string;
  assetManifestHash: string | null;
  revision: string;
};
export type Wf2Path = {
  id: string;
  widthQ: number;
  points: { qx: number; qy: number }[];
  revision: string;
};
export type Wf2State = {
  stateSchema: "wf2-state-1";
  worldId: string;
  baseline: import("./founding.js").FoundingWorld["baseline"];
  active: import("./founding.js").FoundingWorld["active"];
  cursor: string;
  replayFloor: string;
  topologyEpoch: string;
  creditRevision: string;
  structures: Wf2Structure[];
  paths: Wf2Path[];
  projects: Wf2Project[];
  currentChunkRevisions: { x: number; y: number; revision: string }[];
};
export type Wf2Change =
  | { type: "project"; value: Wf2Project }
  | { type: "structure"; value: Wf2Structure }
  | { type: "path"; value: Wf2Path }
  | { type: "creditInvalidation"; projectId: string };
export type Wf2Batch = {
  batchSchema: "wf2-batch-1";
  worldId: string;
  batchId: string;
  fromCursor: string;
  toCursor: string;
  kind: string;
  changes: Wf2Change[];
  topologyEpoch: string;
  creditRevision: string;
  changedChunks: { x: number; y: number; revision: string }[];
};
