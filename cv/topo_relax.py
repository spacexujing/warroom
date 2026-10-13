#!/usr/bin/env python3
"""拓扑约束 Voronoi —— 迭代标签松弛。

算法：
  1. 初始 = 普通 Voronoi（每个像素归最近种子）
  2. 迭代若干轮：
     对每个像素 p（标签 i），若它的 8 邻域里存在标签 j 且 j 与 i **不相邻**，
     则把 p 重标为「与 i 相邻」且「到 p 距离最近」的那个标签 k
     （即：不允许 i 和 j 直接接触，用合法邻居 k 去隔离）。
  3. 反复直到收敛或达上限。

评价：边界合法率（相邻标签对占比）。
"""
import numpy as np, json, sys, cv2

SCALE = int(sys.argv[1]) if len(sys.argv) > 1 else 4
ITERS  = int(sys.argv[2]) if len(sys.argv) > 2 else 8
W = H = 2952 // SCALE

pos  = json.load(open("/home/ubuntu/warroom/extracted/territory_positions.json"))
data = json.load(open("/home/ubuntu/warroom/extracted/territories_full.json"))
by   = {r["code"]: r for r in data}
codes = list(pos.keys())
idx = {c: i for i, c in enumerate(codes)}
N = len(codes)
seeds = np.array([[pos[c]["x"]*W, pos[c]["y"]*H] for c in codes], dtype=np.float32)

ADJ = np.zeros((N, N), bool)
for i, c in enumerate(codes):
    for a in by[c]["adjacentTo"]:
        if a in idx:
            ADJ[i, idx[a]] = True; ADJ[idx[a], i] = True
# 允许自相邻（同块）
np.fill_diagonal(ADJ, True)

# 距离场：每个像素到所有种子的距离（降采样后能一次放下：738*738*190*4B ≈ 400MB → 分块更稳）
# 这里分块算，存 dist 全量太大，改为松弛时按需算距离不可行。
# 折中：只保留「每个像素到最近 K 个种子」的距离+索引（K=8）
K = 12
gy, gx = np.mgrid[0:H, 0:W]
flat = np.stack([gx.ravel(), gy.ravel()],1).astype(np.float32)
topd = np.full((flat.shape[0], K), np.inf, np.float32)
topi = np.full((flat.shape[0], K), -1, np.int16)
for s0 in range(0, N, 40):
    s1 = min(N, s0+40)
    d2 = ((flat[:,None,:]-seeds[None,s0:s1,:])**2).sum(2)   # (M,<=40)
    cand_d = np.concatenate([topd, d2], 1)
    cand_i = np.concatenate([topi, (np.arange(s0,s1)[None,:].repeat(flat.shape[0],0))], 1)
    order = np.argsort(cand_d, 1)[:, :K]
    topd = np.take_along_axis(cand_d, order, 1)
    topi = np.take_along_axis(cand_i, order, 1)
topd = topd.reshape(H, W, K)
topi = topi.reshape(H, W, K)

labels = topi[:, :, 0].astype(np.int16)   # 初始 = 最近种子
np.save(f"/tmp/topk_{SCALE}.npy", topi)

def metrics(lab):
    lg = bd = 0
    a=lab[:,:-1]; b=lab[:,1:]; m=a!=b
    lg+=ADJ[a[m],b[m]].sum(); bd+=(~ADJ[a[m],b[m]]).sum()
    a=lab[:-1,:]; b=lab[1:,:]; m=a!=b
    lg+=ADJ[a[m],b[m]].sum(); bd+=(~ADJ[a[m],b[m]]).sum()
    return lg, bd, lg/(lg+bd)*100

# ---- 迭代松弛 ----
for it in range(ITERS):
    # 收集邻居（8 邻域）标签
    neigh = []
    for dy in (-1,0,1):
        for dx in (-1,0,1):
            if dy==0 and dx==0: continue
            sh = np.roll(np.roll(labels, dy, 0), dx, 1)
            neigh.append(sh)
    neigh = np.stack(neigh, 0)   # (8,H,W)
    i_lab = labels[None,:,:]      # (1,H,W)
    legal = ADJ[i_lab, neigh]     # (8,H,W) 每个邻居是否合法
    # 存在非法邻居？
    has_illegal = (~legal).any(0)
    # 对存在非法邻居的像素：在与 i 相邻的候选中，选最近的「非自身」候选
    cand_lab = topi               # (H,W,K)
    cand_legal = ADJ[np.broadcast_to(labels[:,:,None], cand_lab.shape), cand_lab]  # (H,W,K)
    # 排除自身标签（cand_lab == labels）
    is_self = (cand_lab == labels[:,:,None])
    # 候选有效 = 合法 且 非自身
    valid = cand_legal & (~is_self)
    first_valid = np.argmax(valid, 2)          # 第一个有效候选的索引
    any_valid = valid.any(2)
    new_lab = np.take_along_axis(cand_lab, first_valid[:,:,None], 2)[:,:,0]
    # 只有：当前像素有非法邻居 且 存在有效候选 时才改
    change = has_illegal & any_valid
    labels = np.where(change, new_lab, labels).astype(np.int16)
    lg, bd, rate = metrics(labels)
    print(f"iter {it+1}: 合法边界={lg} 非法={bd} 合法率={rate:.1f}%  (改动像素={change.sum()})")
    if change.sum() < 50:
        print("收敛"); break

np.save(f"/tmp/vor_topo_{SCALE}.npy", labels)
rng = np.random.default_rng(7)
pal = rng.integers(50,235,size=(N,3),dtype=np.uint8)
vis = pal[labels]
diff = np.zeros((H,W),bool)
diff[:,1:] |= labels[:,1:]!=labels[:,:-1]
diff[1:,:] |= labels[1:,:]!=labels[:-1,:]
vis[diff]=(0,0,0)
cv2.imwrite(f"/tmp/vor_topo_{SCALE}.png", cv2.resize(vis,(900,900),interpolation=cv2.INTER_NEAREST))
print("saved /tmp/vor_topo_%d.png" % SCALE)
