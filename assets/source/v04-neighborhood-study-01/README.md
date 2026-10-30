# V04 source kit — Brookside Commons

Original bounded, authored five-structure neighborhood. No universal Building Genome, live world generator or database migration. `recipe.json` resolves three home assemblies and workshop/hall skeletons. `kit.py` derives shared original geometry/material helpers from retained V03; `build.py` consumes them for this site. No external assets, HDRI, fonts, textures, image services or spend. Project/art release licensing remains undecided; do not redistribute as a licensed third-party pack.

Coordinate bridge is **logical `(x,y,z)` → Blender `(y,x,z)`**. Camera plan 45°, elevation 30°, orthographic scale 52; source 2560×1920, detail 3840×2880 with unchanged pose. The same geometry/material/light definitions produce both. `position`, covered `footprint`, `entrance` and `route` use logical units. Source area is authoring space, not a changed gameplay plot/navigation contract.

Homes share foundation/body, gable/roof tiles, door/window, framing, chimney, steps/planters and porch functions. Compact steep-gable/porch, cross-gabled return wing and low longhouse/full veranda change mass, roof, footprint and entrance shelter. Workshop has a perpendicular return/workyard; hall a hip/lantern/gallery. Object groups carry `layerId` and `studyRole`; exact reuse is code/recipe driven, not linked Blender instance counts or a generic socket solver.

Run from repository root with the approved portable Blender 4.5.15 LTS and task-local config/scripts directories:

```powershell
$env:BLENDER_USER_CONFIG=Join-Path $PWD '.local/blender/config'
$env:BLENDER_USER_SCRIPTS=Join-Path $PWD '.local/blender/scripts'
& .local/tools/blender-4.5.15-windows-x64/blender.exe --background --factory-startup --disable-autoexec --offline-mode --python-exit-code 1 --python assets/source/v04-neighborhood-study-01/build.py -- --output .local/v04-rebuild
. ./scripts/use-local-node.ps1
node scripts/pack-v04.mjs .local/v04-rebuild
```

Fresh output required. The packer refuses to overwrite a published manifest. For reproductions compare fresh raw PNG outputs to recorded hashes/decoded pixels, rather than replacing canonical exports. It trims transparent bounds, splits ground into four patches, retains independent building/tree/prop layers and five selectively loaded detail replacements. `neighborhood.blend` is the editable source checkpoint, not an application dependency; never enable embedded scripts.

Each layer is rendered with other geometry camera-invisible but still shadow/bounce-visible. Contact and cast shadows remain on source ground. **This fixed placement requires rebaking on movement/lighting changes.** It does not prove dynamic shadows or arbitrary overlap/navigation. Same-camera detail replaces only the selected building; surroundings retain overview resolution. Higher-resolution terrain/foliage and physical mobile profiling remain future review questions.

The crossing front canopies share one internally depth-correct layer; remaining trees are individually ordered. The retained layer-only repair command in scripts/rebake-v04-foreground.py reuses unchanged saved geometry and records prior source hash/time. Fresh build.py already emits this pairing.
