#!/usr/bin/env python3
"""裁出番号图标列，检查各行的图标水平对齐/居中。"""
import cv2, sys
img = cv2.imread("/tmp/panel_navy.png")
H, W = img.shape[:2]
# 行动面板约右侧 30%（从 0.70W 起）
x0 = int(W*0.70)
crop = img[:, x0:x0+180]   # 图标列一带
crop = cv2.resize(crop, (crop.shape[1]*2, crop.shape[0]*2), interpolation=cv2.INTER_NEAREST)
cv2.imwrite("/tmp/icons_col.png", crop)
print("saved /tmp/icons_col.png", crop.shape)
