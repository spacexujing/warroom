#!/usr/bin/env python3
"""检查：地块坐标点是否落在地块形状内 / 是否是其视觉中心。
方法：在 G1 坐标点周围画个十字，叠到地图上，看看是否在德国领土中间。
"""
import cv2, json

m = cv2.imread("/home/ubuntu/warroom/web/public/assets/map.jpg")
H, W = m.shape[:2]
pos = json.load(open("/home/ubuntu/warroom/web/public/data_positions.json"))

# 裁德国附近，画十字
crop_box = (int(0.15*W), int(0.42*H), int(0.42*W), int(0.68*H))  # x1,y1,x2,y2
x1,y1,x2,y2 = crop_box
crop = m[y1:y2, x1:x2].copy()

for code in ["G1","G2","G3","G4","G5","G6","G7","G8","G9","G10"]:
    p = pos[code]
    px = int(p["x"]*W) - x1
    py = int(p["y"]*H) - y1
    if 0<=px<crop.shape[1] and 0<=py<crop.shape[0]:
        cv2.drawMarker(crop, (px,py), (0,0,255), cv2.MARKER_CROSS, 30, 3)
        cv2.putText(crop, code, (px+12,py-12), cv2.FONT_HERSHEY_SIMPLEX, 1.0, (0,0,255), 2)

crop = cv2.resize(crop, (crop.shape[1]*2, crop.shape[0]*2), interpolation=cv2.INTER_AREA)
cv2.imwrite("/tmp/coord_check.png", crop)
print("saved /tmp/coord_check.png", crop.shape)
