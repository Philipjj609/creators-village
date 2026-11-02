import type { Wf2Project, Wf2Structure } from "./participation.js";

/** CV-C1 view contract. A projection of WF2 facts, never a completion command. */
export const CONSTRUCTION_VIEW_VERSION = "cv-construction-1" as const;
export function constructionView(
  project: Wf2Project,
  structures: Wf2Structure[],
) {
  const structureId = "wf2-workshop-" + project.id;
  const center = { qx: project.site.qx, qy: project.site.qy };
  const footprint = {
    widthQ: project.site.widthQ,
    depthQ: project.site.depthQ,
  };
  const structure = structures.find((s) => s.id === structureId);
  const saved =
    project.state === "completed" &&
    structure &&
    structure.template === project.template &&
    structure.position.qx + structure.footprint.widthQ / 2 === center.qx &&
    structure.position.qy + structure.footprint.depthQ / 2 === center.qy &&
    structure.position.height === project.site.baseHeight &&
    structure.footprint.widthQ === footprint.widthQ &&
    structure.footprint.depthQ === footprint.depthQ;
  const phase =
    project.state === "draft" || project.state === "cancelled"
      ? "hidden"
      : project.state === "completed"
        ? saved
          ? "completed"
          : "awaiting-structure"
        : project.acceptedCount > 0 || project.state === "ready"
          ? "building"
          : "foundation";
  return {
    version: CONSTRUCTION_VIEW_VERSION,
    projectId: project.id,
    structureId,
    phase,
    center,
    footprint,
    height: project.site.baseHeight,
    accepted: project.acceptedCount,
    goal: project.goal,
    fraction: Math.max(
      0,
      Math.min(1, project.acceptedCount / Math.max(1, project.goal)),
    ),
    label:
      phase === "completed"
        ? "Workshop complete"
        : phase === "awaiting-structure"
          ? "Refreshing saved workshop"
          : project.state === "blocked"
            ? "Construction needs attention"
            : project.state === "ready"
              ? "Finishing construction"
              : phase === "building"
                ? "Workshop under construction"
                : "Workshop foundation",
  };
}
