# Rendering, art production and procedural identity

**H01 steering, 2026-10-29:** V04 is a successful spatial/integration/production milestone, but its identity is too artificial/model-like and the visual gate is NOT PASSED. Art direction takes priority over a deeper genome. The authorized hero slice (internal source record omitted) uses existing source/render/camera machinery for one original cottage/workshop/civic-edge/shared-space scene. Actual study/evidence (internal source record omitted) distinguishes execution from artistic acceptance. No V05 or broader procedural engine is authorized; any V04 reshaping follows explicit identity review.

**V04 execution, 2026-10-29:** project owner approved the bounded neighborhood. The candidate source kit/layered exports and local study share production WebGL/asset-loading/demand-camera code while preserving the legacy default world flow. V04 evidence (internal source record omitted) tracks actual status; earlier proposal-only wording is historical. This is fixed-placement baked lighting and bounded overlap, not dynamic terrain/placement or a universal genome. Artistic acceptance, V05 spatial migration and S14 remain separate reviews.

**Latest direction, 2026-10-29:** project owner considers V03's geometry-to-sprite method promising and silhouettes improved, but final identity still reads too clean/miniature-like. Constrained Building Genome (internal source record omitted) records long-term skeleton/module/style/determinism/persistence direction. Proposed V04 (internal source record omitted) limits near-term work to shared source modules and one five-building interactive neighborhood, pending explicit review. No universal engine or V04 implementation now. V03 and old worlds remain unchanged. Full CV-S1 visual gate pending/unsatisfied, prior failed result retained. Earlier workflow statements below are historical proposals, not evidence that all steps were implemented.

**Current review, 2026-10-28:** the implemented `woodland-vector-1` family failed project owner's mandatory visual gate. This original architecture remains intent, not proof that its pipeline was executed. See failure audit and three replacement directions (internal source record omitted). Preserve v1 for compatibility; no substantial new visual implementation until target/pipeline review. Current code has only fixed parcel generation, projected decorative terrain and a separate frontal focus drawing; it does not yet satisfy the grammar/continuity requirements below.

Status: proposed workflow and experiments, updated 2026-10-28. The user has adopted early visual quality as a mandatory first-village acceptance criterion: appealing environment, recognizable individual buildings, meaningful form variation and working camera. The specific style/production workflow still requires the retained early experiment and human acceptance. No art generated or runtime benchmark executed in discovery; production assignment remains unapproved.

## Compare the viable paths

| Path | Strength | Cost / limitation | Disposition |
|---|---|---|---|
| Pixi sprites with hand-authored modular 2D | Strong silhouettes, small runtime, direct art control, approachable 2D pipeline | Multiple camera compositions require authored matching views; large-footprint depth sorting needs constraints | Recommended runtime and viable first-family source |
| Blender modular source -> orthographic sprite atlases -> Pixi | Consistent geometry, light, anchors and matching overview/frontal views; future geometry retained | Upfront model/render tooling and artist effort; exported assets still require retouching | Preferred production experiment if expertise/tool availability support it |
| Phaser 2D | Integrated camera/input/animation/scenes and mature game workflow | More client game systems than required; server authority still custom; does not itself solve isometric occlusion | Credible alternative if integrated client tooling measurably saves work |
| Three.js / React Three Fiber, orthographic 3D | Natural depth and camera transitions; modular geometry/3D builder path | Lighting, materials, geometry delivery, mobile GPU cost and custom-art workload expand scope | Evaluate only if true camera rotation/geometry editing is essential now |
| Canvas/SVG/DOM world | Simple tooling and accessible UI elements | Large moving scenes and zoom/detail become costly; individual DOM nodes are a poor match for a rich village | DOM remains UI/fallback list; no full alternative renderer initially |

[Pixi v8 renderer lifecycle](https://pixijs.com/8.x/guides/components/application), [Phaser scope](https://docs.phaser.io/phaser/getting-started/what-is-phaser), [R3F](https://github.com/pmndrs/react-three-fiber). These support capability comparisons; performance and implementation effort above are engineering inferences, not measured results.

Recommendation: fixed isometric/pseudo-isometric overview plus a deliberately composed close-up view of the same building recipe. Use cozy illustrated/pre-rendered forms as the leading hypothesis; do not freeze pixel art until a zoom comparison. Crisp pixel art demands integer scaling/pixel alignment and can shimmer at continuous zoom; illustration tolerates smooth scaling but demands enough source resolution. Compare both using the same house, vegetation and scene density before art direction acceptance.

## Art grammar and genuine variation

Author one woodland family first: broad readable roofs, warm windows, controlled material edges, consistent sun direction, quiet ground textures and limited accent saturation. Function and silhouette must remain legible at overview zoom without labels. Use distinct rooflines/entrances/signage for greenhouse, workshop and community hall. Contrast and shape must work without relying on color alone.

Generate a village recipe from weighted, compatible combinations:

1. Macro geography: elevation profile, water course/shore, clearings and buildable corridors.
2. Settlement grammar: road topology, plaza placement, district setbacks, landmark sightlines and plot shape.
3. Architecture: footprint proportions, roof pitch/profile, storeys, porch, chimney and facade rhythm.
4. Material/vegetation system: timber/stone/stucco relationships, regional plants and canopy density.
5. Culture/history: approved banners, memorials, garden style, community-selected ornaments and later district research.

Do not independently randomize every parameter: constraints preserve coherent architecture and navigability. Validate reachable plaza/entrances, legal footprints, terrain transitions and visual density. Keep buildings recognizable across seeds; novelty comes from composition and compatible form changes. A second coastal family must alter geography, road/plot layouts, roof/material grammar and plants, not just hue. Save recipes so art updates never silently reshape existing property.

## Production path

Art brief -> approved reference/key frame -> source modules -> composed building recipes -> overview/mid/focus renders -> atlas/metadata validation -> in-engine preview -> human visual acceptance -> immutable published asset manifest.

Each asset revision includes source hash, tool/version/export settings, author/rights/provenance, family/style tags, function, footprint, doorway/nav anchors, baseline pivot, rendered bounds including shadows, elevated parts, occluder splits, LOD variants and animation frames. Do not treat transparent sprite bounds as collision. Keep source and derived outputs distinguishable; regenerate deterministically where possible, retain deliberate retouch layers. Pin atlas tool/settings; use padding/extrusion and verify seams/mipmaps/transparency.

AI-assisted art is best for direction, key references and controlled variants; it does not guarantee seam-free modules, consistent perspective, exact frames or rights clearance. Already available ImageGen/Product Design/Figma capabilities can support a later approved visual task. This run does not spend generation credits. Review generated modules for anatomy/geometry, anchors, continuity and small-scale readability. Store approved outputs and provenance, not every rejected generation. Do not render a fake screenshot and present it as the implemented world.

For characters, start with an approved consistent base, short idle/walk/work strips and a small facing set. Shared baseline pivot, speed/time mapping and a tested mirrored direction policy prevent sliding/jitter. At distance reduce animation updates or use idle representatives; cap visible actors independently of total membership. Cosmetics must not reveal a real user's viewing status. A local animation clock may reconstruct ambient routine, but only server transitions award work/resources.

## Scene and camera

- Camera operates in logical coordinates with explicit world-to-screen projection and inverse picking. Elevation-aware picking resolves topmost visible valid entity. A screen diamond is not the authoritative plot footprint.
- Ground may batch per chunk. Structures/characters that overlap cross chunk borders share a compatible global depth ordering; chunk containers cannot blindly render whole chunks front-to-back. Split roofs/foreground walls where necessary. Stable tie-break by entity id avoids flicker.
- Start with depth bands plus footprint ordering for approved modules. Test bridge/raised terrain/large greenhouse cases early. If those require arbitrary interpenetrating geometry, re-evaluate 3D rather than accumulating unbounded sprite hacks.
- Clamp pan/zoom, preserve pointer focal point, distinguish tap vs drag, support pinch, cancel gestures on overlays, and provide reset/zoom buttons. Do not hijack page scroll outside the world region.
- LOD changes use hysteresis to avoid thrashing; retain roof silhouette, position and entity ID. Smooth crossfade into the focused projection, keep selection/ownership/construction state and provide an obvious return action. Do not imply an unrestricted camera orbit.
- React hosts controls, accessible panels and route state. Pixi owns per-frame transforms and animation. A thin selected-entity/view state bridge prevents duplicate authority.
- DPR cap and adaptive quality, bounded effects/filters, texture residency budget and staged atlases. Pause/reduce work when hidden; restore GPU resources on context recovery. Provide DOM project/building access when WebGL is unavailable.

Pixi recommends spritesheets and profiling; culling and render groups can also add CPU overhead if applied indiscriminately. [Performance guidance](https://pixijs.com/8.x/guides/concepts/performance-tips), [render groups](https://pixijs.com/8.x/guides/concepts/render-groups), [culling plugin](https://pixijs.com/8.x/guides/components/application/culler-plugin).

## Proposed validation gate

One fixed scene: 64-unit region with 100 structures, 300 decorative props, 30 visible animated inhabitants, water/elevation, a project in all construction states, a large footprint across chunk borders and 3 zoom levels. Also run scaled 250/1,000-building stress fixtures; do not promise these as supported populations. Inspect portrait/landscape input and reduced motion.

Record hardware/browser/OS, viewport/DPR, backend, texture memory estimate, draw calls, load bytes, frame-time percentiles and input stutter. Initial candidate targets: desktop p95 frame <=16.7 ms, real mobile p95 <=33.3 ms under adaptive quality, active world textures <=128 MiB mobile and first useful world <=3 s on a documented network profile. These are proposed budgets to calibrate, not published guarantees. Do not extrapolate from empty-scene FPS.

Human acceptance: distinguish the key institutions by silhouette at overview; pan/zoom does not obscure controls; focused view reads as the same house; a second seed differs in geography/layout/forms; construction stages feel materially different. Golden screenshots supplement this review but cannot judge charm by themselves.

## Future 3D structures

Keep an asset representation boundary: approved geometry -> sandboxed offline validation/rendering -> immutable sprites/LODs + authoritative footprint/entrances. Quotas for triangles, textures, bounding dimensions and complexity; no executable scripts. A later isolated 3D editor/inspector can consume the same approved asset revision. This preserves a path, not a claim that arbitrary 3D designs can fit any sprite occlusion model without restrictions.
