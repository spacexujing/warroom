#!/usr/bin/env python3
"""生成三张对比图，供人工判断：
  1. plain_on_map  — 普通 Voronoi 边界叠真地图
  2. topo_on_map   — 拓扑松弛边界叠真地图
  3. side_by_side  — 左普通 / 右拓扑（同尺度）
"""
import numpy as np, cv2, json

plain = np.load("/tmp/vor_plain_4.npy")
topo  = np.load("/tmp/vor_topo_4.npy")
H, W = plain.shape

def edges(lab):
    d = np.zeros((H,W),bool)
    d[:,1:] |= lab[:,1:]!=lab[:,:-1]
    d[1:,:] |= lab[1:,:]!=lab[:-1,:]
    return d

m = cv2.resize(cv2.imread("/home/ubuntu/warroom/web/public/assets/map.jpg"),(W,H))
ep, et = edges(plain), edges(topo)

o1 = m.copy(); o1[ep] = [0,90,255]
o2 = m.copy(); o2[et] = [0,255,60]
cv2.imwrite("/tmp/plain_on_map.png", cv2.resize(o1,(1100,1100),interpolation=cv2.INTER_AREA))
cv2.imwrite("/tmp/topo_on_map.png",  cv2.resize(o2,(1100,1100),interpolation=cv2.INTER_AREA))

sbs = np.concatenate([o1, np.full((H,8,3),255,np.uint8), o2], axis=1)
cv2.imwrite("/tmp/side_by_side.png", cv2.resize(sbs,(1500,int(1500*H/(2*W+8))),interpolation=cv2.INTER_AREA))
print("saved three images")
