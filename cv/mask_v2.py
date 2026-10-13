#!/usr/bin/env python3
"""改进海陆掩膜 + 可视化自查。
海洋判定更严格：蓝色 (B-R 差大) 且 饱和度高。
输出：海掩膜(红=海) 叠在原图上，便于肉眼校验。
"""
import cv2, numpy as np

m = cv2.imread("/home/ubuntu/warroom/web/public/assets/map.jpg")
H, W = m.shape[:2]
b, g, r = m[:,:,0].astype(np.int16), m[:,:,1].astype(np.int16), m[:,:,2].astype(np.int16)

# 海洋：蓝色明显。用 (B - max(R,G)) 衡量"蓝的程度"
blueness = b - np.maximum(r, g)
for thr in [10, 20, 30, 40, 50]:
    mask = blueness > thr
    print(f"blueness>{thr}: {mask.mean()*100:.1f}%")

# 取 30 做候选
sea = blueness > 30
# 形态学清理小噪
k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5,5))
sea = cv2.morphologyEx(sea.astype(np.uint8), cv2.MORPH_OPEN, k, iterations=1)
sea = cv2.morphologyEx(sea, cv2.MORPH_CLOSE, k, iterations=2).astype(bool)
print(f"清理后海掩膜: {sea.mean()*100:.1f}%")

# 可视化：海=红，陆=绿
vis = m.copy()
vis[sea] = (vis[sea]*0.3 + np.array([0,0,255])*0.7).astype(np.uint8)
vis[~sea] = (vis[~sea]*0.3 + np.array([0,180,0])*0.7).astype(np.uint8)
cv2.imwrite("/tmp/mask_check.png", cv2.resize(vis,(1200,1200),interpolation=cv2.INTER_AREA))
np.save("/tmp/sea_mask_full.npy", sea)
print("saved /tmp/mask_check.png")
