#!/usr/bin/env python3
"""采样地图边界线的实际颜色，判断是否为统一色号。
策略：统计全图颜色直方图，找"细线"特有的颜色（占比小但分布广）。
"""
import cv2, numpy as np
from collections import Counter

m = cv2.imread("/home/ubuntu/warroom/web/public/assets/map.jpg")
H, W = m.shape[:2]
print("shape", m.shape)

# 1) 全图颜色频次（量化到 8 级，压缩空间）
q = (m // 8).reshape(-1, 3)
cnt = Counter(map(tuple, q))
print(f"\n=== 前 30 种颜色 (BGR, 量化到8级) ===")
for col, n in cnt.most_common(30):
    rgb = (col[2]*8, col[1]*8, col[0]*8)  # 转回 RGB 便于理解
    print(f"  BGR{tuple(c*8 for c in col)}  RGB{rgb}  {n} px ({n/(H*W)*100:.2f}%)")
