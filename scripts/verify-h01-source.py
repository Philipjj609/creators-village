"""Saved-scene authoring checks, not a gameplay navigation test."""
import argparse,json,sys
from pathlib import Path
import bpy
from mathutils import Vector
from mathutils.bvhtree import BVHTree
from bpy_extras.object_utils import world_to_camera_view
p=argparse.ArgumentParser();p.add_argument('--scene',required=True);p.add_argument('--output',required=True)
a=p.parse_args(sys.argv[sys.argv.index('--')+1:]);out=Path(a.output).resolve();out.mkdir(parents=True,exist_ok=True)
bpy.ops.wm.open_mainfile(filepath=str(Path(a.scene).resolve()),load_ui=False,use_scripts=False)
scene=bpy.context.scene;ground=next(o for o in scene.objects if o.name=='continuous terrain beyond camera')
tree=BVHTree.FromPolygons([ground.matrix_world@v.co for v in ground.data.vertices],[tuple(p.vertices) for p in ground.data.polygons])
gaps=[];interior=[]
def gap(pos):
    hit,normal,index,distance=tree.ray_cast(Vector((pos.x,pos.y,100)),Vector((0,0,-1)))
    assert hit is not None;return pos.z-hit.z
for o in scene.objects:
    if o.name.startswith('grass-softened desire path'):
        for v in o.data.vertices:
            pos=o.matrix_world@v.co;gaps.append(gap(pos))
        for face in o.data.polygons:
            points=[o.matrix_world@o.data.vertices[i].co for i in face.vertices]
            interior.append(gap(sum(points,Vector())/len(points)))
            for i in range(1,len(points)-1):interior.append(gap((points[0]+points[i]+points[i+1])/3))
assert min(gaps)>.002,('Path intersects actual triangulated ground',min(gaps))
assert max(gaps)<.13,('Excessive path depth bias',max(gaps))
assert min(interior)>.001,('Path face intersects terrain',min(interior))
groups={}
for o in scene.objects:
    if o.type=='MESH':groups.setdefault(o.get('layerId','unassigned'),[]).append(o)
record={'axisBridge':'(x,y,z)->(y,x,z)','pathVerticesChecked':len(gaps),'minimumPathSurfaceGap':min(gaps),'maximumPathSurfaceGap':max(gaps),'pathFaceSamples':len(interior),'minimumFaceInteriorGap':min(interior),'terrainVertices':len(ground.data.vertices),'groups':[{'id':k,'meshObjects':len(v),'sourceVertices':sum(len(o.data.vertices) for o in v)} for k,v in groups.items()],'limitation':'Sampled vertical mesh clearance only; not slopes/character access/collision or accepted spatial contract.'}
(out/'source-audit.json').write_text(json.dumps(record,indent=2)+'\n')
meshes=[o for o in scene.objects if o.type=='MESH'];objects=groups['home']
for o in meshes:o.visible_camera=o in objects
points=[world_to_camera_view(scene,scene.camera,o.matrix_world@Vector(c)) for o in objects for c in o.bound_box]
scene.render.use_border=True;scene.render.use_crop_to_border=False
scene.render.border_min_x=max(0,min(p.x for p in points)-.012);scene.render.border_max_x=min(1,max(p.x for p in points)+.012)
scene.render.border_min_y=max(0,min(p.y for p in points)-.012);scene.render.border_max_y=min(1,max(p.y for p in points)+.012)
scene.render.filepath=str(out/'home-rerender.png');bpy.ops.render.render(write_still=True)
