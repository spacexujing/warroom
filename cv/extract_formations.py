#!/usr/bin/env python3
"""提取全部初始编成 (Iv 数组) —— 每个番号的 国家/地块/域/编号/单位清单。
格式: {id:53,domain:"land",nation:"britain",territory:"B1",units:{armor:1,artillery:1,infantry:1}}
输出: extracted/initial_formations.json
"""
import re, json

js = open("/home/ubuntu/warroom/site/index-BtF6H2JA.js", encoding="utf-8", errors="replace").read()

# 定位 Iv=[ ... ] 的完整区间
start = js.find("Iv=[{id:")
assert start > 0, "未找到 Iv 数组"
depth = 0; j = start + 3
while j < len(js):
    c = js[j]
    if c == "[": depth += 1
    elif c == "]":
        depth -= 1
        if depth == 0: break
    j += 1
arr = js[start+3:j+1]   # 含外层 [ ]
print(f"数组长度: {len(arr)} 字符")

# 解析每个 {id:..,domain:..,nation:..,territory:..,units:{...}}
item_re = re.compile(
    r'\{id:(\d+),domain:"(\w+)",nation:"(\w+)",territory:"([^"]+)",units:\{([^}]*)\}\}'
)
recs = []
for m in item_re.finditer(arr):
    fid, domain, nation, terr, units_s = m.groups()
    units = {}
    for k, v in re.findall(r'(\w+):(\d+)', units_s):
        units[k] = int(v)
    recs.append({
        "id": int(fid), "domain": domain, "nation": nation,
        "territory": terr, "units": units,
        "unitCount": sum(units.values()),
    })

print(f"提取到 {len(recs)} 条编成")
json.dump(recs, open("/home/ubuntu/warroom/extracted/initial_formations.json","w",encoding="utf-8"),
          ensure_ascii=False, indent=1)

# 统计
import collections
print("\n按国家:")
for n, c in collections.Counter(r["nation"] for r in recs).most_common():
    tot = sum(r["unitCount"] for r in recs if r["nation"]==n)
    print(f"  {n:9s} 编成{c:3d}个  单位{tot:4d}个")
print("\n按域:")
for d, c in collections.Counter(r["domain"] for r in recs).most_common():
    print(f"  {d:6s} {c}")
print("\n单位种类:", collections.Counter(
    u for r in recs for u in r["units"]).most_common())

# 抽样
print("\n前 5 条:", json.dumps(recs[:5], ensure_ascii=False))
