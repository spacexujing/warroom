#!/usr/bin/env python3
"""精确测量：番号图标列里，各方块图标与海军条图标的水平范围，判断是否居中/对齐。
方法：在行动面板左侧图标列区域，扫描非背景像素的列分布。
"""
import cv2, numpy as np

img = cv2.imread("/tmp/panel_navy.png")
H, W = img.shape[:2]
print("img", W, H)

# 面板从 0.70W 开始；图标列在面板内约 10~110px（面板padding后）
# 先看面板左边界：找竖直亮线
panel_x0 = int(W*0.70)

# 裁出面板前 130px（图标列区域）
strip = img[:, panel_x0:panel_x0+130]
gray = cv2.cvtColor(strip, cv2.COLOR_BGR2GRAY)
# 图标是不透明深灰块（比半透明背景亮）
# 逐行找"亮块"的水平范围
rows_with_block = []
for y in range(H):
    row = gray[y]
    # 阈值：图标块较亮
    mask = row > 60
    xs = np.where(mask)[0]
    if len(xs) > 10:
        rows_with_block.append((y, int(xs.min()), int(xs.max())))

# 聚类成行组（相邻 y 归为一个图标）
groups = []
cur = []
for item in rows_with_block:
    if cur and item[0]-cur[-1][0] > 3:
        groups.append(cur); cur=[]
    cur.append(item)
if cur: groups.append(cur)

print(f"\n检测到 {len(groups)} 个图标块：")
for g in groups:
    ys = [x[0] for x in g]; xmins=[x[1] for x in g]; xmaxs=[x[2] for x in g]
    y0,y1 = min(ys), max(ys)
    xmin, xmax = min(xmins), max(xmaxs)
    print(f"  y {y0:4d}-{y1:4d} (h={y1-y0+1:3d})  x {xmin:3d}-{xmax:3d} (w={xmax-xmin+1:3d})  中心x={ (xmin+xmax)//2 }")
