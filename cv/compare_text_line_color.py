#!/usr/bin/env python3
"""对比：边界线 vs 文字 的确切颜色，看能否用色号区分。"""
import cv2, numpy as np, json

m = cv2.imread("/home/ubuntu/warroom/web/public/assets/map.jpg")
H, W = m.shape[:2]
pos = json.load(open("/home/ubuntu/warroom/web/public/data_positions.json"))

def sample(px, py, rad=2):
    patch = m[max(0,py-rad):py+rad+1, max(0,px-rad):px+rad+1].reshape(-1,3)
    # 取最亮的像素
    idx = patch.sum(1).argmax()
    return patch[idx]

# 边界线样本（相邻地块中点，从之前分析已知）
bounds = {"G1-G2":(786,1518), "R1-R2":(1369,1524), "G2-G3":(701,1489)}
print("=== 边界线颜色（已知位置最亮像素）===")
for name,(x,y) in bounds.items():
    # 在附近多取几个
    vals = []
    for dx in range(-15,16,3):
        for dy in range(-15,16,3):
            v = sample(x+dx, y+dy, 1)
            if v.sum() > 600:
                vals.append(tuple(int(t) for t in v))
    if vals:
        arr = np.array(vals)
        print(f"  {name}: 均值 BGR={arr.mean(0).round(1)}  样本数={len(vals)}")

# 文字样本：取地块名字附近（比如某地块内明显的文字区）
print("\n=== 全图最亮像素的颜色分布（前 10 高频精确色）===")
flat = m.reshape(-1,3)
bright = flat[flat.sum(1) > 740]   # 很亮的
from collections import Counter
cnt = Counter(map(tuple, bright))
for col, n in cnt.most_common(10):
    print(f"  BGR{col}  出现 {n} 次")
