"""Original V04 source: shared modules, one connected site, layered sprite exports.
Approved scope only; no persisted world schema or backend writes.
"""
import argparse, hashlib, json, math, random, sys, time
from pathlib import Path
import bpy
from mathutils import Vector
from bpy_extras.object_utils import world_to_camera_view
SOURCE=Path(__file__).resolve().parent
sys.path.insert(0,str(SOURCE))
import kit as K
P=argparse.ArgumentParser();P.add_argument('--output',required=True);P.add_argument('--quick',action='store_true');P.add_argument('--only',default='all')
A=P.parse_args(sys.argv[sys.argv.index('--')+1:])
OUT=Path(A.output).resolve();OUT.mkdir(parents=True,exist_ok=True)
if (OUT/'source-manifest.json').exists():raise RuntimeError('Use a fresh output directory; published sources are immutable')
R=json.loads((SOURCE/'recipe.json').read_text());rng=random.Random(R['seed'])
assert bpy.app.version_string=='4.5.15 LTS' and not bpy.context.preferences.filepaths.use_scripts_auto_execute
bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
K.init_materials();M=K.M;groups={};DEPTHS={};began=time.perf_counter()
# Broad meadow variation plus fine surface grain: no imported texture or HDRI.
grass=M['grass'];nodes=grass.node_tree.nodes;links=grass.node_tree.links
noise=nodes.new('ShaderNodeTexNoise');noise.inputs['Scale'].default_value=.32;noise.inputs['Detail'].default_value=3
geom=nodes.new('ShaderNodeNewGeometry');links.new(geom.outputs['Position'],noise.inputs['Vector'])
ramp=nodes.new('ShaderNodeValToRGB');ramp.color_ramp.elements[0].position=.18;ramp.color_ramp.elements[0].color=(*K.linear('526F48'),1);ramp.color_ramp.elements[1].position=.8;ramp.color_ramp.elements[1].color=(*K.linear('A4AB70'),1)
links.new(noise.outputs['Fac'],ramp.inputs['Fac']);links.new(ramp.outputs['Color'],nodes.get('Principled BSDF').inputs['Base Color'])

def smoothstep(t):
    t=max(0,min(1,t));return t*t*(3-2*t)

def river_x(y):return 15.5+1.35*math.sin(y*.20+.5)

def height(x,y):
    z=.03+.68*math.exp(-((x+6)**2/120+(y+7)**2/70))+.09*math.sin(x*.24)*math.sin(y*.27)
    for b in R['buildings']:
        bx,by,bz=b['position'];fx,fy,w,d=b['footprint']
        distance=max(abs(x-(bx+fx+w/2))-w/2,abs(y-(by+fy+d/2))-d/2)
        weight=1-smoothstep((distance-.35)/1.7)
        z=z*(1-weight)+bz*weight
    delta=abs(x-river_x(y))
    if delta<2:z=z*(smoothstep((delta-.65)/1.35))-.24*(1-smoothstep((delta-.65)/1.35))
    return z

def owned(name,callback):
    before=set(bpy.context.scene.objects);callback()
    objects=list(set(bpy.context.scene.objects)-before)
    for o in objects:o['layerId']=name
    groups.setdefault(name,[]).extend(objects)
    return objects

def home(b):
    w,d,h=b['body'];e=h+.45;rise=b['roofRise']
    K.base(0,0,w,d,h);K.gable(0,0,w,d,e,rise)
    K.door(.3,d/2+.07,.9,min(1.75,h+.05))
    for x in [-w*.29,w*.34]:K.window(x,d/2+.08,.45+h*.53,.65,.78 if h<2 else .9)
    for y in [-d*.22,d*.23]:K.side_window(w/2+.07,y,.45+h*.55,.7,.8)
    for y in [-d*.36,0,d*.36]:K.beam('shared side framing',(w/2+.05,y,.55),(w/2+.05,y,e-.05),.10,M['wood'])
    K.beam('shared gable kingpost',(0,d/2+.04,e),(0,d/2+.04,e+rise-.15),.11,M['wood'])
    for sign in [-1,1]:K.beam('shared gable brace',(sign*w*.4,d/2+.05,e+.03),(0,d/2+.05,e+rise*.75),.09,M['wood'])
    K.box('chimney shaft',(-w*.27,-.5,e+rise*.55),(.48,.54,1.35),M['stone'],.065)
    K.box('chimney cap',(-w*.27,-.5,e+rise*.55+.7),(.65,.70,.13),M['stone'],.035)
    if b['assembly']=='cross-gabled-wing':
        K.base(-2.35,.12,2.4,3.05,1.9);K.gable(-2.35,.12,3.05,2.4,2.35,1.2,axis='X');K.window(-2.4,1.69,1.55,.8,.82)
    else:
        half=2.4 if b['assembly']=='low-longhouse-veranda' else 1.2
        front=d/2+1.2;back=d/2-.10;low=e-.6
        K.slab('shared porch roof',[(-half+.3,back,e+.1),(half+.3,back,e+.1),(half+.3,front,low),(-half+.3,front,low)],M['slate'],.13,.03)
        posts=[-half+.42,half+.18] if half<2 else [-half+.42,.3,half+.18]
        for x in posts:K.beam('shared porch support',(x,front-.1,.45),(x,front-.1,low),.13,M['wood'])
    for i in range(3):K.box('entry stone step',(.3,d/2+.4+i*.3,.36-i*.09),(1.3,.44,.15),M['stone'],.05)
    K.ROLE='props'
    for x in [-w*.4,w*.43]:
        K.box('domestic planter',(x,d/2+.5,.30),(.65,.52,.46),M['wood'],.045);K.shrub(x,d/2+.5,.5,.3)
    K.ROLE='architecture'

for b in R['buildings']:
    K.RNG.seed(int(hashlib.sha256((str(R['seed'])+'/'+b['id']).encode()).hexdigest()[:8],16));K.ROLE='architecture'
    def construct(b=b):
        if b['skeleton']=='home':home(b)
        elif b['skeleton']=='workshop':K.workshop(b)
        else:K.hall(b)
    objects=owned(b['id'],construct)
    DEPTHS[b['id']]=sum(b['position'][:2])
    offset=K.B(b['position'])
    for o in objects:o.location+=offset

K.ROLE='ground'
def terrain():
    vertices=[];faces=[];nx,ny=48,42
    for j in range(ny+1):
        y=-14+j*31/ny
        for i in range(nx+1):
            u=-1+2*i/nx;v=-1+2*j/ny
            x=u*(19-1.9*abs(v)**5)+.45*math.sin(v*7)*abs(u)**5
            yy=y+.55*math.sin(u*8)*abs(v)**6
            vertices.append((x,yy,height(x,yy)))
    for j in range(ny):
        for i in range(nx):
            a=j*(nx+1)+i;faces.append((a,a+1,a+nx+2,a+nx+1))
    o=K.mesh('continuous landform',vertices,faces,M['grass'])
    for p in o.data.polygons:p.use_smooth=True
    # A real surface channel cut by the height field, not a decorative pond ellipse.
    verts=[];faces=[]
    for i in range(85):
        y=-14+i*31/84;x=river_x(y)
        width=.59+.12*math.sin(y*.52)
        verts.extend([(x-width,y,-.17),(x+width,y,-.17)])
        if i:faces.append((2*i-2,2*i-1,2*i+1,2*i))
    water=K.material('brook water','6B9D9B',rough=.28,grain=.012)
    K.mesh('brook surface',verts,faces,water)
owned('ground',terrain)

def spline(points,steps=8):
    result=[]
    for i in range(len(points)-1):
        a=Vector(points[max(0,i-1)]);b=Vector(points[i]);c=Vector(points[i+1]);d=Vector(points[min(len(points)-1,i+2)])
        for j in range(steps):
            t=j/steps;q=.5*((2*b)+(-a+c)*t+(2*a-5*b+4*c-d)*t*t+(-a+3*b-3*c+d)*t*t*t)
            result.append((q.x,q.y))
    result.append(tuple(points[-1]));return result

def road(points,width):
    line=spline(points);verts=[];faces=[]
    for i,(x,y) in enumerate(line):
        before=line[max(0,i-1)];after=line[min(len(line)-1,i+1)];dx,dy=after[0]-before[0],after[1]-before[1];norm=max(.001,math.hypot(dx,dy))
        for sign in [-1,1]:
            xx=x-sign*dy/norm*width/2;yy=y+sign*dx/norm*width/2;verts.append((xx,yy,height(xx,yy)+.028))
        if i:faces.append((2*i-2,2*i-1,2*i+1,2*i))
    K.mesh('continuous worn route',verts,faces,M['path'])

def paths():
    for r in R['roads']:road(r['points'],r['width'])
    for b in R['buildings']:road(b['route'],1 if b['kind']=='home' else 1.6)
    # Rounded plaza stones and workshop paving follow terrain instead of five plinths.
    for area in [(-9.2,-1.5,-1.9,1.2),(3.3,9,1.9,4.3)]:
        x0,x1,y0,y1=area
        for j in range(round((y1-y0)/.58)):
            for i in range(round((x1-x0)/.70)):
                x=x0+i*.70+(j%2)*.22;y=y0+j*.58
                K.box('worn shared court stone',(x,y,height(x,y)+.045),(.62+rng.uniform(-.05,.04),.50,.065),rng.choice(K.STONES),.075)
owned('ground',paths)

def ground_details():
    # Sparse edge tufts, bank rocks and low garden rows; no arbitrary world-spanning decor.
    for i in range(68):
        y=rng.uniform(-13,16);x=river_x(y)+rng.choice([-1,1])*rng.uniform(.85,1.7)
        K.rock((x,y,height(x,y)+.08),(.28,.32,.20),rng.choice(K.STONES))
    for i in range(17):
        x=-10+i*.48;y=1.0+math.sin(i*.20)*.22
        K.box('public terrace retaining edge',(x,y,height(x,y)-.02),(.48,.40,.27),rng.choice(K.STONES),.08)
    for cx,cy in [(-12,2),(-7,8),(8,8.2)]:
        for j in range(3):
            for i in range(5):
                x=cx+i*.23;y=cy+j*.3;K.shrub(x,y,height(x,y),.13)
owned('ground',ground_details)

def props():
    K.ROLE='props'
    for x,y in [(-8.1,-.3),(-1.5,-.4),(-11.5,5.5)]:
        objects=owned('bench-'+str(x),lambda x=x,y=y:K.bench(x,y))
        for o in objects:o.location.z+=height(x,y)
        DEPTHS['bench-'+str(x)]=x+y
    # Functional static workyard cart with timber and wheels; no economic behavior.
    x,y=11.2,2.8;z=height(x,y)
    before=set(bpy.context.scene.objects)
    K.box('timber cart bed',(x,y,z+.55),(1.25,1.8,.16),M['wood'],.04)
    for dx in [-.75,.75]:K.cylinder('cart wheel',(x+dx-.07,y,z+.4),(x+dx+.07,y,z+.4),.37,M['wood'],16)
    for i in range(4):K.box('cart boards',(x-.4+i*.25,y,z+.72+i*.035),(.19,2,.10),M['door'],.02)
    groups['cart']=list(set(bpy.context.scene.objects)-before);DEPTHS['cart']=x+y
    # Linen belongs to a domestic yard; static original cloth, not inhabitant presence.
    x,y=9,10;z=height(x,y)
    before=set(bpy.context.scene.objects)
    for dx in [-1.2,1.2]:K.beam('linen support',(x+dx,y,z),(x+dx,y,z+1.55),.055,M['wood'])
    K.cylinder('linen cord',(x-1.2,y,z+1.5),(x+1.2,y,z+1.5),.013,M['wood'],6)
    for i in range(3):K.box('plain linen',(x-.8+i*.65,y,z+1.05),(.5,.025,.75),M['plaster'],.02)
    groups['linen']=list(set(bpy.context.scene.objects)-before);DEPTHS['linen']=x+y
props()

K.ROLE='vegetation'
for name,points in [('back-grove',[(-14,-9,4.8),(-11,-11,4.2),(-8,-10,5.1),(-1,-11,4.5),(6,-9,4.7),(9,-11,3.5)]),('left-copse',[(-16,-3,4),(-15,0,4.3),(-15,4,3.7),(-16,7,3.6),(-12,12.8,4.2),(-15,13,3.5)]),('river-grove',[(13,-7,4.1),(12.8,-4,3),(13,1,3.7),(14,12.8,4.6),(13.2,15,3.3)]),('commons-tree',[(.8,-.4,3.6)])]:
    def grow(points=points):
        for x,y,h in points:
            before=set(bpy.context.scene.objects);K.tree(x,y,h)
            for o in set(bpy.context.scene.objects)-before:
                o.location.z+=height(x,y)
                if o.type=='MESH' and any(m.name.startswith('leaf') for m in o.data.materials):
                    for p in o.data.polygons:p.use_smooth=True
    # Each tree is a depth-sorted layer, not a copse-sized foreground occluder.
    for i,p in enumerate(points):
        owned(name+'-'+str(i),lambda p=p:grow([p]));DEPTHS[name+'-'+str(i)]=p[0]+p[1]

# The two front canopies cross. Bake this bounded pair together instead of
# claiming a trunk-depth order can resolve interpenetrating foliage.
pair=[]
for name in ['river-grove-3','river-grove-4']:
    pair.extend(groups.pop(name));DEPTHS.pop(name)
groups['river-foreground-pair']=pair;DEPTHS['river-foreground-pair']=28.2
for o in pair:o['layerId']='river-foreground-pair'

scene=bpy.context.scene;scene.render.engine='CYCLES';scene.cycles.device='CPU';scene.cycles.samples=24 if A.quick else 72;scene.cycles.seed=609;scene.cycles.use_denoising=True;scene.cycles.adaptive_threshold=.025 if A.quick else .012
scene.render.threads_mode='FIXED';scene.render.threads=12;scene.render.image_settings.file_format='PNG';scene.render.image_settings.color_mode='RGBA';scene.render.film_transparent=True
scene.view_settings.view_transform='AgX';scene.view_settings.look='AgX - Medium High Contrast';scene.view_settings.exposure=.3
scene.world.use_nodes=True;scene.world.node_tree.nodes['Background'].inputs['Color'].default_value=(.73,.82,1,1);scene.world.node_tree.nodes['Background'].inputs['Strength'].default_value=.55
for p,energy,size,color in [((-8,-12,25),9500,12,(1,.86,.69)),((16,18,20),2200,14,(.83,.91,1))]:
    bpy.ops.object.light_add(type='AREA',location=K.B(p));o=bpy.context.object;o.data.energy=energy;o.data.size=size;o.data.color=color;o.rotation_euler=(-o.location).to_track_quat('-Z','Y').to_euler()
target=K.B((0,1,0));bpy.ops.object.camera_add(location=target+Vector((30,30,math.sqrt(1800)*math.tan(math.pi/6))))
cam=bpy.context.object;cam.rotation_euler=(target-cam.location).to_track_quat('-Z','Y').to_euler();cam.data.type='ORTHO';cam.data.ortho_scale=52;scene.camera=cam
W,H=(1280,960) if A.quick else (2560,1920)
scene.render.resolution_x=W;scene.render.resolution_y=H;scene.render.resolution_percentage=100;bpy.context.view_layer.update()
def screen(p):
    v=world_to_camera_view(scene,cam,K.B(p));return [v.x*W,(1-v.y)*H]
all_mesh=[o for o in scene.objects if o.type=='MESH'];outputs=[]
def render(name):
    file=OUT/(name+'.png');scene.render.filepath=str(file);bpy.ops.render.render(write_still=True);outputs.append({'file':file.name,'bytes':file.stat().st_size,'sha256':hashlib.sha256(file.read_bytes()).hexdigest()});print('V04_EXPORT '+name,flush=True)
render('source-overview')
if not A.quick:
    bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'neighborhood.blend'),compress=True)
    for name in groups:
        for o in all_mesh:o.visible_camera=o in groups[name]
        render(name)
    # Higher resolution replacement of the same source geometry, with unchanged pose.
    scene.render.resolution_x=3840;scene.render.resolution_y=2880
    for b in R['buildings']:
        for o in all_mesh:o.visible_camera=o in groups[b['id']]
        render(b['id']+'-detail')
    for o in all_mesh:o.visible_camera=True
metadata={'version':R['version'],'studyOnly':True,'camera':{'width':W,'height':H,'scale':52,'axes':'(x,y,z)->(y,x,z)','plan':45,'elevation':30},'layers':[{'id':name,'anchor':screen(next((b['position'] for b in R['buildings'] if b['id']==name),(0,0,0))),'depth':DEPTHS.get(name,0),'objects':len(objects)} for name,objects in groups.items()],'buildings':[{**b,'screenAnchor':screen(b['position'])} for b in R['buildings']],'roads':R['roads'],'sourceSha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),'kitSha256':hashlib.sha256((SOURCE/'kit.py').read_bytes()).hexdigest(),'recipeSha256':hashlib.sha256((SOURCE/'recipe.json').read_bytes()).hexdigest(),'blender':bpy.app.version_string,'buildHash':bpy.app.build_hash.decode(),'render':{'engine':'Cycles CPU','samples':scene.cycles.samples,'seed':609,'denoising':True,'color':'AgX Medium High Contrast exposure +0.3; RGBA sRGB'},'outputs':outputs,'elapsedSeconds':round(time.perf_counter()-began,3),'provenance':'Original V04 modules derived from original retained V03 source; no third-party assets or services; release licensing pending'}
(OUT/'source-manifest.json').write_text(json.dumps(metadata,indent=2)+'\n',encoding='utf-8',newline='\n')
