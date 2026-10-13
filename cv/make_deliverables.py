#!/usr/bin/env python3
"""生成"交付包"：原图 + 几组边界线稿，供人工处理。
重点产出几张"尽量干净"的候选线稿。
"""
import cv2, numpy as np

m = cv2.imread("/home/ubuntu/warroom/web/public/assets/map.jpg")
H, W = m.shape[:2]
gray = cv2.cvtColor(m, cv2.COLOR_BGR2GRAY)

def lines_to_black_on_white(mask):
    """白线->黑线白底（更便于手绘/叠加查看）"""
    out = np.full((H, W), 255, np.uint8)
    out[mask > 0] = 0
    return out

# ============ 候选A：纯亮线阈值（保留最多细节）============
a = (gray > 185).astype(np.uint8) * 255

# ============ 候选B：亮线 + 去细碎（开运算，去文字/小图标）============
k3 = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3,3))
b = cv2.morphologyEx(a, cv2.MORPH_OPEN, k3, iterations=1)

# ============ 候选C：亮线 + 更强清理（先开后闭，补断口）============
c = cv2.morphologyEx(a, cv2.MORPH_OPEN, k3, iterations=2)
c = cv2.morphologyEx(c, cv2.MORPH_CLOSE, k3, iterations=1)

# ============ 候选D：顶帽（突出比周围亮的细线）+ 阈值 ============
k11 = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (11,11))
tophat = cv2.morphologyEx(gray, cv2.MORPH_TOPHAT, k11)
_, d = cv2.threshold(tophat, 35, 255, cv2.THRESH_BINARY)

cases = {
    "A_亮线185": a,
    "B_亮线185_开运算": b,
    "C_亮线185_开闭": c,
    "D_顶帽11": d,
}
for name, mask in cases.items():
    cv2.imwrite(f"/tmp/deliver_{name}.png", lines_to_black_on_white(mask))
    # 也存白线黑底版
    cv2.imwrite(f"/tmp/deliver_{name}_dark.png", mask)
    print(name, f"线像素 {mask.mean()/255*100:.1f}%")

# 原图缩略
cv2.imwrite("/tmp/deliver_ORIGINAL_map.jpg", cv2.resize(m, (1600,1600), interpolation=cv2.INTER_AREA))
print("saved ORIGINAL")
