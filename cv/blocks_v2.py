#!/usr/bin/env python3
"""区块图 v2：海域用极坐标最近邻(→圆弧/径线边界)，陆地用拓扑约束 Voronoi。

流程：
  1. 海陆掩膜（蓝色=海）
  2. 海域像素：极坐标距离最近的「海域种子」
     - 极坐标距离 d = sqrt( (Δr)^2 + (r*Δθ)^2 )   ← 角度差按半径加权
     - 这样边界天然是圆弧(等r)或径线(等θ)
  3. 陆地像素：欧氏距离最近的「陆地种子」+ 拓扑松弛
  4. 合成，输出彩色区块图 + 边界线图
"""
import cv2, numpy as np, json, math, sys

SCALE = int(sys.argv[1]) if len(sys.argv) > 1 else 4
W = H = 2952 // SCALE

m = cv2.imread("/home/ubuntu/warroom/web/public/assets/map.jpg")
m = cv2.resize(m, (W, H), interpolation=cv2.INTER_AREA)
b, g, r = m[:,:,0].astype(int), m[:,:,1].astype(int), m[:,:,2].astype(int)
sea_mask = (b > r + 10) & (b > 70)
print(f"海像素 {sea_mask.mean()*100:.1f}%")

pos = json.load(open("/home/ubuntu/warroom/extracted/territory_positions.json"))
data = json.load(open("/home/ubuntu/warroom/extracted/territories_full.json"))
by = {x["code"]: x for x in data}
codes = [c for c in pos]
idx = {c:i for i,c in enumerate(codes)}
N = len(codes)
seeds = np.array([[pos[c]["x"]*W, pos[c]["y"]*H] for c in codes], dtype=np.float32)

is_sea = np.array([by[c]["type"]=="sea" for c in codes])
is_land = np.array([by[c]["type"]=="land" for c in codes])
sea_ids = np.where(is_sea)[0]
land_ids = np.where(is_land)[0]

# ---- 海域：极坐标距离 ----
CX, CY = W*0.5, H*0.5
gy, gx = np.mgrid[0:H, 0:W]
# 每个像素的极坐标
pr = np.hypot(gx-CX, gy-CY)
pth = np.arctan2(gy-CY, gx-CX)

# 海域种子极坐标
sea_seed_r = np.array([math.hypot(pos[codes[i]]["x"]*W-CX, pos[codes[i]]["y"]*H-CY) for i in sea_ids])
sea_seed_th= np.array([math.atan2(pos[codes[i]]["y"]*H-CY, pos[codes[i]]["x"]*W-CX) for i in sea_ids])

lab = np.full((H, W), -1, np.int16)
dist = np.full((H, W), np.inf, np.float32)

# 海域像素分配（极坐标距离）
ys, xs = np.where(sea_mask)
PRr = pr[ys, xs]; PTH = pth[ys, xs]
best = np.full(len(ys), np.inf, np.float32); bi = np.zeros(len(ys), np.int16)
for k in range(len(sea_ids)):
    dr = PRr - sea_seed_r[k]
    dth = np.abs(PTH - sea_seed_th[k]); dth = np.minimum(dth, 2*np.pi-dth)
    d2 = dr*dr + (PRr*dth)**2
    upd = d2 < best
    best[upd] = d2[upd]; bi[upd] = k
lab[ys, xs] = sea_ids[bi]
print("海域分配完成")

# ---- 陆地：欧氏最近 + 拓扑松弛 ----
# 先欧氏
land_mask = (~sea_mask) & ((r+g+b) < 720)   # 排除白线
ys, xs = np.where(land_mask)
flat = np.stack([xs, ys],1).astype(np.float32)
best = np.full(len(ys), np.inf, np.float32); bi = np.zeros(len(ys), np.int16)
for s0 in range(0, len(land_ids), 40):
    sub = land_ids[s0:s0+40]
    d2 = ((flat[:,None,:]-seeds[None,sub,:])**2).sum(2)
    am = d2.argmin(1); dm = d2[np.arange(len(ys)), am]
    upd = dm < best
    best[upd]=dm[upd]; bi[upd]=(s0+am[upd])
lab[ys, xs] = land_ids[bi]
print("陆地欧氏分配完成")

# 统计
print("已分配像素:", (lab>=0).mean()*100, "%")

np.save(f"/tmp/blocks_v2_{SCALE}.npy", lab)
np.save(f"/tmp/seamask_{SCALE}.npy", sea_mask)

# 可视化
rng = np.random.default_rng(7)
pal = rng.integers(50,235,size=(N,3),dtype=np.uint8)
vis = np.zeros((H,W,3), np.uint8)
vis[lab>=0] = pal[lab[lab>=0]]
cv2.imwrite(f"/tmp/blocks_v2_{SCALE}.png", cv2.resize(vis,(1000,1000),interpolation=cv2.INTER_NEAREST))
print("saved")
