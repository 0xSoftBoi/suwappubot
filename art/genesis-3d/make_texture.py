#!/usr/bin/env python3
"""Equirectangular guilloché maps, front-pole parameterized.

Earlier attempts drove the bump/emission straight off raw Blender Math
nodes evaluating sin(lat*FREQ) per shading sample. That has no mip
filtering, so at oblique angles and at 1100px output the high-frequency
rings alias into a shimmering blur — the classic "distant venetian blinds"
problem. The fix is the standard graphics one: bake the exact same
function into a supersampled, box-filtered image, and let Blender's image
sampler (which DOES mipmap) do the anti-aliasing. Content is identical;
only the filtering changes.

Layout: column = longitude (az, -pi..pi, wraps), row = latitude from the
FRONT POLE (0 = point facing camera, pi = back). Concentric rings in this
space are exactly "vary with row" — precisely what the guilloché needs.
"""
import numpy as np
from PIL import Image
import os, math

HERE = os.path.dirname(os.path.abspath(__file__))
W, H = 2048, 1024
SS = 3                      # supersample factor, box-downsampled -> AA
FREQ, K, CURL = 40.0, 17.0, 5.0
LAT_ENTRY = 0.86            # the stamped ring, radians of latitude
STAMP_SIGMA = 0.0065        # narrow: an instrument line, not a wide band

Ws, Hs = W * SS, H * SS
row = np.linspace(0, math.pi, Hs)[:, None]         # latitude, 0..pi
col = np.linspace(-math.pi, math.pi, Ws)[None, :]  # longitude, wraps

# A pure sin() has smooth, rounded extrema everywhere by construction — no
# render setting can make that read as sharp engraving, because there is
# no sharp feature IN the source function. Real engine-turning is cut with
# a V-groove: flat-ish between cuts, a sharp transition at each groove.
# Reshape both sinusoids toward that (sign-preserving power curve) so the
# height field actually HAS crisp features for shading to catch.
def sharpen(s, k=0.6):
    return np.sign(s) * np.abs(s) ** k

sinring = sharpen(np.sin(row * FREQ))
weave2 = 0.68 + 0.32 * sharpen(np.sin(col * K + row * CURL))
weave = sinring * weave2
# Floor raised from 0.4->0.65: LAT_ENTRY=0.86rad sits inside the
# density ramp (which caps at row=1.0rad), so a low floor left even the
# stamped area looking flat. Still deepens toward the skin, just less
# drastically — the pole is no longer a bald patch.
weave = weave * (0.65 + 0.35 * np.minimum(row, 1.0))
height = 0.5 + 0.5 * weave

crest = np.clip(weave, 0, None) ** 1.5

dlat = row - LAT_ENTRY
band = np.exp(-(dlat * dlat) / (2 * STAMP_SIGMA ** 2))
# fine radial ticks on the stamp band, an instrument reading
tick_mask = (np.abs(((col / (2 * math.pi) * 72) % 1) - 0.5) < 0.10)
tick_ring = np.exp(-(dlat * dlat) / (2 * (STAMP_SIGMA * 2.6) ** 2)) * tick_mask * 0.5
stamp = np.clip(band + tick_ring, 0, 1)

def downsample(a):
    return a.reshape(H, SS, W, SS).mean(axis=(1, 3))

def save(a, name):
    a = downsample(np.clip(a, 0, 1))
    Image.fromarray((a * 255).astype(np.uint8), "L").save(os.path.join(HERE, name))

save(height, "height.png")
save(crest, "crest.png")
save(stamp, "stamp.png")
print("equirect textures ->", HERE, f"({W}x{H}, {SS}x supersampled)")
