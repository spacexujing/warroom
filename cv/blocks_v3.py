#!/usr/bin/env python3
"""区块图 v3 —— 海陆分离 + 拓扑约束 + 边界贴合。
  海域像素 → 极坐标最近海域种子（→ 圆弧/径线）
  陆地像素 → 欧氏最近陆地种子 + 拓扑松弛
  白线(边界/文字)像素 → 归给最近的"同类已分配"邻居（避免空洞）
输出：区块图 + 边界线叠加图
"""
import cv2, numpy as np, json, math, sys

SCALE = int(sys.argv[1]) if len(sys.argv) > 1 else 4
W = H = 2952 // SCALE
ITERS = 6

m = cv2.imread("/home/ubuntu/warroom/web/public/assets/map.jpg")
m = cv2.resize(m, (W, H), interpolation=cv2.INTER_AREA)
b, g, r = m[:,:,0].astype(np.int16), m[:,:,1].astype(np.int16), m[:,:,2].astype(np.int16)
blueness = b - np.maximum(r, g)
sea_mask = blueness > 30
k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3,3))
sea_mask = cv2.morphologyEx(sea_mask.astype(np.uint8), cv2.MORPH_OPEN, k, 1)
sea_mask = cv2.morphologyEx(sea_mask, cv2.MORPH_CLOSE, k, 2).astype(bool)
print(f"海掩膜 {sea_mask.mean()*100:.1f}%")

pos = json.load(open("/home/ubuntu/warroom/extracted/territory_positions.json"))
data = json.load(open("/home/ubuntu/warroom/extracted/territories_full.json"))
by = {x["code"]: x for x in data}
codes = list(pos.keys())
idx = {c:i for i,c in enumerate(codes)}
N = len(codes)
seeds = np.array([[pos[c]["x"]*W, pos[c]["y"]*H] for c in codes], dtype=np.float32)
type_arr = np.array([by[c]["type"] for c in codes])
sea_ids  = np.where(type_arr=="sea")[0]
land_ids = np.where(type_arr=="land")[0]

# 拓扑邻接（陆地间+海陆间都用）
ADJ = np.zeros((N,N), bool); np.fill_diagonal(ADJ, True)
for i,c in enumerate(codes):
    for a in by[c]["adjacentTo"]:
        if a in idx: ADJ[i,idx[a]] = True; ADJ[idx[a],i] = True

CX, CY = W*0.5, H*0.5
gy, gx = np.mgrid[0:H, 0:W]
pr = np.hypot(gx-CX, gy-CY).astype(np.float32)
pth = np.arctan2(gy-CY, gx-CX).astype(np.float32)

lab = np.full((H,W), -1, np.int16)

# --- 海域 ---
sea_r  = np.array([math.hypot(pos[codes[i]]["x"]*W-CX, pos[codes[i]]["y"]*H-CY) for i in sea_ids])
sea_th = np.array([math.atan2(pos[codes[i]]["y"]*H-CY, pos[codes[i]]["x"]*W-CX) for i in sea_ids])
ys, xs = np.where(sea_mask)
PRr, PTH = pr[ys,xs], pth[ys,xs]
best = np.full(len(ys), np.inf, np.float32); bi = np.zeros(len(ys), np.int16)
for kk in range(len(sea_ids)):
    dr = PRr - sea_r[kk]
    dth = np.abs(PTH - sea_th[kk]); dth = np.minimum(dth, 2*np.pi-dth)
    d2 = dr*dr + (PRr*dth)**2
    u = d2 < best; best[u]=d2[u]; bi[u]=kk
lab[ys,xs] = sea_ids[bi]
print("海域完成")

# --- 陆地 ---
land_mask = (~sea_mask)
# 排除很亮的白线/文字
land_mask &= (r+g+b) < 690
ys, xs = np.where(land_mask)
flat = np.stack([xs,ys],1).astype(np.float32)
best = np.full(len(ys), np.inf, np.float32); bi = np.zeros(len(ys), np.int16)
for s0 in range(0,len(land_ids),40):
    sub = land_ids[s0:s0+40]
    d2 = ((flat[:,None,:]-seeds[None,sub,:])**2).sum(2)
    am=d2.argmin(1); dm=d2[np.arange(len(ys)),am]
    u=dm<best; best[u]=dm[u]; bi[u]=s0+am[u]
lab[ys,xs] = land_ids[bi]
print("陆地完成")

# --- 拓扑松弛（只对已分配像素，迭代修正非法相邻）---
for it in range(ITERS):
    L = lab
    illegal_any = np.zeros((H,W), bool)
    for dy in (-1,0,1):
        for dx in (-1,0,1):
            if dx==0 and dy==0: continue
            nb = np.roll(np.roll(L, dy,0), dx,1)
            valid = (L>=0)&(nb>=0)
            illegal = valid & (~ADJ[np.clip(L,0,N-1), np.clip(nb,0,N-1)])
            illegal_any |= illegal
    # 对非法像素：在与自身相邻的候选里选欧氏最近的
    ys, xs = np.where(illegal_any & (lab>=0))
    if len(ys)==0:
        print(f"  迭代{it}: 无非法，收敛"); break
    # 候选 = 该像素最近的若干陆地/海域种子中，与当前标签相邻的
    changed=0
    for y,x in zip(ys[::3], xs[::3]):   # 抽样加速
        cur = lab[y,x]
        # 找与 cur 相邻的种子
        ok = np.where(ADJ[cur])[0]
        if len(ok)==0: continue
        d2 = ((seeds[ok]-np.array([x,y],np.float32))**2).sum(1)
        lab[y,x] = ok[d2.argmin()]
        changed+=1
    print(f"  迭代{it}: 抽样改动 {changed}")
print("松弛完成")

np.save(f"/tmp/blocks_v3_{SCALE}.npy", lab)

# 可视化
rng = np.random.default_rng(7)
pal = rng.integers(60,235,size=(N,3),dtype=np.uint8)
vis = np.zeros((H,W,3),np.uint8)
vis[lab>=0]=pal[np.clip(lab[lab>=0],0,N-1)]

# 边界
edge = np.zeros((H,W),bool)
edge[:,1:] |= (lab[:,1:]!=lab[:,:-1])&(lab[:,1:]>=0)&(lab[:,:-1]>=0)
edge[1:,:] |= (lab[1:,:]!=lab[:-1,:])&(lab[1:,:]>=0)&(lab[:-1,:]>=0)

# 叠加版（半透明+黑边）
mfull = cv2.resize(cv2.imread("/home/ubuntu/warroom/web/public/assets/map.jpg"),(W,H))
ov = (mfull*0.5 + vis*0.5).astype(np.uint8)
ov[edge] = [0,0,0]
cv2.imwrite(f"/tmp/blocks_v3_overlay_{SCALE}.png", cv2.resize(ov,(1100,1100),interpolation=cv2.INTER_AREA))
cv2.imwrite(f"/tmp/blocks_v3_flat_{SCALE}.png", cv2.resize(vis,(1000,1000),interpolation=cv2.INTER_NEAREST))
print("saved blocks_v3")
