#!/usr/bin/env python3
"""参数搜寻：找一组 (阈值, 闭运算迭代, 面积下限) 使分割最贴合已知中心点。
评价指标：
  - 命中率：190 中心点中落在"大区块"内的比例
  - 冲突率：两个不同中心点落在同一个大区块内的次数（越少越好，说明区域被正确分开）
  - 区块数：接近 112 陆地区域为佳
"""
import cv2, numpy as np, json

img = cv2.imread("/home/ubuntu/warroom/web/public/assets/map.jpg")
gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
H, W = gray.shape
pos = json.load(open("/home/ubuntu/warroom/extracted/territory_positions.json"))
pts = []
for code, p in pos.items():
    px = int(p["x"] * W); py = int(p["y"] * H)
    px = min(max(px, 0), W - 1); py = min(max(py, 0), H - 1)
    pts.append((code, px, py))

def evaluate(thr, close_iter, dilate_iter, area_frac):
    line = (gray > thr).astype(np.uint8) * 255
    k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3))
    if close_iter:  line = cv2.morphologyEx(line, cv2.MORPH_CLOSE, k, iterations=close_iter)
    if dilate_iter: line = cv2.dilate(line, k, iterations=dilate_iter)
    region = (line == 0).astype(np.uint8)
    n, labels, stats, cents = cv2.connectedComponentsWithStats(region, connectivity=4)
    big = set(i for i in range(1, n) if stats[i, 4] > H * W * area_frac)
    # 命中 & 冲突
    hit = 0; owner = {}
    collide = 0
    for code, px, py in pts:
        lab = labels[py, px]
        if lab in big:
            hit += 1
            if lab in owner: collide += 1
            else: owner[lab] = code
    return len(big), hit, collide

print("thr close dil area  | blocks hit collide")
best = None
for thr in [170, 185, 200, 215]:
    for close_iter in [1, 2, 3]:
        for dil in [0, 1, 2]:
            for af in [0.0002, 0.0005, 0.001]:
                blocks, hit, collide = evaluate(thr, close_iter, dil, af)
                score = hit - collide * 3 - abs(blocks - 112) * 0.1
                line_s = f"thr{thr} c{close_iter} d{dil} a{af}"
                if hit >= 150:
                    print(f"{line_s:26s}| {blocks:4d} {hit:4d} {collide:4d}  score={score:.1f}")
                if best is None or score > best[0]:
                    best = (score, thr, close_iter, dil, af, blocks, hit, collide)
print("\nBEST:", best)
