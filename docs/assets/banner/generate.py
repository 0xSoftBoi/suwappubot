import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.collections import LineCollection
from matplotlib.colors import LinearSegmentedColormap
from matplotlib.patches import Circle

# --- "Route Field": cross-chain settlement as harmonic superposition -------
# A handful of dominant streams (2-3 sine harmonics each, seeded) carry the
# eye left to right; a faint atmosphere of thinner streams fills the rest.
# Node glows mark where a stream's local curvature peaks — a route settling.

SEED = 40224
rng = np.random.default_rng(SEED)

W, H = 2400, 640
DPI = 200

fig = plt.figure(figsize=(W / DPI, H / DPI), dpi=DPI)
ax = fig.add_axes([0, 0, 1, 1])
ax.set_xlim(0, W)
ax.set_ylim(0, H)
ax.axis("off")

bg_top = np.array([0x18, 0x10, 0x0f]) / 255.0
bg_bot = np.array([0x0a, 0x07, 0x07]) / 255.0
grad = np.linspace(0, 1, 256).reshape(-1, 1)
bg_img = grad[:, :, None] * bg_top + (1 - grad[:, :, None]) * bg_bot
ax.imshow(bg_img, extent=[0, W, 0, H], origin="lower", aspect="auto", zorder=0)

route_cmap = LinearSegmentedColormap.from_list(
    "persimmon", ["#7A2E12", "#B53B17", "#F1662D", "#FFB45B", "#FFE3B0"]
)
sage = "#7AB85B"
x = np.linspace(0, W, 700)


def make_stream(base_y, amp1, amp2, f1, f2, phase1, phase2, drift):
    y = (
        base_y
        + amp1 * np.sin(f1 * x + phase1)
        + amp2 * np.sin(f2 * x + phase2)
        + drift * (x / W)
    )
    return y


def draw_stream(y, color_t, lw_peak, alpha_peak, glow=False):
    dy = np.gradient(y, x)
    speed = np.abs(dy)
    speed_n = (speed - speed.min()) / (np.ptp(speed) + 1e-9)
    # ease toward the ends so streams fade in/out rather than hard-clip
    edge = np.clip(np.minimum(x / (W * 0.12), (W - x) / (W * 0.12)), 0, 1)
    edge = edge ** 0.6

    pts = np.array([x, y]).T.reshape(-1, 1, 2)
    segs = np.concatenate([pts[:-1], pts[1:]], axis=1)

    base_rgba = np.array(route_cmap(color_t))
    colors = np.tile(base_rgba, (len(segs), 1))
    colors[:, 3] = alpha_peak * (0.25 + 0.85 * speed_n[:-1]) * edge[:-1]
    widths = lw_peak * (0.55 + 0.85 * speed_n[:-1])

    lc = LineCollection(segs, colors=colors, linewidths=widths,
                         capstyle="round", joinstyle="round", zorder=2)
    ax.add_collection(lc)

    if glow:
        glow_colors = colors.copy()
        glow_colors[:, 3] *= 0.35
        lc_glow = LineCollection(segs, colors=glow_colors, linewidths=widths * 3.2,
                                  capstyle="round", joinstyle="round", zorder=1)
        ax.add_collection(lc_glow)
    return y, speed_n, edge


peaks = []

# Atmosphere layer: many thin, quiet streams filling the space
for i in range(34):
    base_y = rng.uniform(H * 0.05, H * 0.95)
    amp1 = rng.uniform(10, 46)
    amp2 = amp1 * rng.uniform(0.2, 0.45)
    f1 = rng.uniform(0.7, 2.2) * (2 * np.pi / W)
    f2 = f1 * rng.uniform(1.8, 2.6)
    y = make_stream(base_y, amp1, amp2, f1, f2,
                     rng.uniform(0, 2 * np.pi), rng.uniform(0, 2 * np.pi),
                     rng.uniform(-0.08, 0.08) * H)
    draw_stream(y, rng.uniform(0.05, 0.55), lw_peak=rng.uniform(0.5, 1.0),
                alpha_peak=rng.uniform(0.06, 0.13))

# Hero layer: a few bold, glowing streams that carry the composition
hero_bases = np.linspace(H * 0.22, H * 0.78, 6) + rng.uniform(-20, 20, 6)
for i, base_y in enumerate(hero_bases):
    amp1 = rng.uniform(40, 90)
    amp2 = amp1 * rng.uniform(0.25, 0.4)
    f1 = rng.uniform(0.9, 1.6) * (2 * np.pi / W)
    f2 = f1 * rng.uniform(1.9, 2.3)
    phase1 = rng.uniform(0, 2 * np.pi)
    phase2 = rng.uniform(0, 2 * np.pi)
    drift = rng.uniform(-0.06, 0.10) * H
    y = make_stream(base_y, amp1, amp2, f1, f2, phase1, phase2, drift)
    color_t = 0.35 + 0.55 * (i / (len(hero_bases) - 1))
    y_out, speed_n, edge = draw_stream(y, color_t, lw_peak=2.6, alpha_peak=0.85, glow=True)

    # settlement node near this stream's strongest curvature, away from edges
    core = 700 * 0.5
    window = slice(int(len(x) * 0.2), int(len(x) * 0.8))
    local_idx = window.start + int(np.argmax(speed_n[window]))
    if rng.random() < 0.85:
        peaks.append((x[local_idx], y[local_idx], 0.7 + 0.3 * rng.random(),
                      sage if rng.random() < 0.18 else "#FFE3B0"))

for px, py, strength, core in peaks:
    glow = sage if core == sage else "#F1662D"
    r = 3.4 * strength
    for mult, a in [(6.5, 0.045), (4.0, 0.09), (2.0, 0.18)]:
        ax.add_patch(Circle((px, py), r * mult, color=glow, alpha=a * strength, linewidth=0, zorder=3))
    ax.add_patch(Circle((px, py), r, color=core, alpha=0.9, linewidth=0, zorder=4))

# soft vignette for depth
vx, vy = np.meshgrid(np.linspace(-1, 1, 60), np.linspace(-1, 1, 24))
vign = 1 - np.clip(1.15 - np.sqrt(vx**2 + vy**2 * 2.2), 0, 1)
ax.imshow(np.dstack([np.zeros_like(vign)] * 3 + [vign * 0.55]),
          extent=[0, W, 0, H], origin="lower", aspect="auto", zorder=5)

fig.savefig("/home/user/suwappubot/docs/assets/banner/route-field.png", dpi=DPI, facecolor=bg_bot)
print("saved")
# Regenerate: pip install numpy matplotlib && python3 docs/assets/banner/generate.py
# Deterministic given SEED — same seed always produces the same image.
