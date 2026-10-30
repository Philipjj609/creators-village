/** WF1 wire format. Geography is immutable; activation and future edits are separate. */
export const FOUNDING_GENERATOR = "commons-geography-1" as const;
export const FOUNDING_PROFILE = "gentle-512-32-2" as const;
export type TerrainChunk = {
  x: number;
  y: number;
  hash: string;
  heights: number[];
  cells: number[];
};
export type FoundingStructure = {
  id: string;
  template: "gathering-shelter-1";
  name: string;
  x: number;
  y: number;
  width: number;
  depth: number;
  entrance: { x: number; y: number };
  height: number;
  appearance: "hearthside-hero-01/commons";
};
export type FoundingBaseline = {
  format: 2;
  generator: typeof FOUNDING_GENERATOR;
  profile: typeof FOUNDING_PROFILE;
  seed: string;
  min: number;
  size: number;
  chunkSize: number;
  heightUnits: 16;
  hash: string;
  landform: "creek-bend" | "lake-edge" | "wooded-ridge";
  chunks: TerrainChunk[];
  certificate: {
    version: 1;
    valid: true;
    opportunities: number;
    expansionOpportunities: number;
    exits: number;
    repairs: string[];
  };
};
export type FoundingWorld = {
  schemaVersion: 2;
  id: string;
  name: string;
  createdAt: string;
  source: "creator" | "showcase";
  purpose: "active" | "development";
  baseline: Omit<FoundingBaseline, "chunks">;
  active: { centerX: number; centerY: number; radius: number; version: 1 };
  structure: FoundingStructure;
  path: { id: string; width: number; points: { x: number; y: number }[] };
  publicCursor: string;
  topologyEpoch: string;
};
export type FoundingJob = {
  jobId: string;
  worldId: string;
  status: "pending" | "working" | "ready" | "failed";
  error: string | null;
};
