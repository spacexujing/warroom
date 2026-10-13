#!/usr/bin/env python3
"""拓扑约束 Voronoi 原型（向量化版，先小分辨率验证可行性）。

指标：边界合法率 = 合法的(相邻)边界像素对数 / 全部边界像素对数
     目标：把非法边界（两个不相邻地块直接接触）压到最低。
"""
import numpy as np, json, sys

SCALE = int(sys.argv[1]) if len(sys.argv) > 1 else 4   # 降采样倍数
W = H = 2952 // SCALE

pos  = json.load(open("/home/ubuntu/warroom/extracted/territory_positions.json"))
data = json.load(open("/home/ubuntu/warroom/extracted/territories_full.json"))
by   = {r["code"]: r for r in data}
codes = list(pos.keys())
idx = {c: i for i, c in enumerate(codes)}
N = len(codes)

seeds = np.array([[pos[c]["x"]*W, pos[c]["y"]*H] for c in codes], dtype=np.float32)
# 相邻掩码矩阵 (N,N) bool
ADJ = np.zeros((N, N), bool)
for i, c in enumerate(codes):
    for a in by[c]["adjacentTo"]:
        if a in idx:
            ADJ[i, idx[a]] = True
            ADJ[idx[a], i] = True

# ---- 普通 Voronoi（全图一次算，降采样后内存够）----
gx, gy = np.meshgrid(np.arange(W), np.arange(H))
pts = np.stack([gx.ravel(), gy.ravel()], 1).astype(np.float32)
best_d = np.full(pts.shape[0], np.inf, np.float32)
best_l = np.zeros(pts.shape[0], np.int16)
for s0 in range(0, N, 32):
    s1 = min(N, s0+32)
    d2 = ((pts[:,None,:]-seeds[None,s0:s1,:])**2).sum(2)
    am = d2.argmin(1); dm = d2[np.arange(pts.shape[0]), am]
    upd = dm < best_d
    best_d[upd]=dm[upd]; best_l[upd]=(am[upd]+s0).astype(np.int16)
labels = best_l.reshape(H, W)
D = best_d.reshape(H, W)
np.save(f"/tmp/vor_plain_{SCALE}.npy", labels)
print(f"普通 Voronoi 完成 (scale={SCALE}, {W}x{H})")

def metrics(lab):
    # 水平相邻对
    a = lab[:, :-1]; b = lab[:, 1:]
    m = a != b
    ga = a[m]; gb = b[m]
    legal_h = ADJ[ga, gb]
    # 垂直相邻对
    a = lab[:-1, :]; b = lab[1:, :]
    m = a != b
    ga = a[m]; gb = b[m]
    legal_v = ADJ[ga, gb]
    legal = legal_h.sum()+legal_v.sum()
    total = legal_h.size + legal_v.size
    return legal, total-legal, legal/total*100

lg, bd, rate = metrics(labels)
print(f"普通 Voronoi: 合法边界={lg} 非法边界={bd} 合法率={rate:.1f}%")

# 保存可视化
import cv2
rng = np.random.default_rng(7)
pal = rng.integers(50,235,size=(N,3),dtype=np.uint8)
vis = pal[labels]
diff = np.zeros((H,W),bool)
diff[:,1:] |= labels[:,1:]!=labels[:,:-1]
diff[1:,:] |= labels[1:,:]!=labels[:-1,:]
vis[diff]=(0,0,0)
cv2.imwrite(f"/tmp/vor_plain_{SCALE}.png", cv2.resize(vis,(900,900),interpolation=cv2.INTER_NEAREST))
print("saved /tmp/vor_plain_%d.png" % SCALE)
