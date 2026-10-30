import { Type, type Static } from "@sinclair/typebox";
export * from "./participation.js";
export * from "./participation-wire.js";
export * from "./product.js";

export const GENERATOR_VERSION = "woodland-1";
export const ASSET_VERSION = "woodland-vector-1";
export const PositionSchema = Type.Object(
  { x: Type.Integer(), y: Type.Integer(), elevation: Type.Integer() },
  { additionalProperties: false },
);
export const BuildingSchema = Type.Object(
  {
    id: Type.String(),
    name: Type.String(),
    kind: Type.Union([
      Type.Literal("home"),
      Type.Literal("hall"),
      Type.Literal("windmill"),
    ]),
    position: PositionSchema,
    footprint: Type.Object({ width: Type.Integer(), depth: Type.Integer() }),
    recipe: Type.Object({
      shape: Type.Union([
        Type.Literal("cottage"),
        Type.Literal("gable"),
        Type.Literal("tower"),
        Type.Literal("hall"),
        Type.Literal("mill"),
      ]),
      palette: Type.Integer({ minimum: 0, maximum: 2 }),
      version: Type.Literal(ASSET_VERSION),
    }),
  },
  { additionalProperties: false },
);
export const SnapshotSchema = Type.Object(
  {
    schemaVersion: Type.Literal(1),
    id: Type.String(),
    name: Type.String(),
    seed: Type.String(),
    generatorVersion: Type.Literal(GENERATOR_VERSION),
    assetVersion: Type.Literal(ASSET_VERSION),
    revision: Type.Integer(),
    createdAt: Type.String(),
    source: Type.Union([Type.Literal("creator"), Type.Literal("showcase")]),
    terrain: Type.Object({
      biome: Type.Literal("woodland"),
      pond: Type.Object({
        x: Type.Number(),
        y: Type.Number(),
        rx: Type.Number(),
        ry: Type.Number(),
      }),
      trees: Type.Array(
        Type.Object({
          x: Type.Number(),
          y: Type.Number(),
          size: Type.Number(),
          variant: Type.Integer(),
        }),
      ),
      paths: Type.Array(
        Type.Array(Type.Object({ x: Type.Number(), y: Type.Number() })),
      ),
    }),
    buildings: Type.Array(BuildingSchema),
  },
  { additionalProperties: false },
);
export type Position = Static<typeof PositionSchema>;
export type Building = Static<typeof BuildingSchema>;
export type WorldSnapshot = Static<typeof SnapshotSchema>;
export type PublicIdentity = {
  displayName: string;
  csrfToken: string;
  worldId: string | null;
  worldVersion?: 1 | 2 | null;
  developmentWorldId?: string | null;
};

export const CreateVillageSchema = Type.Object(
  {
    commandId: Type.String({ format: "uuid" }),
    name: Type.String({ minLength: 3, maxLength: 48 }),
    seed: Type.String({ minLength: 1, maxLength: 64 }),
  },
  { additionalProperties: false },
);
export type CreateVillageInput = Static<typeof CreateVillageSchema>;

export * from "./founding.js";

export const FoundingCreateSchema = Type.Object(
  { ...CreateVillageSchema.properties, development: Type.Boolean() },
  { additionalProperties: false },
);
export const FoundingIdSchema = Type.Object({
  id: Type.String({
    pattern: "^(?:[0-9a-fA-F-]{36}|showcase-(?:fern|willow|hearth|brook))$",
  }),
});
export const FoundingJobIdSchema = Type.Object({
  id: Type.String({ format: "uuid" }),
});
export const FoundingKeysSchema = Type.Object(
  { keys: Type.String({ minLength: 1, maxLength: 1500 }) },
  { additionalProperties: false },
);
