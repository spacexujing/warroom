#!/usr/bin/env python3
"""Voronoi 最近邻分配：每个像素划给最近的中心点。
输出：
  - /tmp/voronoi.png       彩色分区图（每个区域一色）
  - web/public/voronoi.png 同上，供前端使用
  - web/public/regions.json 每个区域的像素质心/索引（可选）
"""
import cv2, numpy as np, json

W = H = 2952
pos = json.load(open("/home/ubuntu/warroom/extracted/territory_positions.json"))

# 中心点 -> 像素坐标
codes = list(pos.keys())
seeds = np.array([[pos[c]["x"] * W, pos[c]["y"] * H] for c in codes], dtype=np.float32)  # (N,2)
N = len(seeds)
print("种子点:", N)

# 分块计算最近邻（避免 2952*2952*190 的巨矩阵）
labels = np.zeros((H, W), dtype=np.int16)
BAND = 64  # 按行分块（控制内存）
for y0 in range(0, H, BAND):
    y1 = min(H, y0 + BAND)
    ys = np.arange(y0, y1)
    xs = np.arange(W)
    gx, gy = np.meshgrid(xs, ys)                 # (bh,W)
    pts = np.stack([gx.ravel(), gy.ravel()], axis=1).astype(np.float32)  # (bh*W,2)
    # 距离用 float32；分种子批处理以免爆内存
    best_d = np.full(pts.shape[0], np.inf, dtype=np.float32)
    best_l = np.zeros(pts.shape[0], dtype=np.int16)
    for s0 in range(0, N, 32):
        s1 = min(N, s0 + 32)
        d2 = ((pts[:, None, :] - seeds[None, s0:s1, :]) ** 2).sum(axis=2)  # (bh*W, <=32)
        am = d2.argmin(axis=1)
        dm = d2[np.arange(pts.shape[0]), am]
        upd = dm < best_d
        best_d[upd] = dm[upd]
        best_l[upd] = (am[upd] + s0).astype(np.int16)
    labels[y0:y1] = best_l.reshape(y1 - y0, W)
    print(f"  band {y0}-{y1} done")

np.save("/tmp/voronoi_labels.npy", labels)

# 上色（每个种子一色）
rng = np.random.default_rng(7)
palette = rng.integers(50, 235, size=(N, 3), dtype=np.uint8)
vis = palette[labels]

# 画边界（相邻 label 不同的地方描黑）与中心点
diff = np.zeros((H, W), bool)
diff[:, 1:] |= labels[:, 1:] != labels[:, :-1]
diff[1:, :] |= labels[1:, :] != labels[:-1, :]
vis[diff] = (0, 0, 0)
for c, (x, y) in zip(codes, seeds):
    cv2.circle(vis, (int(x), int(y)), 4, (255, 255, 255), -1)

cv2.imwrite("/tmp/voronoi.png", vis)
import os
os.makedirs("/home/ubuntu/warroom/web/public", exist_ok=True)
cv2.imwrite("/home/ubuntu/warroom/web/public/voronoi.png", vis)
cv2.imwrite("/tmp/voronoi_small.png", cv2.resize(vis, (900, 900)))

# 导出每区域信息（像素数 + 质心）
info = {}
for i, c in enumerate(codes):
    ys, xs = np.where(labels == i)
    info[c] = {"seed": [float(seeds[i][0]), float(seeds[i][1])], "px": int(len(xs))}
json.dump(info, open("/tmp/voronoi_info.json", "w"), ensure_ascii=False, indent=1)
print("saved voronoi.png / voronoi_small.png / info")
