#!/usr/bin/env python3
"""客观检测：极坐标展开后，海洋边界线是水平(圆弧)还是垂直(径线)。
方法：边缘检测 + Hough 直线，统计角度分布。
  0°/180° = 水平线(→原图同心圆弧)
  90°/270° = 垂直线(→原图径向线)
"""
import cv2, numpy as np

m = cv2.imread("/home/ubuntu/warroom/web/public/assets/map.jpg")
H, W = m.shape[:2]
CX, CY = W*0.5, H*0.5
maxR = np.hypot(W/2, H/2)
out_w, out_h = 1440, 900
polar = cv2.warpPolar(m, (out_w, out_h), (CX, CY), maxR, cv2.WARP_POLAR_LINEAR)

gray = cv2.cvtColor(polar, cv2.COLOR_BGR2GRAY)
# 只关注海洋区域：蓝色像素（B 高，R/G 中低）。在 BGR 里海洋是 (高B, 中G, 低R)
b,g,r = polar[:,:,0].astype(int), polar[:,:,1].astype(int), polar[:,:,2].astype(int)
sea = (b > r + 15) & (b > 60)
print(f"海洋像素占比: {sea.mean()*100:.1f}%")

# 海洋边界的边缘：海洋掩膜的梯度
sea_u8 = (sea*255).astype(np.uint8)
edges = cv2.Canny(sea_u8, 50, 150)
print(f"边缘像素: {edges.sum()/255:.0f}")

lines = cv2.HoughLinesP(edges, 1, np.pi/180, threshold=60, minLineLength=80, maxLineGap=15)
if lines is None:
    print("未检测到直线")
    raise SystemExit
angles = []
for seg in lines.reshape(-1, 4):
    x1,y1,x2,y2 = seg
    a = abs(np.degrees(np.arctan2(y2-y1, x2-x1))) % 180
    angles.append(a)
angles = np.array(angles)
print(f"检测到 {len(angles)} 条直线")
# 分类
horiz = ((angles < 15) | (angles > 165)).sum()   # 水平 = 圆弧
vert  = ((angles > 75) & (angles < 105)).sum()    # 垂直 = 径线
diag  = len(angles) - horiz - vert
print(f"  水平线(→同心圆弧): {horiz}  ({horiz/len(angles)*100:.0f}%)")
print(f"  垂直线(→径向线):   {vert}  ({vert/len(angles)*100:.0f}%)")
print(f"  斜线/其他:         {diag}  ({diag/len(angles)*100:.0f}%)")
hist,_ = np.histogram(angles, bins=12, range=(0,180))
print("角度直方图(每15°):", list(hist))
