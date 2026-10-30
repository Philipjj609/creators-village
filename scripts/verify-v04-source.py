"""Read the saved V04 scene, audit logical bounds, rerender one source layer."""
import argparse,json,sys
from pathlib import Path
import bpy
from mathutils import Vector
p=argparse.ArgumentParser();p.add_argument('--scene',required=True);p.add_argument('--output',required=True)
a=p.parse_args(sys.argv[sys.argv.index('--')+1:]);out=Path(a.output).resolve();out.mkdir(parents=True,exist_ok=True)
bpy.ops.wm.open_mainfile(filepath=str(Path(a.scene).resolve()),load_ui=False,use_scripts=False)
assert not bpy.context.preferences.filepaths.use_scripts_auto_execute
scene=bpy.context.scene
groups={}
for o in scene.objects:
    if o.type=='MESH':groups.setdefault(o.get('layerId','unassigned'),[]).append(o)
audit=[]
for name,objects in groups.items():
    corners=[o.matrix_world@Vector(v) for o in objects for v in o.bound_box]
    # Inverse calibrated axis bridge: Blender (X,Y,Z) -> logical (Y,X,Z).
    audit.append({'id':name,'meshObjects':len(objects),'vertices':sum(len(o.data.vertices) for o in objects),'logicalGeometryAabb':[min(v.y for v in corners),min(v.x for v in corners),min(v.z for v in corners),max(v.y for v in corners),max(v.x for v in corners),max(v.z for v in corners)],'roles':sorted(set(o.get('studyRole','unspecified') for o in objects))})
(out/'geometry-audit.json').write_text(json.dumps({'blender':bpy.app.version_string,'axisBridge':'(x,y,z)->(y,x,z)','groups':audit,'limitation':'Full rendered geometry AABB includes roof eaves/props; authored covered footprint is not an authoritative navigation contract.'},indent=2)+'\n')
for o in scene.objects:
    if o.type=='MESH':o.visible_camera=o.get('layerId')=='hearth-home'
scene.render.filepath=str(out/'hearth-home-rerender.png')
bpy.ops.render.render(write_still=True)
