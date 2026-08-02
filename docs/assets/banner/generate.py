import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.collections import LineCollection
from matplotlib.colors import LinearSegmentedColormap
from matplotlib.patches import Circle
import matplotlib.font_manager as fm

SEED = 40224
rng = np.random.default_rng(SEED)

W, H = 2400, 640
DPI = 200

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

# ---- 1. math grid -----------------------------------------------------------
for gx in np.arange(0, W, 60):
    ax.plot([gx, gx], [0, H], color="#F1662D", alpha=0.028, linewidth=0.6, zorder=1)
for gy in np.arange(0, H, 60):
    ax.plot([0, W], [gy, gy], color="#F1662D", alpha=0.028, linewidth=0.6, zorder=1)

# ---- 2. node layout: bin-anchored x (guarantees full-width spread), free y -
N = 22
n_cols = 11
n_rows = 2
xs, ys = [], []
for c in range(n_cols):
    for r in range(n_rows):
        if len(xs) >= N:
            break
        col_w = W / n_cols
        bx = col_w * (c + 0.5) + rng.uniform(-col_w * 0.32, col_w * 0.32)
        by = H * (0.28 if r == 0 else 0.72) + rng.uniform(-H * 0.16, H * 0.16)
        xs.append(bx)
        ys.append(by)
pos = np.column_stack([xs, ys])
anchor_x = pos[:, 0].copy()

# edges: connect mostly-neighboring columns so routes read left-to-right
edges = set()
order = np.argsort(pos[:, 0])
for rank, i in enumerate(order):
    k = rng.integers(1, 3)
    window = order[max(0, rank - 4): rank + 5]
    d = np.linalg.norm(pos[window] - pos[i], axis=1)
    idx_sorted = window[np.argsort(d)]
    idx_sorted = idx_sorted[idx_sorted != i]
    for j in idx_sorted[:k]:
        a, b = min(i, int(j)), max(i, int(j))
        if a != b:
            edges.add((a, b))
edges = list(edges)

# light relaxation: repel all, spring on edges, gentle pull back to x-anchor
for _ in range(90):
    disp = np.zeros_like(pos)
    diff = pos[:, None, :] - pos[None, :, :]
    dist = np.linalg.norm(diff, axis=2) + 1e-6
    rep = (diff / dist[:, :, None] ** 3) * 3.0e6
    disp += rep.sum(axis=1)
    for a, b in edges:
        d = pos[b] - pos[a]
        dist_ab = np.linalg.norm(d) + 1e-6
        f = (dist_ab - 210) * 0.02
        disp[a] += f * d / dist_ab
        disp[b] -= f * d / dist_ab
    disp[:, 0] += (anchor_x - pos[:, 0]) * 0.06
    pos += np.clip(disp, -6, 6)
    pos[:, 0] = np.clip(pos[:, 0], W * 0.03, W * 0.97)
    pos[:, 1] = np.clip(pos[:, 1], H * 0.10, H * 0.90)

deg = np.zeros(N)
for a, b in edges:
    deg[a] += 1
    deg[b] += 1

# ---- 3. edges as smooth curved routes --------------------------------------
for a, b in edges:
    p0, p1 = pos[a], pos[b]
    mid = (p0 + p1) / 2
    perp = np.array([-(p1 - p0)[1], (p1 - p0)[0]])
    perp = perp / (np.linalg.norm(perp) + 1e-6)
    bend = rng.uniform(-0.16, 0.16) * np.linalg.norm(p1 - p0)
    ctrl = mid + perp * bend
    t = np.linspace(0, 1, 60)
    curve = ((1 - t)[:, None] ** 2) * p0 + 2 * (1 - t)[:, None] * t[:, None] * ctrl + (t[:, None] ** 2) * p1

    weight = rng.uniform(0.25, 1.0)
    color = np.array(persimmon(0.25 + 0.6 * weight))
    pts = curve.reshape(-1, 1, 2)
    segs = np.concatenate([pts[:-1], pts[1:]], axis=1)
    fade = np.sin(np.linspace(0, np.pi, len(segs))) ** 0.5
    colors = np.tile(color, (len(segs), 1))
    colors[:, 3] = (0.12 + 0.4 * weight) * fade
    widths = (0.5 + 2.0 * weight) * fade
    ax.add_collection(LineCollection(segs, colors=colors, linewidths=widths,
                                      capstyle="round", zorder=2))

# ---- 4. orbit rings around the two biggest hubs ----------------------------
hub_idx = np.argsort(deg)[-2:]
for hi in hub_idx:
    cx, cy = pos[hi]
    for ring_r in [rng.uniform(40, 54), rng.uniform(64, 82)]:
        theta = np.linspace(0, 2 * np.pi, 120)
        ax.plot(cx + ring_r * np.cos(theta), cy + ring_r * np.sin(theta) * 0.55,
                 color=sage, alpha=0.16, linewidth=0.7, linestyle=(0, (1, 3)), zorder=2)
        a0 = rng.uniform(0, 2 * np.pi)
        px, py = cx + ring_r * np.cos(a0), cy + ring_r * np.sin(a0) * 0.55
        ax.add_patch(Circle((px, py), 3.2, color=sage, alpha=0.85, zorder=4, linewidth=0))
        ax.add_patch(Circle((px, py), 8.5, color=sage, alpha=0.18, zorder=3, linewidth=0))

# ---- 5. nodes with glow -----------------------------------------------------
for i in range(N):
    cx, cy = pos[i]
    strength = 0.35 + 0.65 * (deg[i] / max(deg.max(), 1))
    r = 3.6 + 5.2 * strength
    is_hub = i in hub_idx
    core = cream if is_hub else persimmon(0.55 + 0.3 * strength)
    glow = "#FFB45B" if is_hub else persimmon(0.35 + 0.3 * strength)
    for mult, a in [(6.0, 0.045), (3.6, 0.09), (1.9, 0.18)]:
        ax.add_patch(Circle((cx, cy), r * mult, color=glow, alpha=a * strength, linewidth=0, zorder=3))
    ax.add_patch(Circle((cx, cy), r, color=core, alpha=0.95, linewidth=0, zorder=5))
    ax.add_patch(Circle((cx, cy), r, facecolor="none", edgecolor="#120F12", alpha=0.6, linewidth=1.0, zorder=6))

# ---- 6. code/contract texture, placed AFTER nodes are known, avoiding them -
mono = fm.FontProperties(family="monospace")
hex_chars = "0123456789abcdef"
def rand_hex(n):
    return "0x" + "".join(rng.choice(list(hex_chars)) for _ in range(n))
selectors = ["swapExactTokensForTokens(", "execute(bytes32,", "quote(uint256)->",
             "route[best_of_9]", "settle(address,uint256)", "0x38ed1739",
             "CCTP.burn(", "MEV_PROTECT=true", "slippage<=50bps", "bridge(chainId=8453)",
             "F(x,y)=argmin(fee+slip)", "dP/dt=liquidity_flow"]

placed = 0
attempts = 0
min_node_dist = 70
while placed < 20 and attempts < 400:
    attempts += 1
    tx, ty = rng.uniform(20, W - 260), rng.uniform(20, H - 20)
    if np.min(np.linalg.norm(pos - np.array([tx, ty]), axis=1)) < min_node_dist:
        continue
    txt = rng.choice(selectors) if rng.random() < 0.55 else rand_hex(rng.integers(6, 14))
    ax.text(tx, ty, txt, fontproperties=mono, fontsize=rng.uniform(7.5, 10),
            color=cream, alpha=rng.uniform(0.06, 0.12), rotation=rng.uniform(-3, 3),
            zorder=1, ha="left", va="center")
    placed += 1

fig.savefig("/home/user/suwappubot/docs/assets/banner/route-field.png", dpi=DPI, facecolor=bg_bot)
print("saved, placed", placed, "text labels,", len(edges), "edges")
# Regenerate: pip install numpy matplotlib && python3 docs/assets/banner/generate.py
# Deterministic given SEED — same seed always produces the same image.
