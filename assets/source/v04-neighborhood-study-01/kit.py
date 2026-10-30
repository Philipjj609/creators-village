"""Small original module kit, derived from retained V03 source; V03 unmodified.
Shared wall/foundation/opening/roof/porch/gallery and purpose-specific skeletons.
No universal generator or external asset input. Release license pending owner.
"""
import math, random
import bpy, bmesh
from mathutils import Vector
RNG=random.Random(609)
ROLE="architecture"
V03_SOURCE_SHA256="8de9cca9368122b8193fa14ade5631aba7c2c7834162eb35c4cd3c81207132eb"

def B(p):
    return Vector((p[1], p[0], p[2]))


def linear(hexcolor):
    c = [int(hexcolor[i:i+2], 16) / 255 for i in (0, 2, 4)]
    return tuple(v / 12.92 if v < .04045 else ((v + .055) / 1.055) ** 2.4 for v in c)


def material(name, color, rough=.8, grain=.03):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nodes, links = m.node_tree.nodes, m.node_tree.links
    bs = nodes.get("Principled BSDF")
    bs.inputs["Base Color"].default_value = (*linear(color), 1)
    bs.inputs["Roughness"].default_value = rough
    if grain:
        noise = nodes.new("ShaderNodeTexNoise")
        noise.inputs["Scale"].default_value = 5
        noise.inputs["Detail"].default_value = 2
        geom = nodes.new("ShaderNodeNewGeometry")
        links.new(geom.outputs["Position"], noise.inputs["Vector"])
        ramp = nodes.new("ShaderNodeValToRGB")
        base = linear(color)
        ramp.color_ramp.elements[0].position = .18
        ramp.color_ramp.elements[0].color = (*(v*.86 for v in base), 1)
        ramp.color_ramp.elements[1].position = .82
        ramp.color_ramp.elements[1].color = (*(min(1,v*1.08) for v in base), 1)
        links.new(noise.outputs["Fac"], ramp.inputs["Fac"])
        links.new(ramp.outputs["Color"], bs.inputs["Base Color"])
        bump = nodes.new("ShaderNodeBump")
        bump.inputs["Strength"].default_value = .22
        bump.inputs["Distance"].default_value = grain
        links.new(noise.outputs["Fac"], bump.inputs["Height"])
        links.new(bump.outputs["Normal"], bs.inputs["Normal"])
    return m


def tag(obj, name, mat=None, bevel=0):
    obj.name = name
    obj["studyRole"] = ROLE
    if mat:
        obj.data.materials.append(mat)
    if bevel:
        mod = obj.modifiers.new("Crafted edge", "BEVEL")
        mod.width, mod.segments = bevel, 2
        normals = obj.modifiers.new("Face normals", "WEIGHTED_NORMAL")
        normals.keep_sharp = True
    return obj


def box(name, p, size, mat, bevel=.04):
    bpy.ops.mesh.primitive_cube_add(size=1, location=B(p))
    o = bpy.context.object
    o.dimensions = (size[1], size[0], size[2])
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    return tag(o, name, mat, bevel)


def mesh(name, vertices, faces, mat, bevel=0):
    data = bpy.data.meshes.new(name)
    data.from_pydata([B(v) for v in vertices], [], faces)
    bm = bmesh.new()
    bm.from_mesh(data)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(data)
    bm.free()
    o = bpy.data.objects.new(name, data)
    bpy.context.collection.objects.link(o)
    return tag(o, name, mat, bevel)


def beam(name, a, b, width, mat, depth=None):
    mid = (B(a) + B(b)) / 2
    delta = B(b) - B(a)
    bpy.ops.mesh.primitive_cube_add(size=1, location=mid)
    o = bpy.context.object
    o.dimensions = (width, depth or width, delta.length)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    o.rotation_euler = delta.to_track_quat("Z", "Y").to_euler()
    return tag(o, name, mat, .025)


def cylinder(name, a, b, radius, mat, vertices=12):
    delta = B(b) - B(a)
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices, radius=radius, depth=delta.length, location=(B(a)+B(b))/2)
    o = bpy.context.object
    o.rotation_euler = delta.to_track_quat("Z", "Y").to_euler()
    return tag(o, name, mat, .018)


def slab(name, corners, mat, thickness=.08, bevel=.015):
    verts = corners + [(x, y, z-thickness) for x, y, z in corners]
    n = len(corners)
    faces = [tuple(range(n)), tuple(range(n, n*2))]
    faces += [(i, (i+1) % n, (i+1) % n+n, i+n) for i in range(n)]
    return mesh(name, verts, faces, mat, bevel)


def gable(cx, cy, width, depth, eave, rise, axis="Y", tiled=True):
    def p(x, y, z):
        return (cx+x, cy+y, z) if axis == "Y" else (cx+y, cy+x, z)
    w, d = width/2, depth/2
    # Solid attic: front/back gables are plaster, separate roof skin above.
    v = [p(-w,-d,eave-.10),p(w,-d,eave-.10),p(0,-d,eave+rise-.1),p(-w,d,eave-.1),p(w,d,eave-.1),p(0,d,eave+rise-.1)]
    mesh("plaster gable", v, [(0,1,2),(3,4,5),(0,3,5,2),(1,4,5,2),(0,1,4,3)], M["plaster"])
    w += .28
    d += .25
    for sign in [-1, 1]:
        corners = [p(sign*w,-d,eave),p(sign*w,d,eave),p(0,d,eave+rise),p(0,-d,eave+rise)]
        slab("thick roof plane", corners, M["roof"], .12, .035)
        if tiled:
            rows, cols = 7, max(7, round(depth*3))
            for r in range(rows):
                t0, t1 = r/rows, min(1,(r+1.16)/rows)
                for c in range(cols):
                    y0 = -d + (2*d)*(c/cols)
                    y1 = -d + (2*d)*((c+.96)/cols)
                    # Each overlapping tile is geometry, not a pasted texture.
                    verts = [p(sign*w*(1-t0),y0,eave+rise*t0+.045),p(sign*w*(1-t0),y1,eave+rise*t0+.045),p(sign*w*(1-t1),y1,eave+rise*t1+.045),p(sign*w*(1-t1),y0,eave+rise*t1+.045)]
                    slab("individual clay tile", verts, RNG.choice(ROOFS), .035, .011)
        beam("eave fascia", p(sign*w,-d,eave-.04),p(sign*w,d,eave-.04), .13, M["wood"])
        for y in [-d, d]:
            beam("gable verge",p(sign*w,y,eave+.04),p(0,y,eave+rise+.04),.12,M["wood"])
    for i in range(max(5,round(depth*3))):
        n=max(5,round(depth*3))
        cylinder("clay ridge cap",p(0,-d+2*d*i/n,eave+rise+.08),p(0,-d+2*d*(i+.95)/n,eave+rise+.08),.105,M["roof"])


def hip(cx, cy, width, depth, eave, rise, mat):
    w,d=width/2,depth/2
    ridge=max(.05,w-d)
    v=[(cx-w,cy-d,eave),(cx+w,cy-d,eave),(cx+w,cy+d,eave),(cx-w,cy+d,eave),(cx-ridge,cy,eave+rise),(cx+ridge,cy,eave+rise)]
    faces=[(0,1,5,4),(1,2,5),(2,3,4,5),(3,0,4)]
    for f in faces:
        slab("hip roof panel",[v[i] for i in f],mat,.13,.035)
    # Raised standing seams follow the actual hip topology, not a gable overlay.
    for a,b in [(0,4),(3,4),(1,5),(2,5),(4,5)]:
        beam("hip seam",v[a],v[b],.08,M["metal"])
    for side in [-1,1]:
        for i in range(18):
            x=-w+(i+.5)*2*w/18
            stop=max(0,1-max(0,abs(x)-ridge)/d)
            end_y=side*d*(1-stop)
            beam("slate roof rib",(cx+x,cy+side*d,eave+.035),(cx+x,cy+end_y,eave+rise*stop+.035),.032,mat)
    for i in range(4):
        beam("hip fascia",v[i],v[(i+1)%4],.14,M["wood"])


def base(cx,cy,w,d,h):
    box("stone foundation",(cx,cy,.25),(w+.20,d+.20,.5),M["stone"],.1)
    box("mineral plaster wall",(cx,cy,.45+h/2),(w,d,h),M["plaster"],.045)
    # Structural corner posts, sill and frame lines are consistent across family.
    for x in [-w/2,w/2]:
        for y in [-d/2,d/2]:
            beam("corner timber",(cx+x,cy+y,.45),(cx+x,cy+y,.45+h),.15,M["wood"])
    for z in [.55,.45+h]:
        for y in [-d/2,d/2]:
            box("wall rail",(cx,cy+y,z),(w+.12,.13,.12),M["wood"],.02)
    for i in range(max(3,round(w*2))):
        box("foundation course",(cx-w/2+(i+.5)*w/max(3,round(w*2)),cy+d/2+.05,.25),(w/max(3,round(w*2))-.035,.18,.24),RNG.choice(STONES),.025)


def door(cx,y,width=1.0,height=1.8,double=False):
    # Layered recess and jambs give opening depth without fragile booleans.
    box("dark door recess",(cx,y,.48+height/2),(width+.26,.12,height+.12),M["dark"],.1)
    count=8 if double else 5
    for i in range(count):
        box("door timber plank",(cx-width/2+(i+.5)*width/count,y+.075,.48+height/2),(width/count-.015,.07,height-.08),M["door"],.025)
    for x in [cx-width/2-.12,cx+width/2+.12]:
        box("stone door jamb",(x,y+.13,.48+height/2),(.19,.23,height+.18),M["stone"],.04)
    box("door lintel",(cx,y+.13,.57+height),(width+.5,.27,.22),M["wood"],.045)
    for z in [.85,1.65]:
        box("iron door strap",(cx,y+.13,z),(width*.86,.035,.065),M["metal"],.015)
    cylinder("door handle",(cx+.19,y+.15,1.28),(cx+.19,y+.23,1.28),.045,M["brass"])
    box("threshold",(cx,y+.25,.48),(width+.6,.55,.18),M["stone"],.055)


def window(cx,y,z,w=.8,h=.95):
    box("deep window recess",(cx,y,z),(w+.22,.14,h+.22),M["dark"],.075)
    box("warm glazing",(cx,y+.08,z),(w,.035,h),M["glass"],.025)
    for x in [-w/2,w/2]:
        box("window upright",(cx+x,y+.15,z),(.075,.16,h+.15),M["wood"],.02)
    for zz in [-h/2,h/2]:
        box("window cross frame",(cx,y+.15,z+zz),(w+.15,.16,.08),M["wood"],.02)
    box("window mullion",(cx,y+.16,z),(.045,.12,h),M["wood"],.01)
    box("window sill",(cx,y+.20,z-h/2-.08),(w+.36,.4,.13),M["stone"],.045)


def side_window(x,y,z,w=.8,h=.95):
    before=set(bpy.context.scene.objects)
    window(y,x,z,w,h)
    for obj in set(bpy.context.scene.objects)-before:
        obj.location.x,obj.location.y=obj.location.y,obj.location.x
        obj.rotation_euler.z += math.pi/2


def rock(p,scale,mat):
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=2,radius=1,location=B(p))
    o=bpy.context.object
    o.scale=(scale[1],scale[0],scale[2])
    for v in o.data.vertices:
        v.co*=RNG.uniform(.89,1.09)
    return tag(o,"weathered bank stone",mat)


def shrub(x,y,z=.18,size=.45):
    for i in range(4):
        p=(x+RNG.uniform(-size*.5,size*.5),y+RNG.uniform(-size*.5,size*.5),z+size*.5+RNG.uniform(0,size*.3))
        rock(p,(size*.65,size*.6,size*.6),RNG.choice(GREENS))


def tree(x,y,height=4):
    cylinder("tree trunk",(x,y,.02),(x+.12,y,height*.57),.14,M["bark"],9)
    for angle in [0,2.1,4.2]:
        tip=(x+math.cos(angle)*.8,y+math.sin(angle)*.8,height*.69)
        cylinder("tree branch",(x,y,height*.40),tip,.08,M["bark"],8)
    for i in range(9):
        angle=i*2.4
        r=.9*math.sqrt(i/9)
        rock((x+math.cos(angle)*r,y+math.sin(angle)*r,height*.63+RNG.uniform(-.2,.65)),(1.12,1.02,1.05),RNG.choice(GREENS))


def bench(x,y):
    global ROLE
    for dx in [-.65,.65]:
        box("bench stone foot",(x+dx,y,.28),(.25,.48,.48),M["stone"],.05)
    for dy in [-.15,.12]:
        box("bench seat plank",(x,y+dy,.57),(1.7,.23,.13),M["wood"],.035)
    box("bench back",(x,y-.22,.9),(1.7,.12,.42),M["wood"],.035)


def workshop(recipe):
    base(-1,0,4.6,2.8,2.3)
    gable(-1,0,2.8,4.6,2.75,1.25,axis="X")
    base(2.0,1.05,2.1,4.0,1.95)
    gable(2.0,1.05,2.1,4.0,2.4,1.05)
    door(-1.1,1.48,1.8,1.9,True)
    window(2,3.13,1.65,1.05,.85)
    side_window(3.12,.65,1.6,1.05,.75)
    for y in [-.55,1.7,2.75]:
        beam("workshop return stud",(3.08,y,.55),(3.08,y,2.35),.12,M["wood"])
    beam("workshop return diagonal",(3.1,1.75,.6),(3.1,2.7,1.9),.12,M["wood"])
    slab("workyard canopy",[(-3.1,1.3,2.5),(.65,1.3,2.5),(.65,3.05,2.05),(-3.1,3.05,2.05)],M["slate"],.12,.025)
    for x in [-3,.52]:
        beam("yard canopy post",(x,2.92,.12),(x,2.92,2.1),.16,M["wood"])
    beam("canopy front tie",(-3,2.92,2.06),(.52,2.92,2.06),.16,M["wood"])
    # Purpose visible through form and functional tools/materials, not text labels.
    global ROLE
    ROLE="props"
    box("workbench top",(-1.9,2.35,.94),(1.65,.65,.15),M["wood"],.045)
    for x in [-2.5,-1.3]:
        box("workbench leg",(x,2.35,.5),(.12,.45,.85),M["wood"],.02)
    for i in range(5):
        cylinder("stacked timber",(3.6,-.8+i*.24,.3),(3.6,1.1+i*.24,.3),.12,M["wood"],9)
    for j in range(3):
        box("stored boards",(-3.6,-.3+j*.23,.4+j*.09),(.28,2.4,.15),M["door"],.02)
    box("tool tray",(-1.9,2.35,1.07),(.65,.32,.14),M["dark"],.025)
    ROLE="architecture"


def hall(recipe):
    w,d,h=recipe["body"]
    base(-.4,0,w,d,h)
    hip(-.4,0,w+.6,d+.6,h+.45,recipe["roofRise"],M["slate"])
    door(-.4,2.08,1.65,2.15,True)
    for x in [-2.55,1.75]:
        window(x,2.08,1.85,1.05,1.2)
    # Public gallery is a different spatial module from domestic porch/work canopy.
    slab("civic gallery roof",[(2.8,-2.1,2.85),(4.5,-2.1,2.35),(4.5,2.65,2.35),(2.8,2.65,2.85)],M["roof"],.16,.035)
    box("raised gallery platform",(3.7,.2,.26),(2.0,4.9,.34),M["stone"],.07)
    for y in [-1.7,-.35,1,2.35]:
        beam("public gallery column",(4.22,y,.35),(4.22,y,2.4),.18,M["wood"])
        beam("gallery knee brace",(4.22,y,1.95),(3.85,y,2.5),.11,M["wood"])
    # Open lantern above roof; no church imagery or borrowed emblem.
    box("lantern base",(-.7,0,4.78),(1.42,1.25,.22),M["wood"],.04)
    for x in [-1.25,-.15]:
        for y in [-.46,.46]:
            beam("lantern upright",(x,y,4.75),(x,y,5.6),.12,M["wood"])
    box("lantern warm interior",(-.7,0,5.14),(.83,.72,.62),M["glass"],.04)
    hip(-.7,0,1.75,1.55,5.62,.55,M["roof"])
    cylinder("lantern finial",(-.7,0,6.15),(-.7,0,6.47),.055,M["brass"])
    for i in range(3):
        box("public entry step",(-.4,2.5+i*.3,.38-i*.1),(2.6,.48,.16),M["stone"],.045)
    for x in [-3,2.2]:
        beam("civic banner pole",(x,2.24,1.1),(x,2.24,2.75),.06,M["brass"])
        box("plain civic cloth",(x+.2,2.25,2.25),(.42,.045,.68),M["sage"],.025)


def init_materials():
    global M,ROOFS,STONES,GREENS
    M={name:material(name,c,grain=g) for name,c,g in [
        ("plaster","D9C9A8",.035),("wood","694933",.025),("door","A2764B",.02),
        ("stone","A7A38A",.05),("roof","B96F50",.03),("slate","4E6B68",.02),
        ("dark","302F29",0),("glass","E0AE59",.01),("metal","454A44",.01),
        ("brass","A88C4A",.01),("sage","617D70",.02),("soil","76634D",.06),
        ("grass","788B5D",.05),("path","BDAA80",.04),("bark","65503A",.035)]}
    ROOFS=[material("clay-%s"%i,c,grain=.025) for i,c in enumerate(["AD654B","BD7958","C18361","AE7155","B57757"])]
    STONES=[material("stone-%s"%i,c,grain=.04) for i,c in enumerate(["A7A38A","B8AE94","999E8A","B3AD9B"])]
    GREENS=[material("leaf-%s"%i,c,grain=.035) for i,c in enumerate(["647B4D","7D925C","8C9F69","566E48"])]
