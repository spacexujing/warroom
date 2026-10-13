#!/usr/bin/env python3
"""裁剪右侧行动面板，放大保存供核对。"""
import cv2, sys
img = cv2.imread(sys.argv[1] if len(sys.argv)>1 else "/tmp/unit_panel.png")
H, W = img.shape[:2]
# 右侧 35%
crop = img[:, int(W*0.63):]
cv2.imwrite("/tmp/panel_crop.png", crop)
print("saved /tmp/panel_crop.png", crop.shape)
