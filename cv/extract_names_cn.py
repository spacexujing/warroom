#!/usr/bin/env python3
"""提取地块中文名映射 { code: 中文名 }。
bundle 里有一段 "...C5:\"新疆\",G1:\"大德意志\",..." 的映射。
输出: web/public/territory_names_cn.json
"""
import re, json

js = open("/home/ubuntu/warroom/site/index-BtF6H2JA.js", encoding="utf-8", errors="replace").read()

# 找同时包含 G1:"大德意志" 与 R1:"莫斯科" 的映射段
# 定位 "G1":"大德意志" (用中文锚点)
idx = js.find('G1:"大德意志"')
print("anchor idx:", idx)
# 向前后扩展，提取一段 code:"中文" 对
# 向前找最近的 '{'
start = js.rfind("{", 0, idx)
# 向后找匹配 '}'
depth = 0; j = start
while j < len(js):
    if js[j] == "{": depth += 1
    elif js[j] == "}":
        depth -= 1
        if depth == 0: break
    j += 1
segment = js[start:j+1]
print("segment len:", len(segment))

# 提取 code:"中文"
pairs = re.findall(r'([A-Z]+\d+):"([\u4e00-\u9fff（）()A-Za-z0-9·\s]+)"', segment)
mapping = {}
for code, name in pairs:
    mapping[code] = name

print("提取对数:", len(mapping))
json.dump(mapping, open("/home/ubuntu/warroom/web/public/territory_names_cn.json","w",encoding="utf-8"),
          ensure_ascii=False, indent=1)
# 抽样
for c in ["G1","R1","J4","B1","U1","T1","J1","C1","A5","P1"]:
    print(f"  {c}: {mapping.get(c)}")
