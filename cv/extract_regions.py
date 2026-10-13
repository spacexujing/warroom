#!/usr/bin/env python3
"""试探：从 map.jpg 提取区域边界，尝试分割出大区块。
策略：
  1) 亮线掩膜（边界线比底色亮）
  2) 形态学闭运算补断口
  3) 连通域分割
  4) 用已知 190 中心点匹配区域编号
"""
import cv2, numpy as np, json, sys

MAP = "/home/ubuntu/warroom/web/public/assets/map.jpg"
POS = "/home/ubuntu/warroom/extracted/territory_positions.json"

img = cv2.imread(MAP)
gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
H, W = gray.shape

# --- 亮线掩膜 ---
for thr in [170, 185, 200]:
    line = (gray > thr).astype(np.uint8)
    print(f"thr>{thr}: {line.mean()*100:.2f}% 亮线")

# 用 185 起步
line = (gray > 185).astype(np.uint8) * 255
k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3))
# 闭运算补断口
line_c = cv2.morphologyEx(line, cv2.MORPH_CLOSE, k, iterations=2)

region = (line_c == 0).astype(np.uint8)
n, labels, stats, cents = cv2.connectedComponentsWithStats(region, connectivity=4)
print("连通域数(闭2次):", n - 1)

# 只用"大区块"（面积 > 0.0003 地图）
mapArea = H * W
big_ids = [i for i in range(1, n) if stats[i, 4] > mapArea * 0.0003]
print("大区块数:", len(big_ids))

# 匹配中心点
pos = json.load(open(POS))
name2id = {}
for i in big_ids:
    cx, cy = cents[i]
    name2id[i] = (cx, cy)
print("质心样本:", list(name2id.items())[:3])

# 每个已知点落在哪个区域（映射到 190 点的像素坐标）
matched = 0
for code, p in pos.items():
    px, py = int(p["x"] * W), int(p["y"] * H)
    px = min(max(px, 0), W - 1); py = min(max(py, 0), H - 1)
    lab = labels[py, px]
    if lab in big_ids:
        matched += 1
print("190 个中心点中，落在大区块内的:", matched)

np.save("/tmp/labels.npy", labels)
np.save("/tmp/line_c.npy", line_c)
print("saved labels/line_c")
