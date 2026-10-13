#!/usr/bin/env python3
"""裁剪 J25 区域附近，放大保存，便于人工核对排布。"""
import cv2, numpy as np, json

img = cv2.imread("/tmp/j25_zoom.png")
H, W = img.shape[:2]
print("shot size", W, H)
# 裁中心区域
crop = img[int(H*0.2):int(H*0.8), int(W*0.25):int(W*0.75)]
cv2.imwrite("/tmp/j25_crop.png", cv2.resize(crop, (crop.shape[1]*2, crop.shape[0]*2), interpolation=cv2.INTER_NEAREST))
print("saved /tmp/j25_crop.png", crop.shape)
