#!/usr/bin/env python3
"""生成前端用的单位数据文件。
输入: extracted/initial_formations.json (番号编成) + web/public/data_positions.json (坐标)
输出: web/public/units.json —— 每个番号一条，含区域坐标与番号图名
"""
import json

recs = json.load(open("/home/ubuntu/warroom/extracted/initial_formations.json"))
pos  = json.load(open("/home/ubuntu/warroom/web/public/data_positions.json"))
terr = {r["code"]: r for r in json.load(open("/home/ubuntu/warroom/extracted/territories_full.json"))}

NATION_MAP = {"britain":"Britain","germany":"Germany","japan":"Japan",
              "usa":"USA","soviet":"Soviet","italy":"Italy","china":"China"}
DOMAIN_MAP = {"land":"Land","air":"Air","sea":"Sea"}
ALLIANCE = {"germany":"axis","italy":"axis","japan":"axis",
            "britain":"allied","soviet":"allied","usa":"allied","china":"allied"}

units = []
missing_pos = []
for r in recs:
    code = r["territory"]
    p = pos.get(code)
    if not p:
        missing_pos.append(code)
        continue
    face = f"{NATION_MAP[r['nation']]}_{DOMAIN_MAP[r['domain']]}_{r['id']}.png"
    units.append({
        "id": f"{r['nation']}-{r['domain']}-{r['id']}",
        "nation": r["nation"],
        "alliance": ALLIANCE[r["nation"]],
        "domain": r["domain"],
        "num": r["id"],
        "code": code,
        "face": face,
        "units": r["units"],           # {infantry:2, artillery:1, ...}
        "unitCount": r["unitCount"],
    })

json.dump(units, open("/home/ubuntu/warroom/web/public/units.json","w",encoding="utf-8"),
          ensure_ascii=False, indent=1)

print(f"生成 {len(units)} 个番号")
if missing_pos:
    print(f"⚠️ 缺坐标的番号 {len(missing_pos)} 个:", set(missing_pos))
print("样例:", json.dumps(units[0], ensure_ascii=False))

# 按区域统计
import collections
byc = collections.Counter(u["code"] for u in units)
multi = {c:n for c,n in byc.items() if n>1}
print(f"\n有多个番号的区域 {len(multi)} 个（最多 {max(byc.values())} 个）:")
for c,n in sorted(multi.items(), key=lambda x:-x[1])[:12]:
    print(f"  {c}: {n} 个番号")
