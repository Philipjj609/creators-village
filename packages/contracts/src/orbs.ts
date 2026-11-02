import { Type, type Static } from "@sinclair/typebox";
export const ORB_POLICY = Object.freeze({
  version: "community-orbs-1" as const,
  starting: 30,
  award: 5,
  intervalMs: 300000,
  accrualCap: 120,
  heartbeatGraceMs: 45000,
  workshopCost: 60,
});
export type OrbWallet = {
  version: typeof ORB_POLICY.version;
  balance: number;
  revision: string;
  serverTime: number;
  nextAwardInMs: number;
  cap: number;
  award: number;
  intervalMs: number;
};
const uuid = Type.String({ format: "uuid" });
const site = Type.Object(
  {
    qx: Type.Integer({ minimum: -65536, maximum: 65536, multipleOf: 128 }),
    qy: Type.Integer({ minimum: -65536, maximum: 65536, multipleOf: 128 }),
  },
  { additionalProperties: false },
);
export const OrbDraftSchema = Type.Union([
  Type.Object(
    {
      commandSchema: Type.Literal("f3-command-1"),
      commandId: uuid,
      kind: Type.Literal("CreateDraft"),
      payload: Type.Object({ site }, { additionalProperties: false }),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      commandSchema: Type.Literal("f3-command-1"),
      commandId: uuid,
      kind: Type.Literal("ReviseDraft"),
      payload: Type.Object(
        {
          site,
          projectId: uuid,
          expectedProjectRevision: Type.String({
            pattern: "^[1-9][0-9]{0,18}$",
          }),
        },
        { additionalProperties: false },
      ),
    },
    { additionalProperties: false },
  ),
]);
export type OrbDraftCommand = Static<typeof OrbDraftSchema>;
export const OrbFundSchema = Type.Object(
  {
    commandId: uuid,
    projectId: uuid,
    planHash: Type.String({ pattern: "^[0-9a-f]{64}$" }),
    amount: Type.Integer({ minimum: 1, maximum: ORB_POLICY.workshopCost }),
  },
  { additionalProperties: false },
);
export type OrbFund = Static<typeof OrbFundSchema>;
/** Pure server-clock accounting; a long gap never earns offline attendance. */
export function accrueOrbs(
  balance: number,
  remainder: number,
  elapsed: number,
  cap = ORB_POLICY.accrualCap,
) {
  const active =
    elapsed >= 0 && elapsed <= ORB_POLICY.heartbeatGraceMs ? elapsed : 0;
  const total = remainder + active,
    intervals = Math.floor(total / ORB_POLICY.intervalMs);
  return {
    award: Math.min(intervals * ORB_POLICY.award, Math.max(0, cap - balance)),
    remainder: total % ORB_POLICY.intervalMs,
  };
}
