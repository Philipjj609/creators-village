"""Approved INSTALL-02A smoke check; no production art or external inputs.

Run with portable Blender --background --factory-startup --disable-autoexec
--offline-mode --python-exit-code 1 --python scripts/blender-health.py.
Outputs remain ignored under .local/evidence/blender-health.
Public release licensing of Blender-API tooling remains an owner decision.
"""

import hashlib
import json
import math
from pathlib import Path
import time

import bpy
from bpy_extras.object_utils import world_to_camera_view
from mathutils import Vector


started = time.perf_counter()
assert bpy.app.version_string == "4.5.15 LTS", bpy.app.version_string
assert not bpy.context.preferences.filepaths.use_scripts_auto_execute
output = Path(__file__).resolve().parents[1] / ".local/evidence/blender-health"
output.mkdir(parents=True, exist_ok=True)

bpy.ops.object.select_all(action="SELECT")
bpy.ops.object.delete(use_global=False)
scene = bpy.context.scene
scene.render.engine = "CYCLES"
scene.cycles.device = "CPU"
scene.cycles.samples = 16
scene.cycles.use_denoising = False
scene.render.threads_mode = "FIXED"
scene.render.threads = 4
scene.render.resolution_x = 512
scene.render.resolution_y = 384
scene.render.resolution_percentage = 100
scene.render.pixel_aspect_x = scene.render.pixel_aspect_y = 1
scene.render.film_transparent = True
scene.render.image_settings.file_format = "PNG"
scene.render.image_settings.color_mode = "RGBA"
scene.render.image_settings.color_depth = "8"
scene.view_settings.view_transform = "AgX"
scene.view_settings.exposure = 0
scene.world.use_nodes = True
scene.world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.35

bpy.ops.object.camera_add(location=(6, 6, math.sqrt(72) * math.tan(math.pi / 6)))
camera = bpy.context.object
camera.rotation_euler = (-camera.location).to_track_quat("-Z", "Y").to_euler()
camera.data.type = "ORTHO"
camera.data.ortho_scale = 512 / (32 * math.sqrt(2))
scene.camera = camera
bpy.context.view_layer.update()


def screen(point):
    # Explicit axis bridge: logical +X -> Blender +Y, logical +Y -> Blender +X.
    # The current 2D logical axes have opposite plan handedness to Blender XY.
    ndc = world_to_camera_view(scene, camera, Vector((point[1], point[0], point[2])))
    return [ndc.x * 512, (1 - ndc.y) * 384]


origin = screen((0, 0, 0))
elevation_unit = 8 / (32 * math.sqrt(2) * math.cos(math.pi / 6))
cases = [
    ("x", (1, 0, 0), [32, 16]),
    ("y", (0, 1, 0), [-32, 16]),
    ("elevation", (0, 0, elevation_unit), [0, -8]),
]
calibration = {}
for name, point, expected in cases:
    projected = screen(point)
    delta = [projected[i] - origin[i] for i in range(2)]
    error = max(abs(delta[i] - expected[i]) for i in range(2))
    assert error < 0.02, (name, delta, expected)
    calibration[name] = {"actual": delta, "expected": expected, "maxErrorPx": error}


def matte(name, color):
    material = bpy.data.materials.new(name)
    material.use_nodes = True
    node = material.node_tree.nodes.get("Principled BSDF")
    node.inputs["Base Color"].default_value = (*color, 1)
    node.inputs["Roughness"].default_value = 0.8
    return material


bpy.ops.mesh.primitive_cube_add(size=2, location=(0, 0, 1))
bpy.context.object.data.materials.append(matte("health-cube", (0.14, 0.34, 0.55)))
bpy.ops.mesh.primitive_plane_add(size=8, location=(0, 0, 0))
bpy.context.object.data.materials.append(matte("health-ground", (0.4, 0.4, 0.4)))
bpy.ops.object.light_add(type="AREA", location=(-3, -4, 7))
bpy.context.object.data.energy = 700
bpy.context.object.data.shape = "DISK"
bpy.context.object.data.size = 4
bpy.context.object.rotation_euler = (
    -bpy.context.object.location
).to_track_quat("-Z", "Y").to_euler()
image_path = output / "cpu-calibration.png"
scene.render.filepath = str(image_path)
bpy.ops.render.render(write_still=True)
data = image_path.read_bytes()
assert len(data) > 1000
report = {
    "purpose": "INSTALL-02A CPU/export/projection health only; NOT V03 art or visual acceptance",
    "version": bpy.app.version_string,
    "buildHash": bpy.app.build_hash.decode(),
    "engine": scene.render.engine,
    "device": scene.cycles.device,
    "samples": scene.cycles.samples,
    "threads": scene.render.threads,
    "autoExecuteScripts": bpy.context.preferences.filepaths.use_scripts_auto_execute,
    "resolution": [512, 384],
    "cameraPlanDegrees": 45,
    "cameraElevationDegrees": 30,
    "logicalToBlenderAxes": "(x,y,z) -> (y,x,z)",
    "calibration": calibration,
    "pngBytes": len(data),
    "pngSha256": hashlib.sha256(data).hexdigest(),
    "elapsedSeconds": round(time.perf_counter() - started, 3),
    "limitations": "CPU background only; no GUI, GPU compute, browser/mobile performance, paired art views or V03 benchmark tested",
}
(output / "report.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
print("CV_BLENDER_HEALTH " + json.dumps(report))
