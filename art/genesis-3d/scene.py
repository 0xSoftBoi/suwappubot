#!/usr/bin/env python3
"""Genesis Persimmon, in three dimensions.

A real persimmon — modelled, not drawn — whose skin is engine-turned amber
metal. Robinhood Chain's warm near-black is the world; Suwappu's amber is the
fruit; the single acid-lime rim is the live oracle. Path-traced in Cycles.

  python3 art/genesis-3d/scene.py   # -> render.png (fruit, transparent bg)
"""
import bpy, math, os, mathutils

HERE = os.path.dirname(os.path.abspath(__file__))

# ── palettes, from the live brands ──────────────────────────────────────────
def sRGB(hex_):
    c = [int(hex_[i:i+2], 16) / 255 for i in (1, 3, 5)]
    return [(v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4) for v in c] + [1.0]

AMBER   = sRGB("#e58d2b")
BRIGHT  = sRGB("#f6a93c")
DEEP    = sRGB("#c9731d")
DARK    = sRGB("#7a4413")
LEAFHI  = sRGB("#7ab85b")
LEAFLO  = sRGB("#2f5e34")
GROUND  = sRGB("#110e08")
LIME    = sRGB("#ccff00")
CREAM   = sRGB("#faf3e6")

# ── reset ───────────────────────────────────────────────────────────────────
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.render.engine = 'CYCLES'
scene.cycles.device = 'CPU'
scene.cycles.samples = 320
scene.cycles.blur_glossy = 0.65
scene.cycles.use_denoising = True
try: scene.cycles.denoiser = 'OPENIMAGEDENOISE'
except Exception: pass
scene.render.resolution_x = 1100
scene.render.resolution_y = 1100
scene.render.film_transparent = True
scene.view_settings.view_transform = 'Filmic'
scene.view_settings.look = 'Medium High Contrast'
scene.view_settings.exposure = -1.45

# ── the persimmon: UV sphere deformed to a fuyu ─────────────────────────────
bpy.ops.mesh.primitive_uv_sphere_add(segments=192, ring_count=128, radius=1.0)
fruit = bpy.context.active_object
fruit.name = "Persimmon"
me = fruit.data
for v in me.vertices:
    x, y, z = v.co
    lon = math.atan2(y, x)
    rad = math.hypot(x, y)
    # squat: a persimmon is wider than tall
    z *= 0.86
    # four soft vertical lobes, strongest at the equator
    lobe = 1 + 0.045 * math.cos(4 * lon) * (rad ** 1.4)
    x *= lobe; y *= lobe
    # seat the calyx: a shallow depression at the very top
    if z > 0.50:
        t = (z - 0.50) / (0.86 - 0.50)
        pull = 1 - 0.16 * (t ** 2)
        x *= pull; y *= pull
        z -= 0.10 * (t ** 2)
    # flatten the blossom end (bottom)
    if z < -0.5:
        z = -0.5 + (z + 0.5) * 0.82
    v.co = (x, y, z * 1.10)
# smooth + subsurf for a clean silhouette
for p in me.polygons:
    p.use_smooth = True
sub = fruit.modifiers.new("sub", 'SUBSURF'); sub.levels = 2; sub.render_levels = 2

# generated-coordinate decal needs the bbox square-on to the camera (down -Y)
# so the guilloché reads front-on

# ── the skin material: waxy amber metal, engine-turned (procedural) ─────────
# The guilloche is measured as the angle from the FRONT POLE (-Y, toward the
# camera): concentric rings uniform across the whole visible dome, so nothing
# piles up or smears at the silhouette the way a planar decal does.
mat = bpy.data.materials.new("Skin"); mat.use_nodes = True
nt = mat.node_tree; nt.nodes.clear()
out = nt.nodes.new("ShaderNodeOutputMaterial")
bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")

def M(op, a=None, b=None, c=None):
    import bpy as _b
    n = nt.nodes.new("ShaderNodeMath"); n.operation = op
    for i, v in enumerate((a, b, c)):
        if v is None: continue
        if isinstance(v, _b.types.NodeSocket): nt.links.new(v, n.inputs[i])
        elif hasattr(v, "outputs"): nt.links.new(v.outputs[0], n.inputs[i])
        else: n.inputs[i].default_value = float(v)
    return n

LAT_ENTRY = 0.86

# ── lon/lat from the FRONT POLE, defined by the ACTUAL camera direction ────
# A fixed axis (pure object -Y) was the earlier bug: this camera is elevated
# and tilted down at the fruit, so the point that actually faces it is well
# off the -Y axis. Verified empirically (rendering v alone as grayscale
# showed the "pole" sitting near the BOTTOM of frame, not centre, with a
# fixed -Y axis). The correct pole is the camera's own direction, decomposed
# into an orthonormal basis with mathutils and fed in as three constant
# vectors — proper spherical coordinates around the camera axis, not the
# object's arbitrary local Y.
from mathutils import Vector as _V
_cam_loc = _V((0, -7.0, 2.05))          # kept in sync with the camera below
_P = _cam_loc.normalized()               # pole: object centre -> camera
_R = _P.cross(_V((0, 0, 1))).normalized()
_U = _R.cross(_P).normalized()

tc = nt.nodes.new("ShaderNodeTexCoord")
vnorm = nt.nodes.new("ShaderNodeVectorMath"); vnorm.operation = 'NORMALIZE'
nt.links.new(tc.outputs['Object'], vnorm.inputs[0])

def dotc(vec3):
    n = nt.nodes.new("ShaderNodeVectorMath"); n.operation = 'DOT_PRODUCT'
    nt.links.new(vnorm.outputs['Vector'], n.inputs[0])
    n.inputs[1].default_value = tuple(vec3)
    return n

cosLat = dotc(_P)
lat = M('ARCCOSINE', cosLat.outputs['Value'])
az = M('ARCTAN2', dotc(_U).outputs['Value'], dotc(_R).outputs['Value'])

u = M('MULTIPLY', M('ADD', az, math.pi), 1.0 / (2 * math.pi))
# Blender's Image Texture V=0 is the BOTTOM row of the source file (OpenGL/UV
# convention), opposite of the top-to-bottom row order make_texture.py wrote
# the pole into. Flip here rather than in the generator, so the .py stays
# readable as "row 0 = pole" on disk.
v = M('SUBTRACT', 1.0, M('MULTIPLY', lat, 1.0 / math.pi))
comb = nt.nodes.new("ShaderNodeCombineXYZ")
nt.links.new(u.outputs[0], comb.inputs['X'])
nt.links.new(v.outputs[0], comb.inputs['Y'])

def imgtex(name):
    im = bpy.data.images.load(os.path.join(HERE, name))
    im.colorspace_settings.name = 'Non-Color'
    n = nt.nodes.new("ShaderNodeTexImage")
    n.image = im
    n.interpolation = 'Smart'          # mipmapped -> no shimmer
    n.extension = 'REPEAT'
    nt.links.new(comb.outputs['Vector'], n.inputs['Vector'])
    return n

height = imgtex("height.png")
crest = imgtex("crest.png")
stamp = imgtex("stamp.png")

# a gentle facing fade so grazing relief stays calm
lw = nt.nodes.new("ShaderNodeLayerWeight"); lw.inputs['Blend'].default_value = 0.30
face = M('POWER', None, 1.3)
nt.links.new(lw.outputs['Facing'], face.inputs[0])
hfade = M('MULTIPLY', M('SUBTRACT', height.outputs['Color'], 0.5), face)
hfinal = M('ADD', hfade, 0.5)

bump = nt.nodes.new("ShaderNodeBump")
bump.inputs['Strength'].default_value = 1.05
bump.inputs['Distance'].default_value = 0.02
nt.links.new(hfinal.outputs[0], bump.inputs['Height'])
nt.links.new(bump.outputs['Normal'], bsdf.inputs['Normal'])

bsdf.inputs['Base Color'].default_value = AMBER
bsdf.inputs['Roughness'].default_value = 0.50
bsdf.inputs['Metallic'].default_value = 0.36
try: bsdf.inputs['Coat Weight'].default_value = 0.12
except KeyError: pass
try:
    bsdf.inputs['Subsurface Weight'].default_value = 0.22
    bsdf.inputs['Subsurface Radius'].default_value = (0.9, 0.4, 0.15)
    bsdf.inputs['Subsurface Scale'].default_value = 0.25
except KeyError: pass

crestf = M('MULTIPLY', crest.outputs['Color'], face)
em_amber = nt.nodes.new("ShaderNodeEmission"); em_amber.inputs['Color'].default_value = BRIGHT
em_amber.inputs['Strength'].default_value = 1.3
em_stamp = nt.nodes.new("ShaderNodeEmission"); em_stamp.inputs['Color'].default_value = CREAM
em_stamp.inputs['Strength'].default_value = 3.4
mix_c = nt.nodes.new("ShaderNodeMixShader")
mix_s = nt.nodes.new("ShaderNodeMixShader")
nt.links.new(crestf.outputs[0], mix_c.inputs['Fac'])
nt.links.new(bsdf.outputs['BSDF'], mix_c.inputs[1])
nt.links.new(em_amber.outputs['Emission'], mix_c.inputs[2])
nt.links.new(stamp.outputs['Color'], mix_s.inputs['Fac'])
nt.links.new(mix_c.outputs['Shader'], mix_s.inputs[1])
nt.links.new(em_stamp.outputs['Emission'], mix_s.inputs[2])
nt.links.new(mix_s.outputs['Shader'], out.inputs['Surface'])
fruit.data.materials.append(mat)

# ── the calyx: four leaves + stem ───────────────────────────────────────────
leaf_mat = bpy.data.materials.new("Leaf"); leaf_mat.use_nodes = True
lb = leaf_mat.node_tree.nodes['Principled BSDF']
lb.inputs['Base Color'].default_value = [ (LEAFLO[j]+LEAFHI[j])/2 for j in range(4) ]
lb.inputs['Roughness'].default_value = 0.42
try: lb.inputs['Subsurface Weight'].default_value = 0.3; lb.inputs['Subsurface Radius'].default_value = (0.3,0.6,0.2)
except KeyError: pass

top = 0.86 * 1.10 - 0.10
for i in range(4):
    ang = i * (math.pi / 2) + math.pi / 4
    bpy.ops.mesh.primitive_grid_add(x_subdivisions=6, y_subdivisions=10, size=1.0)
    leaf = bpy.context.active_object
    leaf.name = f"Leaf{i}"
    lm = leaf.data
    # a broad pointed sepal that droops and cups downward at the tip
    for v in lm.vertices:
        u = (v.co.y + 0.5)              # 0 at base .. 1 at tip
        taper = 1 - 0.85 * max(0.0, u - 0.15) ** 1.3
        v.co.x *= 0.34 * taper
        v.co.y = (u - 0.5) * 0.86
        # droop: the sepal curls down over the shoulder
        v.co.z -= 0.30 * (max(0.0, u) ** 1.8)
    leaf.location = (math.cos(ang) * 0.16, math.sin(ang) * 0.16, top + 0.10)
    leaf.rotation_euler = (math.radians(18), 0, ang - math.pi/2)
    for p in lm.polygons: p.use_smooth = True
    sm = leaf.modifiers.new("s", 'SUBSURF'); sm.levels = 2
    sol = leaf.modifiers.new("t", 'SOLIDIFY'); sol.thickness = 0.010
    leaf.data.materials.append(leaf_mat)

# stem
bpy.ops.mesh.primitive_cylinder_add(vertices=20, radius=0.055, depth=0.13)
stem = bpy.context.active_object
stem.location = (0, 0, top + 0.10)
sm2 = bpy.data.materials.new("Stem"); sm2.use_nodes = True
sm2.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = sRGB("#5a3f22")
sm2.node_tree.nodes['Principled BSDF'].inputs['Roughness'].default_value = 0.8
stem.data.materials.append(sm2)

# ── world: Robinhood warm near-black ────────────────────────────────────────
world = bpy.data.worlds.new("W"); scene.world = world
world.use_nodes = True
wbg = world.node_tree.nodes['Background']
wbg.inputs['Color'].default_value = GROUND
wbg.inputs['Strength'].default_value = 0.25

# ── lighting: warm key upper-left, cool-lime rim, soft amber fill ───────────
def area(name, loc, energy, color, size, rot):
    bpy.ops.object.light_add(type='AREA', location=loc)
    L = bpy.context.active_object; L.name = name
    L.data.energy = energy; L.data.color = color[:3]; L.data.size = size
    L.rotation_euler = rot
    return L

area("Key",  (-3.4, -3.6, 3.4), 220, AMBER, 2.1, (math.radians(50), 0, math.radians(-44)))
area("Rim",  ( 3.9, -1.4, 1.9), 150, LIME,   2.4, (math.radians(72), 0, math.radians(62)))
area("Fill", ( 2.6, -3.2,-0.4), 80, DEEP,   4.5, (math.radians(96), 0, math.radians(40)))
area("Top",  ( -0.6, -1.2, 4.6), 150, CREAM, 2.8, (math.radians(8), 0, 0))

# ── a soft contact shadow, so the fruit sits rather than floats ────────────
bpy.ops.mesh.primitive_plane_add(size=14, location=(0, 0, -0.86 * 1.10 * 0.995))
ground = bpy.context.active_object
ground.is_shadow_catcher = True
gm = bpy.data.materials.new("GroundCatcher"); gm.use_nodes = True
gm.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = GROUND
gm.node_tree.nodes['Principled BSDF'].inputs['Roughness'].default_value = 0.9
ground.data.materials.append(gm)

# ── camera: front, slight elevation, portrait crop of the hero ──────────────
bpy.ops.object.camera_add(location=(0, -7.0, 2.05))
cam = bpy.context.active_object
cam.rotation_euler = (math.radians(76), 0, 0)
cam.data.lens = 100
scene.camera = cam

scene.render.filepath = os.path.join(HERE, "render.png")
scene.render.image_settings.file_format = 'PNG'
scene.render.image_settings.color_mode = 'RGBA'
bpy.ops.render.render(write_still=True)
print("rendered ->", scene.render.filepath)
