#!/usr/bin/env python3
"""客观检测：截图里的红点位置 vs 单位牌块中心。
方法：找红色像素团（红点），对比其位置与预期（地块坐标点）。
"""
import cv2, numpy as np, json

img = cv2.imread("/tmp/dbg_dots.png")
H, W = img.shape[:2]
b,g,r = img[:,:,0].astype(int), img[:,:,1].astype(int), img[:,:,2].astype(int)
# 红色：R高，G/B低
red = (r>180) & (g<80) & (b<80)
ys, xs = np.where(red)
print(f"红色像素数: {len(ys)}")
if len(ys):
    # 聚类（简单：按 x 排序分组）
    pts = sorted(zip(xs,ys))
    clusters=[]
    cur=[pts[0]]
    for p in pts[1:]:
        if p[0]-cur[-1][0] <= 20 and abs(p[1]-cur[-1][1])<=20:
            cur.append(p)
        else:
            clusters.append(cur); cur=[p]
    clusters.append(cur)
    print(f"红点团数: {len(clusters)}")
    for c in clusters:
        ax = int(np.mean([p[0] for p in c])); ay=np.mean([p[1] for p in c])
        print(f"  红点中心: ({ax},{int(ay)}) 像素数={len(c)}")

# 计算预期的地块点屏幕位置（用 view 参数复现）
# 这需要 view 状态；改为只看红点是否分散
