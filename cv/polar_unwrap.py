#!/usr/bin/env python3
"""验证：海洋边界是否真的是"同心圆弧 + 径线"。
方法：以地图中心(0.5,0.5)为极点，把地图转成极坐标图（polar unwrap），
      若是完美极坐标网格，展开后会变成"直角网格"（水平线=圆弧，竖线=径线）。
"""
import cv2, numpy as np

m = cv2.imread("/home/ubuntu/warroom/web/public/assets/map.jpg")
H, W = m.shape[:2]
CX, CY = W*0.5, H*0.5

# 极坐标展开：输出 (角度, 半径)
out_w = 1440      # 角度维（0..360°）
out_h = 900       # 半径维（0..maxR）
maxR = np.hypot(W/2, H/2)
polar = cv2.warpPolar(m, (out_w, out_h), (CX, CY), maxR, cv2.WARP_POLAR_LINEAR)
# warpPolar 输出：行=半径，列=角度
cv2.imwrite("/tmp/polar_unwrap.png", cv2.resize(polar, (1440, 900)))
print("saved /tmp/polar_unwrap.png")

# 取某一圈海洋（比如 r≈0.42*mapSide）看颜色是否在同半径处连续
