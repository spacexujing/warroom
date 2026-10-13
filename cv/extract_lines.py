#!/usr/bin/env python3
"""提取地图边界线（陆地+海洋），生成多组候选线稿。
地图特征：边界线是"浅色细线"，比底色亮。干扰物：文字、图标、铁路虚线、海岸线。
输出几组不同策略的黑线白底线稿，供人工挑选。
"""
import cv2, numpy as np

m = cv2.imread("/home/ubuntu/warroom/web/public/assets/map.jpg")
H, W = m.shape[:2]
gray = cv2.cvtColor(m, cv2.COLOR_BGR2GRAY)
print("map", m.shape, "gray range", gray.min(), gray.max(), "mean", gray.mean())

def save(name, mask):
    """mask: 白=线，黑=底"""
    cv2.imwrite(name, mask)
    print("saved", name, f"线像素 {mask.mean()/255*100:.1f}%")

# --- 策略1：亮线阈值（边界线比底色亮）---
for thr in [170, 190, 210]:
    line = (gray > thr).astype(np.uint8) * 255
    save(f"/tmp/lines_bright_{thr}.png", line)

# --- 策略2：亮线 + 形态学开运算去小噪（去文字/小图标）---
for thr in [170, 190]:
    line = (gray > thr).astype(np.uint8) * 255
    # 开运算：去掉细碎的小块（文字），保留长线
    k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3,3))
    opened = cv2.morphologyEx(line, cv2.MORPH_OPEN, k, iterations=1)
    save(f"/tmp/lines_open_{thr}.png", opened)

# --- 策略3：Canny 边缘（通用边缘检测）---
for lo, hi in [(50,150),(80,200)]:
    e = cv2.Canny(gray, lo, hi)
    save(f"/tmp/lines_canny_{lo}_{hi}.png", e)

# --- 策略4：局部对比（顶帽变换）—— 提取"比周围亮"的细线，抑制大面积亮区 ---
# 顶帽 = 原图 - 开运算(原图)：突出比周围亮的细结构
for ksize in [7, 11]:
    k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (ksize,ksize))
    tophat = cv2.morphologyEx(gray, cv2.MORPH_TOPHAT, k)
    _, mask = cv2.threshold(tophat, 30, 255, cv2.THRESH_BINARY)
    save(f"/tmp/lines_tophat_{ksize}.png", mask)

# --- 策略5：自适应阈值（对局部对比敏感）---
adapt = cv2.adaptiveThreshold(gray, 255, cv2.ADAPTIVE_THRESH_MEAN_C,
                              cv2.THRESH_BINARY, 15, -10)
save("/tmp/lines_adaptive.png", adapt)

# --- 原图缩小版，方便对照 ---
cv2.imwrite("/tmp/map_full.jpg", cv2.resize(m, (1400,1400), interpolation=cv2.INTER_AREA))
print("saved /tmp/map_full.jpg (1400x1400)")
