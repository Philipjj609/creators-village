"""Read-only ws1 calibration of the retained H01 source; no renders/source writes."""
import bpy,json,hashlib
from pathlib import Path
root=Path(__file__).resolve().parent.parent
scene_path=root/'assets/source/hearthside-hero-01/hero.blend'
bpy.ops.wm.open_mainfile(filepath=str(scene_path),load_ui=False,use_scripts=False)
recipe=json.loads((scene_path.parent/'recipe.json').read_text())
b=next(b for b in recipe['buildings'] if b['id']=='workshop')
dep=bpy.context.evaluated_depsgraph_get();points=[];objects=0
for obj in bpy.context.scene.objects:
 if obj.type!='MESH' or obj.get('layerId')!='workshop':continue
 objects+=1;ev=obj.evaluated_get(dep);mesh=ev.to_mesh()
 for v in mesh.vertices:
  p=ev.matrix_world@v.co
  points.append((p.y-b['position'][0],p.x-b['position'][1],p.z-b['position'][2]))
 ev.to_mesh_clear()
minimum=[min(p[i] for p in points) for i in range(3)]
maximum=[max(p[i] for p in points) for i in range(3)]
fits=minimum[0]>=-3 and minimum[1]>=-3 and maximum[0]<=3 and maximum[1]<=3
record={'date':'2026-10-29','source':'assets/source/hearthside-hero-01/hero.blend','sourceSha256':hashlib.sha256(scene_path.read_bytes()).hexdigest(),'assetManifestSha256':hashlib.sha256((root/'assets/generated/hearthside-hero-01/manifest.json').read_bytes()).hexdigest(),'axisBridge':'Blender(x,y,z)=(logical_y,logical_x,logical_z)','template':'wf2-workshop-1','envelope':[-3,-3,3,3],'evaluatedMeshObjects':objects,'evaluatedVertices':len(points),'logicalMin':minimum,'logicalMax':maximum,'fits':fits,'entrance':[0,3.5],'pathCap':'Butt end cap at entrance; square interior joins. No path cap projects into the footprint.','limitations':['Source mesh envelope only; server terrain/navigation and runtime pixel/anchor tests are separate.','No artistic approval inferred.']}
out=root/'docs/testing/evidence/wf2';out.mkdir(parents=True,exist_ok=True)
(out/'source-calibration.json').write_text(json.dumps(record,indent=2)+'\n')
assert fits,record
print('WF2 source calibration:',objects,'objects;',len(points),'evaluated vertices; fits:',fits)
