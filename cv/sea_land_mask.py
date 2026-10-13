#!/usr/bin/env python3
"""生成"海陆掩膜"：区分每个像素是海洋还是陆地。
方法：海洋是蓝色系（B 明显大于 R）。但地图上还有浅蓝的"亲同盟中立国"等。
先看颜色特征。
"""
import cv2, numpy as np

m = cv2.imread("/home/ubuntu/warroom/web/public/assets/map.jpg")
b, g, r = m[:,:,0].astype(int), m[:,:,1].astype(int), m[:,:,2].astype(int)

# 海洋：蓝色主导
sea = (b > r + 10) & (b > 70)
print(f"蓝色像素(可能是海): {sea.mean()*100:.1f}%")

# 看海洋的实际色值范围
ys, xs = np.where(sea)
samp = m[ys[::5000], xs[::5000]]
print("海洋采样 BGR 均值:", samp.mean(0).round(1))
# R,G,B 各自范围
print("  R range:", r[sea].min(), r[sea].max(), "mean", r[sea].mean().round(1))
print("  G range:", g[sea].min(), g[sea].max(), "mean", g[sea].mean().round(1))
print("  B range:", b[sea].min(), b[sea].max(), "mean", b[sea].mean().round(1))

# 存掩膜可视化
vis = np.zeros_like(m)
vis[sea] = (255,200,0)
cv2.imwrite("/tmp/sea_mask.png", vis)
cv2.imwrite("/tmp/sea_mask_bw.png", (sea*255).astype(np.uint8))
print("saved /tmp/sea_mask.png")

# 陆地侧：非海、非白线
land = ~sea & ((r+g+b) < 700)   # 排除白色线条
cv2.imwrite("/tmp/land_mask_bw.png", (land*255).astype(np.uint8))
print("saved /tmp/land_mask_bw.png")
