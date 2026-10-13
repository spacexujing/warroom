#!/usr/bin/env python3
"""精确采样：在两个相邻地块之间的中点位置取像素，看边界线的确切颜色。
方法：对每对相邻地块，取其坐标中点，沿垂直方向扫一条像素线，
      看那条"细线"的颜色和它两侧地块的颜色差异。
"""
import cv2, numpy as np, json, math

m = cv2.imread("/home/ubuntu/warroom/web/public/assets/map.jpg")
H, W = m.shape[:2]
pos = json.load(open("/home/ubuntu/warroom/web/public/data_positions.json"))
data = json.load(open("/home/ubuntu/warroom/extracted/territories_full.json"))
by = {r["code"]: r for r in data}

pairs = [("G1","G2"),("G1","G8"),("G2","G3"),("B1","A6"),("T1","M2"),("R1","R2")]
for a, b in pairs:
    if a not in pos or b not in pos: continue
    pa, pb = pos[a], pos[b]
    # 中点
    mx, my = (pa["x"]+pb["x"])/2*W, (pa["y"]+pb["y"])/2*H
    # 沿 a->b 方向扫 ±40px，采样颜色
    dx = (pb["x"]-pa["x"])*W; dy = (pb["y"]-pa["y"])*H
    n = math.hypot(dx,dy); ux,uy = dx/n, dy/n
    samples = []
    for t in range(-40, 41, 2):
        x = int(mx + ux*t); y = int(my + uy*t)
        if 0<=x<W and 0<=y<H:
            bgr = m[y,x]
            samples.append((t, tuple(int(v) for v in bgr)))
    # 找"最亮"的点（边界线通常比两侧亮）
    brightest = max(samples, key=lambda s: sum(s[1]))
    darkest = min(samples, key=lambda s: sum(s[1]))
    print(f"\n{a}-{b} 中点({int(mx)},{int(my)})")
    print(f"  沿线最亮: t={brightest[0]} BGR={brightest[1]}  亮度={sum(brightest[1])}")
    print(f"  沿线最暗: t={darkest[0]} BGR={darkest[1]}")
    # 打印中间段的几个采样
    mid = [s for s in samples if -12<=s[0]<=12]
    print("  中点附近采样:", [(t, c) for t,c in mid])
