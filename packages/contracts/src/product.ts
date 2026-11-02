import { Type, type Static, type TProperties } from "@sinclair/typebox";
const object = <T extends TProperties>(properties: T) =>
  Type.Object(properties, { additionalProperties: false });
export const WorldEntrySchema = object({
  id: Type.String(),
  name: Type.String(),
  version: Type.Union([Type.Literal(1), Type.Literal(2)]),
  source: Type.Union([Type.Literal("creator"), Type.Literal("showcase")]),
  purpose: Type.Union([
    Type.Literal("active"),
    Type.Literal("development"),
    Type.Literal("legacy"),
    Type.Literal("showcase"),
  ]),
  reader: Type.Union([
    Type.Literal("legacy"),
    Type.Literal("founding"),
    Type.Literal("participation"),
  ]),
  isCreator: Type.Boolean(),
  creatorDisplayName: Type.Optional(Type.String()),
  capabilities: object({
    contribute: Type.Boolean(),
    plan: Type.Boolean(),
    admit: Type.Boolean(),
    enable: Type.Boolean(),
  }),
});
export type WorldEntry = Static<typeof WorldEntrySchema>;
export const CommunitiesSchema = object({
  own: Type.Array(WorldEntrySchema),
  joined: Type.Array(WorldEntrySchema),
  nextJoinedCursor: Type.Union([Type.String(), Type.Null()]),
  followDiscovery: object({
    // "not-connected" keeps its R1 meaning: no follow authorization (or the feature is off).
    status: Type.Union([
      Type.Literal("not-connected"),
      Type.Literal("connected"),
    ]),
    requiredScope: Type.Literal("user:read:follows"),
    available: Type.Optional(Type.Boolean()),
    villages: Type.Optional(
      Type.Array(
        object({
          worldId: Type.String(),
          name: Type.String(),
          creatorDisplayName: Type.String(),
          followersCanContribute: Type.Boolean(),
        }),
      ),
    ),
    syncedAt: Type.Optional(Type.Union([Type.String(), Type.Null()])),
    refreshAvailableAt: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  }),
  creation: object({
    allowed: Type.Boolean(),
    development: Type.Boolean(),
    reason: Type.Union([
      Type.Literal("available"),
      Type.Literal("existing-world"),
      Type.Literal("private-playtest"),
      Type.Literal("job-in-progress"),
    ]),
  }),
});
export type Communities = Static<typeof CommunitiesSchema>;
