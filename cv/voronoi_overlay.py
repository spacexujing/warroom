#!/usr/bin/env python3
"""Voronoi 分区图 —— 叠加友好版（带 alpha 通道）
- 复用 /tmp/voronoi_labels.npy（每像素归属的种子索引），不必重算
- 输出 web/public/voronoi_overlay.png：RGBA
    · 区域填充：低透明度彩色（便于透出底图）
    · 区域边界：较不透明的深色描边
    · 中心点：白色小点
用法: .venv/bin/python cv/voronoi_overlay.py [fill_alpha] [line_alpha]
"""
import cv2, numpy as np, json, sys, os

FILL_ALPHA = int(sys.argv[1]) if len(sys.argv) > 1 else 70    # 0..255
LINE_ALPHA = int(sys.argv[2]) if len(sys.argv) > 2 else 200

LABELS = "/tmp/voronoi_labels.npy"
POS    = "/home/ubuntu/warroom/extracted/territory_positions.json"
OUT    = "/home/ubuntu/warroom/web/public/voronoi_overlay.png"
OUT_SMALL = "/tmp/voronoi_overlay_small.png"

labels = np.load(LABELS)
H, W = labels.shape
N = int(labels.max()) + 1
pos = json.load(open(POS))
codes = list(pos.keys())

# 每个种子一色（用固定种子保证可复现）
rng = np.random.default_rng(7)
palette = rng.integers(60, 235, size=(N, 3), dtype=np.uint8)

# ---- 填充层（BGR + alpha）----
rgba = np.zeros((H, W, 4), dtype=np.uint8)
rgba[..., :3] = palette[labels]
rgba[..., 3] = FILL_ALPHA

# ---- 边界描边（相邻 label 不同即为边界）----
diff = np.zeros((H, W), bool)
diff[:, 1:] |= labels[:, 1:] != labels[:, :-1]
diff[1:, :] |= labels[1:, :] != labels[:-1, :]
# 稍微加粗边界，视觉更清楚
k = np.ones((3, 3), np.uint8)
diff = cv2.dilate(diff.astype(np.uint8), k, iterations=1).astype(bool)

rgba[diff] = [0, 0, 0, LINE_ALPHA]          # 深色描边

# ---- 中心点：白点 ----
for code in codes:
    p = pos[code]
    px, py = int(p["x"] * W), int(p["y"] * H)
    cv2.circle(rgba, (px, py), 5, (255, 255, 255, 255), -1)

cv2.imwrite(OUT, rgba)
cv2.imwrite(OUT_SMALL, cv2.resize(rgba, (1000, 1000), interpolation=cv2.INTER_AREA))
print(f"saved {OUT} (fill_alpha={FILL_ALPHA}, line_alpha={LINE_ALPHA})")
print(f"saved {OUT_SMALL}")
