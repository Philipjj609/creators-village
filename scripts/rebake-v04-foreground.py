"""Bounded layer-only repair from retained geometry; no model/material/layout change.
Fresh build.py also emits this same group. Preserve raw prior artifacts separately.
"""
import argparse,hashlib,json,sys,time
from pathlib import Path
import bpy
p=argparse.ArgumentParser();p.add_argument('--input',required=True);p.add_argument('--output',required=True)
a=p.parse_args(sys.argv[sys.argv.index('--')+1:]);src=Path(a.input).resolve();out=Path(a.output).resolve();out.mkdir(parents=True,exist_ok=True)
assert not (out/'source-manifest.json').exists()
start=time.perf_counter();m=json.loads((src/'source-manifest.json').read_text())
import shutil
for f in m['outputs']:
    if f['file'] not in ['river-grove-3.png','river-grove-4.png']:shutil.copyfile(src/f['file'],out/f['file'])
bpy.ops.wm.open_mainfile(filepath=str(src/'neighborhood.blend'),load_ui=False,use_scripts=False)
pair=[]
for o in bpy.context.scene.objects:
    if o.type=='MESH':
        if o.get('layerId') in ['river-grove-3','river-grove-4']:o['layerId']='river-foreground-pair';pair.append(o)
        o.visible_camera=True
assert len(pair)==26
bpy.ops.wm.save_as_mainfile(filepath=str(out/'neighborhood.blend'),compress=True)
for o in bpy.context.scene.objects:
    if o.type=='MESH':o.visible_camera=o in pair
file=out/'river-foreground-pair.png';bpy.context.scene.render.filepath=str(file);bpy.ops.render.render(write_still=True)
m['layers']=[l for l in m['layers'] if l['id'] not in ['river-grove-3','river-grove-4']]+[{'id':'river-foreground-pair','anchor':[0,0],'depth':28.2,'objects':len(pair)}]
m['outputs']=[f for f in m['outputs'] if f['file'] not in ['river-grove-3.png','river-grove-4.png']]+[{'file':file.name,'bytes':file.stat().st_size,'sha256':hashlib.sha256(file.read_bytes()).hexdigest()}]
m['sourceSha256']=hashlib.sha256(Path('assets/source/v04-neighborhood-study-01/build.py').read_bytes()).hexdigest()
m['layerRepair']={'reason':'Two crossing foreground canopies require one internally depth-correct bake','geometryMaterialsLayoutChanged':False,'priorSourceSha256':json.loads((src/'source-manifest.json').read_text())['sourceSha256'],'seconds':round(time.perf_counter()-start,3)}
(out/'source-manifest.json').write_text(json.dumps(m,indent=2)+'\n',encoding='utf8',newline='\n')
