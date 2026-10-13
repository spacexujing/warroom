#!/usr/bin/env python3
"""对比普通 Voronoi 与拓扑松弛的边界差异，并把 topo 边界叠到真地图上。"""
import numpy as np, cv2, json

plain = np.load("/tmp/vor_plain_4.npy")
topo  = np.load("/tmp/vor_topo_4.npy")
H, W = plain.shape

def edges(lab):
    d = np.zeros((H,W),bool)
    d[:,1:] |= lab[:,1:]!=lab[:,:-1]
    d[1:,:] |= lab[1:,:]!=lab[:-1,:]
    return d

ep, et = edges(plain), edges(topo)
comb = np.full((H,W,3),255,np.uint8)
comb[ep] = [0,0,255]      # 红=普通voronoi边界
comb[et] = [0,150,0]      # 绿=拓扑松弛边界
comb[ep & et] = [0,0,0]   # 黑=两者重合
cv2.imwrite("/tmp/edges_compare.png", cv2.resize(comb,(1000,1000),interpolation=cv2.INTER_NEAREST))

m = cv2.resize(cv2.imread("/home/ubuntu/warroom/web/public/assets/map.jpg"),(W,H))
out = m.copy()
out[et] = [0,255,0]
cv2.imwrite("/tmp/topo_on_map.png", cv2.resize(out,(1100,1100),interpolation=cv2.INTER_AREA))
print("saved")
