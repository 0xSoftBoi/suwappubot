import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.collections import LineCollection
from matplotlib.colors import LinearSegmentedColormap
from matplotlib.patches import Circle
import matplotlib.font_manager as fm
from PIL import Image, ImageDraw, ImageFont

SEED = 40224
rng = np.random.default_rng(SEED)

W, H = 2400, 640
DPI = 200

# ---- 0. rasterize "SUWAPPU" letter-by-letter with explicit tracking -------
SS = 4
canvas_w, canvas_h = W * SS, H * SS
font_path = str(__import__("pathlib").Path(__file__).parent / "Outfit-Bold.ttf")
letters = list("SUWAPPU")
font_size = int(H * SS * 0.60)
font = ImageFont.truetype(font_path, font_size)

img = Image.new("L", (canvas_w, canvas_h), 0)
draw = ImageDraw.Draw(img)

tracking = font_size * 0.22
widths = []
for L in letters:
    bbox = draw.textbbox((0, 0), L, font=font)
    widths.append(bbox[2] - bbox[0])
total_w = sum(widths) + tracking * (len(letters) - 1)
start_x = (canvas_w - total_w) / 2

full_bbox = draw.textbbox((0, 0), "SUWAPPU", font=font)
th = full_bbox[3] - full_bbox[1]
ty = (canvas_h - th) / 2 - full_bbox[1]

cx = start_x
for L, w in zip(letters, widths):
    bbox = draw.textbbox((0, 0), L, font=font)
    draw.text((cx - bbox[0], ty), L, font=font, fill=255)
    cx += w + tracking

gray = np.array(img).astype(float) / 255.0

fig0 = plt.figure()
cs = plt.contour(gray, levels=[0.5])
plt.close(fig0)

paths = []
for seg_list in cs.allsegs[0]:
    if len(seg_list) < 8:
        continue
    paths.append(seg_list / SS)  # scale back down to final canvas coords

print("contour loops found:", len(paths))

# ---- resample each loop at even arc-length spacing -------------------------
SPACING = 13.5
nodes = []          # (x, y)
node_path_id = []   # which loop each node belongs to
edges = []

for pid, loop in enumerate(paths):
    d = np.diff(loop, axis=0)
    seglen = np.hypot(d[:, 0], d[:, 1])
    arclen = np.concatenate([[0], np.cumsum(seglen)])
    total = arclen[-1]
    if total < SPACING * 3:
        continue
    n_pts = max(6, int(total // SPACING))
    targets = np.linspace(0, total, n_pts, endpoint=False)
    xs = np.interp(targets, arclen, loop[:, 0])
    ys = np.interp(targets, arclen, loop[:, 1])
    base_idx = len(nodes)
    for x_, y_ in zip(xs, ys):
        nodes.append((x_, y_))
        node_path_id.append(pid)
    for k in range(n_pts):
        edges.append((base_idx + k, base_idx + (k + 1) % n_pts))

pos = np.array(nodes)
pos[:, 1] = H - pos[:, 1]
pos[:, 0] = (pos[:, 0] - W / 2) * 0.93 + W / 2
node_path_id = np.array(node_path_id)
N = len(pos)
print("nodes:", N, "edges:", len(edges))

# a few short chords within the same loop for a more networked (less
# perfectly-outlined) feel — only ever within the same path id
extra_edges = []
for pid in np.unique(node_path_id):
    idxs = np.where(node_path_id == pid)[0]
    if len(idxs) < 10:
        continue
    n_extra = max(1, len(idxs) // 9)
    for _ in range(n_extra):
        i, j = rng.choice(idxs, size=2, replace=False)
        if abs(int(i) - int(j)) > 2:
            extra_edges.append((min(int(i), int(j)), max(int(i), int(j))))
edges = list(set(edges) | set(extra_edges))

deg = np.zeros(N)
for a, b in edges:
    deg[a] += 1
    deg[b] += 1

# ================================================================= drawing
fig = plt.figure(figsize=(W / DPI, H / DPI), dpi=DPI)
ax = fig.add_axes([0, 0, 1, 1])
ax.set_xlim(0, W)
ax.set_ylim(0, H)
ax.axis("off")

bg_top = np.array([0x16, 0x0f, 0x0e]) / 255.0
bg_bot = np.array([0x08, 0x06, 0x06]) / 255.0
grad = np.linspace(0, 1, 256).reshape(-1, 1)
bg_img = grad[:, :, None] * bg_top + (1 - grad[:, :, None]) * bg_bot
ax.imshow(bg_img, extent=[0, W, 0, H], origin="lower", aspect="auto", zorder=0)

persimmon = LinearSegmentedColormap.from_list(
    "persimmon", ["#7A2E12", "#B53B17", "#F1662D", "#FFB45B", "#FFE3B0"]
)
sage = "#7AB85B"
cream = "#FFF3D6"

for gx in np.arange(0, W, 60):
    ax.plot([gx, gx], [0, H], color="#F1662D", alpha=0.028, linewidth=0.6, zorder=1)
for gy in np.arange(0, H, 60):
    ax.plot([0, W], [gy, gy], color="#F1662D", alpha=0.028, linewidth=0.6, zorder=1)

for a, b in edges:
    p0, p1 = pos[a], pos[b]
    mid = (p0 + p1) / 2
    d = p1 - p0
    dist = np.linalg.norm(d) + 1e-6
    perp = np.array([-d[1], d[0]]) / dist
    bend = rng.uniform(-0.08, 0.08) * min(dist, 40)
    ctrl = mid + perp * bend
    t = np.linspace(0, 1, 16)
    curve = ((1 - t)[:, None] ** 2) * p0 + 2 * (1 - t)[:, None] * t[:, None] * ctrl + (t[:, None] ** 2) * p1
    weight = rng.uniform(0.35, 1.0)
    color = np.array(persimmon(0.3 + 0.55 * weight))
    pts = curve.reshape(-1, 1, 2)
    segs = np.concatenate([pts[:-1], pts[1:]], axis=1)
    fade = np.sin(np.linspace(0, np.pi, len(segs))) ** 0.5
    colors = np.tile(color, (len(segs), 1))
    colors[:, 3] = (0.28 + 0.45 * weight) * fade
    widths_ = (0.6 + 1.2 * weight) * fade
    ax.add_collection(LineCollection(segs, colors=colors, linewidths=widths_, capstyle="round", zorder=2))

hub_idx = rng.choice(N, size=2, replace=False)
for hi in hub_idx:
    cx_, cy_ = pos[hi]
    for ring_r in [rng.uniform(24, 30), rng.uniform(38, 46)]:
        theta = np.linspace(0, 2 * np.pi, 100)
        ax.plot(cx_ + ring_r * np.cos(theta), cy_ + ring_r * np.sin(theta) * 0.6,
                 color=sage, alpha=0.20, linewidth=0.7, linestyle=(0, (1, 3)), zorder=2)
        a0 = rng.uniform(0, 2 * np.pi)
        ppx, ppy = cx_ + ring_r * np.cos(a0), cy_ + ring_r * np.sin(a0) * 0.6
        ax.add_patch(Circle((ppx, ppy), 2.6, color=sage, alpha=0.9, zorder=4, linewidth=0))
        ax.add_patch(Circle((ppx, ppy), 7, color=sage, alpha=0.2, zorder=3, linewidth=0))

for i in range(N):
    cx_, cy_ = pos[i]
    strength = 0.5 + 0.5 * min(deg[i] / 3.0, 1.0)
    r = 2.1 + 1.6 * strength
    is_hub = i in hub_idx
    core = cream if is_hub else persimmon(0.62 + 0.22 * strength)
    glow = "#FFB45B" if is_hub else persimmon(0.42 + 0.28 * strength)
    for mult, a in [(5.0, 0.05), (3.0, 0.10), (1.7, 0.20)]:
        ax.add_patch(Circle((cx_, cy_), r * mult, color=glow, alpha=a * strength, linewidth=0, zorder=3))
    ax.add_patch(Circle((cx_, cy_), r, color=core, alpha=0.95, linewidth=0, zorder=5))

mono = fm.FontProperties(family="monospace")
hex_chars = "0123456789abcdef"
def rand_hex(n):
    return "0x" + "".join(rng.choice(list(hex_chars)) for _ in range(n))
selectors = ["swapExactTokensForTokens(", "execute(bytes32,", "quote(uint256)->",
             "route[best_of_9]", "settle(address,uint256)", "0x38ed1739",
             "CCTP.burn(", "MEV_PROTECT=true", "slippage<=50bps", "bridge(chainId=8453)",
             "F(x,y)=argmin(fee+slip)", "dP/dt=liquidity_flow"]

word_top = pos[:, 1].max()
word_bot = pos[:, 1].min()
bands = [(word_top + 10, H - 8), (8, word_bot - 10)]
placed = 0
attempts = 0
while placed < 14 and attempts < 500:
    attempts += 1
    band = bands[0] if rng.random() < 0.5 else bands[1]
    if band[1] - band[0] < 16:
        continue
    tx_, ty_ = rng.uniform(20, W - 260), rng.uniform(band[0] + 4, band[1] - 4)
    txt = rng.choice(selectors) if rng.random() < 0.55 else rand_hex(rng.integers(6, 14))
    ax.text(tx_, ty_, txt, fontproperties=mono, fontsize=rng.uniform(7.5, 9.5),
            color=cream, alpha=rng.uniform(0.06, 0.11), rotation=rng.uniform(-2, 2),
            zorder=1, ha="left", va="center")
    placed += 1

fig.savefig("/home/user/suwappubot/docs/assets/banner/route-field.png", dpi=DPI, facecolor=bg_bot)
print("saved,", len(edges), "edges,", placed, "labels, word_top/bot", word_top, word_bot)
# Regenerate: pip install numpy matplotlib pillow && python3 docs/assets/banner/generate.py
# Deterministic given SEED — same seed always produces the same image.
# Font: Outfit-Bold.ttf (bundled in this dir, OFL-licensed — see Outfit-OFL.txt).
