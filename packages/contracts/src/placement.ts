import { Type, type Static } from "@sinclair/typebox";
export const PlacementRequest = Type.Object(
  {
    site: Type.Object(
      {
        qx: Type.Integer({ minimum: -65536, maximum: 65536, multipleOf: 128 }),
        qy: Type.Integer({ minimum: -65536, maximum: 65536, multipleOf: 128 }),
      },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false },
);
const point = Type.Object(
  { qx: Type.Integer(), qy: Type.Integer() },
  { additionalProperties: false },
);
export const PlacementResult = Type.Union([
  Type.Object(
    {
      version: Type.Literal("cv-placement-1"),
      valid: Type.Literal(false),
      reason: Type.String(),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      version: Type.Literal("cv-placement-1"),
      valid: Type.Literal(true),
      topologyEpoch: Type.String(),
      site: Type.Object(
        {
          qx: Type.Integer(),
          qy: Type.Integer(),
          baseHeight: Type.Integer(),
          widthQ: Type.Literal(1536),
          depthQ: Type.Literal(1536),
        },
        { additionalProperties: false },
      ),
      extension: Type.Optional(
        Type.Object(
          { points: Type.Array(point), widthQ: Type.Integer() },
          { additionalProperties: false },
        ),
      ),
      path: Type.Object(
        { points: Type.Array(point), widthQ: Type.Integer() },
        { additionalProperties: false },
      ),
    },
    { additionalProperties: false },
  ),
]);
export type PlacementCheck = Static<typeof PlacementResult>;
