# H01 original source — Hearth & Hand / The Long Table

An authored three-structure art-direction hypothesis, not a procedural architecture engine or an accepted visual identity. Cottage, open repair workshop, small notice porch and shared table use original geometry/materials from `build.py` and explicit `recipe.json`. The unchanged original `../v04-neighborhood-study-01/kit.py` supplies mesh/material/opening primitives and calibrated axis conversion. Its SHA256 is recorded as a dependency; V04 source/art is not overwritten.

Logical `(x,y,z)` maps to Blender `(y,x,z)`. Fixed45°/30° orthographic camera, scale22; overview/layers2560×1920, detail3840×2880 with unchanged geometry/material/light/pose. Terrain extends beyond the camera instead of ending as a display platform. Worn paths use authored curves and vertex-weighted transparent edges; they do not define gameplay navigation. Source mesh groups and baked shadows remain fixed-placement content.

Use the already approved Blender4.5.15 LTS portable binary, task-local config/scripts, scripts disabled/offline mode:

```powershell
$env:BLENDER_USER_CONFIG=Join-Path $PWD '.local/blender/config'
$env:BLENDER_USER_SCRIPTS=Join-Path $PWD '.local/blender/scripts'
& .local/tools/blender-4.5.15-windows-x64/blender.exe --background --factory-startup --disable-autoexec --offline-mode --python-exit-code 1 --python assets/source/hearthside-hero-01/build.py -- --output .local/h01-rebuild
. ./scripts/use-local-node.ps1
node scripts/pack-h01.mjs .local/h01-rebuild
```

Fresh source output required; packer refuses to overwrite the canonical manifest. Raw intermediate renders remain under ignored `.local`; editable `hero.blend`, trimmed runtime PNGs, source/output manifests and review screenshots are retained in Git. For reproductions compare fresh output pixels/hash records, not PNG metadata timestamps. No external assets, textures, fonts, HDRI, image generation, services, software installation or spend. Project/source-art release license remains undecided; existing Blender/runtime licenses do not dictate an original-art license.

Static notices/mugs/chair repair are fictional environmental storytelling. No actual member messages, private Twitch presence, ownership, resource production, jobs or economic effects are represented. The original paired lanterns, stitched cloth and gathering-thread motif are compatibility hypotheses; no Twitch branding/endorsement claim.
