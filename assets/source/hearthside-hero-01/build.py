"""H01 original art-direction scene. Retains V04 helpers/axis bridge without edits.
No third-party art, world mutation, universal grammar or automated artistic pass.
"""
import argparse,hashlib,json,math,random,sys,time
from pathlib import Path
import bpy
from mathutils import Vector
from bpy_extras.object_utils import world_to_camera_view
HERE=Path(__file__).resolve().parent
KIT=HERE.parent/'v04-neighborhood-study-01'/'kit.py';sys.path.insert(0,str(KIT.parent));import kit as K
p=argparse.ArgumentParser();p.add_argument('--output',required=True);p.add_argument('--quick',action='store_true')
a=p.parse_args(sys.argv[sys.argv.index('--')+1:]);out=Path(a.output).resolve();out.mkdir(parents=True,exist_ok=True)
assert not (out/'source-manifest.json').exists()
assert bpy.app.version_string=='4.5.15 LTS' and not bpy.context.preferences.filepaths.use_scripts_auto_execute
start=time.perf_counter();R=json.loads((HERE/'recipe.json').read_text());rng=random.Random(R['seed']);K.RNG.seed(R['seed'])
bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
K.init_materials();M=K.M
for name,color,grain in [('plaster','E7D4AD',.08),('wood','65533E',.045),('door','9A7650',.04),('stone','A3A08A',.08),('path','B6A381',.04),('grass','7C925D',.06),('glass','C79D62',.01),('slate','627F78',.035)]:M[name]=K.material('H01 '+name,color,grain=grain)
K.ROOFS=[K.material('weathered clay '+str(i),c,grain=.055) for i,c in enumerate(['A96F50','B8805F','AB795D','BC8969','96775B','B48B70'])]
cloth=K.material('undyed linen','D8C9A4',grain=.045);ink=K.material('washed blue cloth','6D858A',grain=.04)
sage=K.material('stitched sage','829073',grain=.04);ochre=K.material('ochre pottery','B9945E',grain=.04)
cream=K.material('cream petals','E1D4A4',grain=.015);moss=K.material('roof moss','737E4E',grain=.07)
groups={};depths={};
def own(name,depth,fn):
    before=set(bpy.context.scene.objects);fn();objects=list(set(bpy.context.scene.objects)-before)
    for o in objects:o['layerId']=name
    groups[name]=objects;depths[name]=depth
def height(x,y):
    z=.08+.32*math.sin(x*.17+.7)*math.cos(y*.19)+.45*math.exp(-((x+7)**2+(y+5)**2)/80)
    for b in R['buildings']:
        bx,by,bz=b['position'];w,d,h=b['body'];dist=max(abs(x-bx)-w/2,abs(y-by)-d/2)
        t=max(0,min(1,(dist-.3)/1.8));blend=1-t*t*(3-2*t);z=z*(1-blend)+bz*blend
    return z
def organic(name,p,scale,mat,subdiv=2):
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=subdiv,radius=1,location=K.B(p));o=bpy.context.object
    for v in o.data.vertices:v.co*=rng.uniform(.88,1.12)
    o.scale=(scale[1],scale[0],scale[2]);K.tag(o,name,mat)
    for f in o.data.polygons:f.use_smooth=True
    return o
def wall(cx,cy,w,d,h):
    # Gentle taper and broad limewash variation replace a perfect cube facade.
    z=.28;v=[(cx-w/2,cy-d/2,z),(cx+w/2,cy-d/2,z),(cx+w/2,cy+d/2,z),(cx-w/2,cy+d/2,z),
      (cx-w/2+.05,cy-d/2+.025,z+h),(cx+w/2-.06,cy-d/2+.025,z+h+.03),(cx+w/2-.06,cy+d/2-.02,z+h+.03),(cx-w/2+.05,cy+d/2-.02,z+h)]
    K.mesh('soft limewashed walls',v,[(0,1,2,3),(0,4,5,1),(1,5,6,2),(2,6,7,3),(3,7,4,0),(4,7,6,5)],M['plaster'],.08)
    for side in [-1,1]:
        for i in range(8):
            x=cx-w/2+(i+.5)*w/8;y=cy+side*(d/2+.025)
            K.box('irregular footstone',(x,y,.19+rng.uniform(-.02,.02)),(w/8-.025,.22,rng.uniform(.27,.38)),rng.choice(K.STONES),.085)
def roof(cx,cy,w,d,eave,rise):
    # Authored slight sag, unequal eaves and irregular overlapping rows.
    def z(t,y):return eave+rise*(t-.095*math.sin(math.pi*t))+.045*math.sin(y*1.4)*(1-t)
    for sign in [-1,1]:
        half=w/2*(1.04 if sign<0 else .98)+.24;dd=d/2+.35
        for row in range(8):
            t0=row/8;t1=min(1,(row+1.16)/8)
            for col in range(max(8,round(d*3))):
                n=max(8,round(d*3));y0=-dd+2*dd*col/n;y1=-dd+2*dd*(col+.98)/n
                jitter=rng.uniform(-.018,.018)
                corners=[(cx+sign*half*(1-t0),cy+y0,z(t0,y0)+jitter),(cx+sign*half*(1-t0),cy+y1,z(t0,y1)+jitter),(cx+sign*half*(1-t1),cy+y1,z(t1,y1)+jitter),(cx+sign*half*(1-t1),cy+y0,z(t1,y0)+jitter)]
                K.slab('soft overlapping clay shingle',corners,rng.choice(K.ROOFS),.075,.025)
        for yy in [-dd,dd]:
            for i in range(8):
                t=i/8;u=(i+1)/8;K.beam('curved verge segment',(cx+sign*half*(1-t),cy+yy,z(t,yy)-.015),(cx+sign*half*(1-u),cy+yy,z(u,yy)-.015),.12,M['wood'])
    # Attic follows the same bowed profile, preventing an empty black gable.
    for yy in [-d/2,d/2]:
        verts=[(cx-w/2,cy+yy,eave-.13),(cx+w/2,cy+yy,eave-.13)]+[(cx+w/2*(1-i/8),cy+yy,z(i/8,yy)-.05) for i in range(9)]+[(cx-w/2*i/8,cy+yy,z(1-i/8,yy)-.05) for i in range(1,9)]
        K.mesh('bowed limewash gable',verts,[tuple(range(len(verts)))],M['plaster'],.025)
    for i in range(round(d*3)+2):
        y=cy-d/2-.3+i*(d+.6)/(round(d*3)+2);K.cylinder('worn ridge cap',(cx,y,eave+rise+.04),(cx,y+.32,eave+rise+.04),.11,rng.choice(K.ROOFS),10)
def lantern(x,y,z):
    K.box('lantern warm pane',(x,y,z),(.22,.20,.31),M['glass'],.025)
    for dz in [-.19,.19]:K.box('lantern rim',(x,y,z+dz),(.29,.27,.055),M['wood'],.02)
    for dx in [-.12,.12]:K.beam('paired lantern mullion',(x+dx,y-.11,z-.17),(x+dx,y-.11,z+.17),.025,M['wood'])
def pot(x,y,z,size=.25,flowers=False):
    organic('handmade pot',(x,y,z+size*.45),(size,size*.85,size*.65),ochre)
    if flowers:
        for i in range(5):
            xx=x+rng.uniform(-size,size);yy=y+rng.uniform(-size,size);zz=z+size+rng.uniform(.12,.35)
            K.cylinder('garden stem',(xx,yy,z+.2),(xx,yy,zz),.013,sage,5);organic('cream garden blossom',(xx,yy,zz),(.06,.06,.035),cream,1)
def cottage():
    wall(0,0,3.8,3.4,2.05);roof(-.05,0,3.8,3.4,2.32,1.65)
    K.door(-.55,1.75,.83,1.78);K.window(.90,1.76,1.45,1.12,1.04)
    # Open shutters, light curtains and an actual small projecting kitchen bay.
    for x in [.18,1.62]:
        o=K.box('open painted shutter',(x,1.88,1.45),(.25,.09,1.14),sage,.025);o.rotation_euler.z=.18 if x<1 else -.22
    for x in [.57,1.23]:K.box('linen curtain',(x,1.80,1.45),(.16,.035,.9),cloth,.025)
    K.box('kitchen bay',(1.95,-.45,1.13),(.55,1.5,1.23),M['plaster'],.09);K.side_window(2.25,-.45,1.37,.94,.85)
    K.slab('bay copper shelter',[(1.65,-1.35,2.03),(2.4,-1.35,1.83),(2.4,.45,1.83),(1.65,.45,2.03)],M['slate'],.12,.04)
    K.slab('asymmetric door shelter',[(-1.35,1.5,2.23),(.18,1.5,2.23),(.18,2.65,1.98),(-1.35,2.65,1.98)],M['slate'],.14,.05)
    K.beam('one sheltered porch post',(-1.2,2.48,.15),(-1.2,2.48,2.0),.14,M['wood'])
    for i in range(3):K.box('worn doorstep',(-.55,1.95+i*.27,.22-i*.055),(1.08,.43,.15),rng.choice(K.STONES),.085)
    K.box('tall warm stone chimney',(-1.0,-.8,3.6),(.53,.6,1.8),M['stone'],.09)
    K.box('chimney rim',(-1,-.8,4.53),(.68,.72,.14),M['stone'],.06)
    lantern(-1.05,1.91,1.9);pot(1.56,1.9,.1,.26,True)
    # Visible join/repair instead of a uniform decorative timber grid.
    for x in [-1.85,1.85]:K.beam('aged corner upright',(x,1.72,.42),(x,1.72,2.3),.13,M['wood'])
    K.beam('repaired lintel',(-1.86,1.74,2.28),(1.87,1.74,2.28),.15,M['door'])
def workshop():
    K.box('rear workshop wall',(0,-1.35,1.25),(4,.22,2.25),M['plaster'],.08)
    for x in [-1.95,1.95]:
        K.box('low side workshop wall',(x,-.4,.66),(.2,2.1,1.1),M['plaster'],.08)
        for y in [-1.35,1.2]:K.beam('working oak post',(x,y,.1),(x,y,2.2),.22,M['wood'])
    K.beam('wide open bay lintel',(-2,1.2,2.17),(2,1.2,2.17),.24,M['wood']);roof(0,-.05,4,3,2.23,1.06)
    # Woven canopy shares the street rather than a closed symmetrical facade.
    K.slab('faded workshop awning',[(-1.8,1.2,2.05),(1.8,1.2,2.05),(1.8,2.55,1.72),(-1.8,2.55,1.72)],cloth,.045,.025)
    for x in [-1.75,1.75]:K.beam('canopy pole',(x,2.45,.08),(x,2.45,1.78),.09,M['wood'])
    for i in range(5):K.box('soft blue canopy edging',(-1.6+i*.72,2.55,1.67),(.32,.04,.17),ink,.035)
    for i in range(5):K.box('bench top plank',(-1.1+i*.52,.68,1.0),(.49,.8,.13),M['door'],.045)
    for x in [-1.1,.95]:K.box('workbench trestle',(x,.68,.48),(.14,.62,.93),M['wood'],.04)
    for x in [-.7,.1,.8]:pot(x,.68,1.08,.12)
    for i in range(6):K.beam('stored timber',(2.3,-1.1+i*.18,.1),(2.3,.9+i*.07,1.75+i*.035),.14,M['door'])
    K.box('peg rail',(0,-1.16,1.7),(2.9,.1,.14),M['wood'])
    for i in range(7):K.beam('hanging hand tool',(-1.2+i*.4,-1.04,1.6),(-1.12+i*.4,-1.04,1.08+rng.uniform(-.1,.15)),.045,M['metal'])
    lantern(1.62,1.32,1.77)
def commons():
    for x in [-1.3,1.3]:K.beam('notice porch post',(x,.45,.05),(x,.45,2.0),.18,M['wood'])
    K.slab('low civic roof',[(-1.65,-.75,2.25),(1.65,-.75,2.25),(1.65,.65,1.98),(-1.65,.65,1.98)],M['slate'],.15,.06)
    for i in range(7):K.box('noticeboard reused plank',(-1.15+i*.38,.52,1.22),(.35,.13,1.18),M['door'],.035)
    # Abstract notices are authored marks, never claims about actual chat/users.
    for x,y,z,w,h,mat in [(-.65,.62,1.5,.48,.5,cloth),(.05,.63,1.3,.44,.43,ink),(.65,.63,1.5,.38,.6,sage)]:
        K.box('handmade notice',(x,y,z),(w,.025,h),mat,.018)
        K.cylinder('notice tack',(x,y+.04,z+h*.4),(x,y+.06,z+h*.4),.022,M['brass'],6)
    lantern(-1.1,.75,1.7);lantern(1.1,.75,1.7)
def placed(b,fn):
    def make():
        before=set(bpy.context.scene.objects);fn();offset=K.B(b['position'])
        for o in set(bpy.context.scene.objects)-before:o.location+=offset
    own(b['id'],sum(b['position'][:2]),make)
for b,fn in zip(R['buildings'],[cottage,workshop,commons]):placed(b,fn)

def meadow_material():
    m=M['grass'];n=m.node_tree.nodes;l=m.node_tree.links;geom=n.new('ShaderNodeNewGeometry');noise=n.new('ShaderNodeTexNoise');noise.inputs['Scale'].default_value=.45;noise.inputs['Detail'].default_value=4;l.new(geom.outputs['Position'],noise.inputs['Vector'])
    ramp=n.new('ShaderNodeValToRGB');ramp.color_ramp.elements[0].color=(*K.linear('526F46'),1);ramp.color_ramp.elements[1].color=(*K.linear('A4AD79'),1);l.new(noise.outputs['Fac'],ramp.inputs['Fac']);l.new(ramp.outputs['Color'],n.get('Principled BSDF').inputs['Base Color'])
meadow_material()
pathmat=M['path'].copy();pathmat.name='feathered worn earth';nodes=pathmat.node_tree.nodes;links=pathmat.node_tree.links
mix=nodes.new('ShaderNodeMixShader');clear=nodes.new('ShaderNodeBsdfTransparent');attr=nodes.new('ShaderNodeAttribute');attr.attribute_name='Wear'
links.new(attr.outputs['Fac'],mix.inputs[0]);links.new(clear.outputs[0],mix.inputs[1]);links.new(nodes.get('Principled BSDF').outputs[0],mix.inputs[2]);links.new(mix.outputs[0],nodes.get('Material Output').inputs['Surface'])
def curve(points,steps=36):
    result=[]
    for i in range(len(points)-1):
        aa,bb,cc,dd=[Vector(points[k]) for k in [max(0,i-1),i,i+1,min(len(points)-1,i+2)]]
        for j in range(steps):
            t=j/steps;q=.5*(2*bb+(-aa+cc)*t+(2*aa-5*bb+4*cc-dd)*t*t+(-aa+3*bb-3*cc+dd)*t*t*t);result.append((q.x,q.y))
    return result+[tuple(points[-1])]
def path(points,width):
    line=curve(points);verts=[];faces=[];weights=[]
    for i,(x,y) in enumerate(line):
        before=line[max(0,i-1)];after=line[min(len(line)-1,i+1)];dx,dy=after[0]-before[0],after[1]-before[1];d=max(.001,math.hypot(dx,dy))
        for j,(offset,weight) in enumerate([(-.67,0),(-.50,.55),(-.36,1),(-.18,1),(0,1),(.18,1),(.36,1),(.50,.55),(.67,0)]):
            offset*=width*(1+.12*math.sin(i*.47));xx=x-dy/d*offset;yy=y+dx/d*offset;verts.append((xx,yy,height(xx,yy)+.055));weights.append(weight)
        if i:
            for j in range(8):k=i*9+j;faces.append((k-9,k-8,k+1,k))
    o=K.mesh('grass-softened desire path',verts,faces,pathmat);col=o.data.color_attributes.new(name='Wear',type='FLOAT_COLOR',domain='POINT')
    for i,v in enumerate(weights):col.data[i].color=(v,v,v,1)
def terrain():
    K.ROLE='ground';verts=[];faces=[];n=180
    for j in range(n+1):
        y=-36+j*72/n
        for i in range(n+1):x=-36+i*72/n;verts.append((x,y,height(x,y)))
    for j in range(n):
        for i in range(n):k=j*(n+1)+i;faces.append((k,k+1,k+n+2,k+n+1))
    o=K.mesh('continuous terrain beyond camera',verts,faces,M['grass'])
    for f in o.data.polygons:f.use_smooth=True
    for r in R['roads']:path(r['points'],r['width'])
    # Broken stepping stones only where feet and work need a harder surface.
    for cx,cy in [(-4.55,1.5),(3.8,1.3),(-.4,-4.4)]:
        for i in range(7):
            x=cx+rng.uniform(-.7,.7);y=cy+rng.uniform(-.3,.75);K.rock((x,y,height(x,y)+.025),(.28,.20,.045),rng.choice(K.STONES))
    # Kitchen patch and low woven edge follow the cottage, not an isolated plot platform.
    for row in range(3):
        for col in range(7):
            x=-7.0+col*.3;y=-1.8+row*.38;K.shrub(x,y,height(x,y)+.03,.16)
    for i in range(9):
        x=-7.5+i*.33;y=-2.5;K.beam('garden stake',(x,y,height(x,y)),(x,y,height(x,y)+.5),.045,M['wood'])
    for h in [.17,.32,.45]:K.cylinder('woven garden rail',(-7.5,-2.5,height(-7.5,-2.5)+h),(-4.85,-2.5,height(-4.85,-2.5)+h),.025,M['door'],6)
    for i in range(16):
        x=-10+i*.32;y=-3.35+.18*math.sin(i*.4)
        for row in range(2):organic('old garden boundary stone',(x+(row%2)*.13,y,height(x,y)+.12+row*.2),(.24,.25,.15),rng.choice(K.STONES),1)
    for cx,cy in [(-6.3,1.3),(5.7,3.0),(-5.9,7.5),(-2.4,-3.6)]:
        for i in range(11):
            x=cx+rng.uniform(-.7,.7);y=cy+rng.uniform(-.45,.45);z=height(x,y)
            organic('soft garden foliage',(x,y,z+.18),(.19,.23,rng.uniform(.15,.3)),sage,2)
            if i%3==0:
                K.cylinder('cottage flower stalk',(x,y,z+.1),(x,y,z+.7),.018,sage,6)
                for h in [.37,.52,.67]:organic('hollyhock bloom',(x+.04,y,z+h),(.09,.08,.065),cream,1)
    # Purposeful irregular beds/clumps. Keep the lane clear, no evenly spaced tree ring.
    for cx,cy,count in [(-7.8,.5,28),(-6,-4.2,25),(6.5,-3,26),(6,2,20),(-2,5.8,20),(1,-6,20)]:
        for i in range(count):
            x=cx+rng.uniform(-1.1,1.1);y=cy+rng.uniform(-.8,.8);z=height(x,y)
            for blade in range(3):
                dx=rng.uniform(-.10,.10);dy=rng.uniform(-.1,.1);K.mesh('meadow blade',[(x-.035,y,z),(x+.035,y,z),(x+dx,y+dy,z+rng.uniform(.15,.34))],[(0,1,2)],sage)
            if i%4==0:organic('meadow blossom',(x,y,z+.23),(.055,.055,.035),cream,1)
    for x,y in [(-5,2.1),(5.2,.8),(.9,-4.7)]:pot(x,y,height(x,y),.2,True)
own('ground',-1000,terrain)
def shared_table():
    K.ROLE='shared-space';cx,cy=-.35,4.5;z=height(cx,cy)
    for i in range(6):K.box('shared table uneven plank',(cx-.75+i*.3,cy,z+.87),( .28,2.4+rng.uniform(-.07,.05),.105),M['door'] if i!=3 else M['wood'],.055)
    for y in [cy-.75,cy+.75]:
        for x in [cx-.53,cx+.53]:K.beam('table trestle',(x,y,z+.04),(x*.0+cx+(x-cx)*.8,y,z+.83),.12,M['wood'])
    for x in [cx-1.25,cx+1.25]:
        K.box('communal bench seat',(x,cy,z+.43),(.42,2.3,.12),M['wood'],.07)
        for y in [cy-.8,cy+.8]:K.box('bench foot',(x,y,z+.21),(.19,.18,.42),M['door'],.05)
    # A patched runner and mismatched mugs make the table the emotional focal point.
    K.box('patched linen runner',(cx,cy,z+.94),(.53,2.0,.024),cloth,.018)
    K.box('visible runner patch',(cx+.06,cy+.7,z+.958),(.33,.26,.018),sage,.012)
    for i,(x,y) in enumerate([(cx-.5,cy-.7),(cx+.5,cy-.1),(cx-.5,cy+.65)]):
        K.cylinder('handmade cup',(x,y,z+.93),(x,y,z+1.10),.09,[ink,ochre,cloth][i],10)
    pot(cx+.1,cy+.2,z+.96,.13,True)
    # Chair waiting for repair links the open workshop to this common table.
    x,y=2.7,1.5;zz=height(x,y);K.box('repair chair seat',(x,y,zz+.48),(.52,.5,.10),M['door'])
    for dx,dy in [(-.2,-.2),(.2,-.2),(-.2,.2),(.2,.2)]:K.beam('chair leg',(x+dx,y+dy,zz),(x+dx,y+dy,zz+.5),.06,M['wood'])
    for dx in [-.22,.22]:K.beam('chair back upright',(x+dx,y-.2,zz+.45),(x+dx,y-.2,zz+1.1),.065,M['wood'])
    K.box('repaired chair back',(x,y-.2,zz+.94),(.5,.08,.22),sage,.04)
own('long-table',5.4,shared_table)
def tree():
    K.ROLE='vegetation';x,y=-8,2;z=height(x,y)
    trunk=[(x,y,z),(x+.18,y+.03,z+1.4),(x-.12,y+.22,z+2.8),(x+.15,y+.2,z+4.3)]
    for i in range(3):K.cylinder('bent apple trunk',trunk[i],trunk[i+1],.24-i*.05,M['bark'],10)
    leaves=[K.material('soft apple foliage '+str(i),c,grain=.025) for i,c in enumerate(['6F864F','8A985B','A2A568','647C4A','B3AB70'])]
    for i in range(15):
        angle=i*2.399;radius=math.sqrt(i/15)*2.4;xx=x+math.cos(angle)*radius;yy=y+math.sin(angle)*radius;zz=z+3.7+rng.uniform(-.2,.8)-radius*.10
        if i%3==0:K.cylinder('spreading branch',(x,y,z+2.7),(xx,yy,zz-.25),.075,M['bark'],8)
        organic('broad irregular canopy',(xx,yy,zz),(rng.uniform(.75,1.15),rng.uniform(.75,1.1),rng.uniform(.5,.85)),rng.choice(leaves),3)
    for i in range(10):
        xx=x+rng.uniform(-1.8,1.8);yy=y+rng.uniform(-1.5,1.5);organic('fallen orchard leaf',(xx,yy,height(xx,yy)+.04),(.08,.12,.015),ochre,1)
own('apple-tree',-6,tree)
def pennants():
    K.ROLE='community-cloth'
    aa=(-5.2,4.8,2.24);bb=(2.6,-1.0,2.6)
    for i in range(8):
        t=i/8;u=(i+1)/8
        def p(t):return tuple(aa[k]*(1-t)+bb[k]*t-(.34*math.sin(math.pi*t) if k==2 else 0) for k in range(3))
        K.cylinder('soft gathering cord',p(t),p(u),.012,M['wood'],6)
        if i in [1,2,4,6]:
            x,y,z=p(t+.03);K.mesh('handcut community pennant',[(x-.13,y,z),(x+.13,y,z),(x+.04,y+.025,z-.28)],[(0,1,2)],[cloth,ink,sage,ochre][[1,2,4,6].index(i)])
own('gathering-thread',-2,pennants)

scene=bpy.context.scene;scene.render.engine='CYCLES';scene.cycles.device='CPU';scene.cycles.samples=18 if a.quick else 80;scene.cycles.seed=R['seed'];scene.cycles.use_denoising=True;scene.cycles.adaptive_threshold=.018
scene.render.threads_mode='FIXED';scene.render.threads=12;scene.render.image_settings.file_format='PNG';scene.render.image_settings.color_mode='RGBA';scene.render.film_transparent=True
scene.world.use_nodes=True;scene.world.node_tree.nodes['Background'].inputs['Color'].default_value=(.72,.81,.87,1);scene.world.node_tree.nodes['Background'].inputs['Strength'].default_value=.45
scene.view_settings.view_transform='AgX';scene.view_settings.look='AgX - Medium High Contrast';scene.view_settings.exposure=.5
for position,energy,size,color in [((-9,-10,16),4300,8,(1,.82,.61)),((13,7,16),1600,12,(.76,.88,1))]:
    bpy.ops.object.light_add(type='AREA',location=K.B(position));o=bpy.context.object;o.data.energy=energy;o.data.size=size;o.data.color=color;o.rotation_euler=(-o.location).to_track_quat('-Z','Y').to_euler()
target=K.B((-1,.5,0));bpy.ops.object.camera_add(location=target+Vector((25,25,math.sqrt(1250)*math.tan(math.pi/6))));cam=bpy.context.object;cam.rotation_euler=(target-cam.location).to_track_quat('-Z','Y').to_euler();cam.data.type='ORTHO';cam.data.ortho_scale=22;scene.camera=cam
W,H=(1280,960) if a.quick else (2560,1920);scene.render.resolution_x=W;scene.render.resolution_y=H;scene.render.resolution_percentage=100;bpy.context.view_layer.update()
def screen(p):v=world_to_camera_view(scene,cam,K.B(p));return [v.x*W,(1-v.y)*H]
outputs=[]
def render(name):
    # Avoid tracing empty full-frame pixels for isolated layers; preserve full
    # output dimensions/origin so the existing sprite packer needs no special case.
    scene.render.use_border=name not in ['source-overview','ground']
    scene.render.use_crop_to_border=False
    if scene.render.use_border:
        key=name.removesuffix('-detail');points=[world_to_camera_view(scene,cam,o.matrix_world@Vector(c)) for o in groups[key] for c in o.bound_box]
        scene.render.border_min_x=max(0,min(p.x for p in points)-.012);scene.render.border_max_x=min(1,max(p.x for p in points)+.012)
        scene.render.border_min_y=max(0,min(p.y for p in points)-.012);scene.render.border_max_y=min(1,max(p.y for p in points)+.012)
    f=out/(name+'.png');scene.render.filepath=str(f);bpy.ops.render.render(write_still=True);outputs.append({'file':f.name,'bytes':f.stat().st_size,'sha256':hashlib.sha256(f.read_bytes()).hexdigest()});print('H01_EXPORT '+name,flush=True)
render('source-overview')
if not a.quick:
    bpy.ops.wm.save_as_mainfile(filepath=str(out/'hero.blend'),compress=True)
    meshes=[o for o in scene.objects if o.type=='MESH']
    for name,objects in groups.items():
        for o in meshes:o.visible_camera=o in objects
        render(name)
    scene.render.resolution_x=3840;scene.render.resolution_y=2880
    for b in R['buildings']:
        for o in meshes:o.visible_camera=o in groups[b['id']]
        render(b['id']+'-detail')
m={'version':R['version'],'studyOnly':True,'camera':{'width':W,'height':H,'scale':22,'axes':'(x,y,z)->(y,x,z)','plan':45,'elevation':30},'layers':[{'id':name,'depth':depths[name],'objects':len(objects)} for name,objects in groups.items()],'buildings':[{**b,'screenAnchor':screen(b['position'])} for b in R['buildings']],'roads':R['roads'],'sourceSha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),'kitSha256':hashlib.sha256(KIT.read_bytes()).hexdigest(),'recipeSha256':hashlib.sha256((HERE/'recipe.json').read_bytes()).hexdigest(),'blender':bpy.app.version_string,'buildHash':bpy.app.build_hash.decode(),'render':{'engine':'Cycles CPU','samples':scene.cycles.samples,'seed':R['seed'],'denoising':True,'color':'AgX Medium High Contrast +0.5 exposure'},'outputs':outputs,'elapsedSeconds':round(time.perf_counter()-start,3),'provenance':'Original H01 geometry/materials; reuses unchanged original V04 helpers. No external assets/services/spend. Release license pending.'}
(out/'source-manifest.json').write_text(json.dumps(m,indent=2)+'\n',encoding='utf8',newline='\n')
