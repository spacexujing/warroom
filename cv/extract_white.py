#!/usr/bin/env python3
"""用"接近纯白"精确提取边界线。
发现：边界线颜色 ≈ (255,255,255)（R≈G≈B 且都接近 255）。
       地块填充是各色，文字也可能是白色或浅色——需区分。
策略：R,G,B 都 > 240 且 三者差 < 12（接近中性白）。
"""
import cv2, numpy as np

m = cv2.imread("/home/ubuntu/warroom/web/public/assets/map.jpg")
b, g, r = m[:,:,0].astype(int), m[:,:,1].astype(int), m[:,:,2].astype(int)

# 白色掩膜：三通道都很高 且 接近相等
white = (r > 240) & (g > 240) & (b > 240) & (np.abs(r-g) < 12) & (np.abs(g-b) < 12) & (np.abs(r-b) < 12)
print(f"纯白像素: {white.mean()*100:.2f}%")

# 稍宽的白
white2 = (r > 225) & (g > 225) & (b > 225) & (np.abs(r-g) < 20) & (np.abs(g-b) < 20)
print(f"较宽白: {white2.mean()*100:.2f}%")

# 存成黑线白底
def save(name, mask):
    out = np.full(m.shape[:2], 255, np.uint8)
    out[mask] = 0
    cv2.imwrite(name, out)
    print("saved", name)

save("/tmp/white_strict.png", white)
save("/tmp/white_loose.png", white2)

# 对照：只把白色保留，其他变暗，看白线是否清晰
vis = m.copy()
vis[~white] = (vis[~white]*0.25).astype(np.uint8)
cv2.imwrite("/tmp/white_on_dim.png", vis)

# 统计：纯白像素在原图的位置分布（是否真的是线状）
