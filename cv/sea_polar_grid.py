#!/usr/bin/env python3
"""从海域地块坐标推导极坐标网格：找出所有 r 分界（圆弧）和 角度分界（径线）。

思路：
- 海域地块坐标 (r, a) 已知。若海域是极坐标网格，则：
  · 每个"角度分界"= 相邻两地块角度的中点，且该处的径线切分
  · 每个"半径分界"= 相邻两地块半径的中点，且该处的圆弧切分
- 但更稳的做法：只把「陆海交接」和「海海相邻」的拓扑用于判定。
- 简化：既然海域本身近似极坐标网格，直接用「每个像素找最近海域坐标（极坐标距离）」，
  并同时叠加拓扑约束（只在相邻海域间允许接触）。

先做诊断：海域坐标 (r,a) 是否落在规整网格上。
"""
import json, math, numpy as np

pos = json.load(open("/home/ubuntu/warroom/extracted/territory_positions.json"))
data = json.load(open("/home/ubuntu/warroom/extracted/territories_full.json"))
by = {r["code"]: r for r in data}
CX, CY = 0.5, 0.5

def polar(code):
    p = pos[code]; dx,dy = p["x"]-CX, p["y"]-CY
    return math.hypot(dx,dy), math.degrees(math.atan2(dy,dx)) % 360

sea = [r["code"] for r in data if r["type"]=="sea" and r["code"] in pos]
land= [r["code"] for r in data if r["type"]=="land" and r["code"] in pos]

# 海域半径分布（排序看是否有"环"）
rs = sorted((polar(c)[0], c) for c in sea)
print("=== 海域半径分布（升序）===")
for r, c in rs:
    print(f"  {r:.3f}  {c}  {by[c]['name']}")

# 角度分布
print("\n=== 海域角度分布（升序）===")
angs = sorted((polar(c)[1], c) for c in sea)
for a, c in angs:
    print(f"  {a:6.1f}°  {c}")

# 看看半径是否有"环"结构：把半径聚类
print("\n=== 也看陆地半径范围（用于分环）===")
lr = sorted(polar(c)[0] for c in land)
print(f"  陆地 r: min={lr[0]:.3f} max={lr[-1]:.3f}")
