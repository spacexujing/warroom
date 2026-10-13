#!/usr/bin/env python3
"""生成完整番号清单（全部素材番号，按国家/域），供前端计算"剩余番号"。
输出: web/public/formations_all.json
  { "<nation>": { "air": [11,12,...], "sea": [...], "land": [...] }, ... }
"""
import os, re, json, collections

assets = os.listdir("/home/ubuntu/warroom/assets")
NAT_REV = {"Britain":"britain","Germany":"germany","Japan":"japan",
           "USA":"usa","Soviet":"soviet","Italy":"italy","China":"china"}
DOM_REV = {"Land":"land","Air":"air","Sea":"sea"}

out = collections.defaultdict(lambda: collections.defaultdict(list))
for fn in assets:
    m = re.match(r'(Britain|Germany|Japan|USA|Soviet|Italy|China)_(Land|Air|Sea)_(\d+)\.png$', fn)
    if m:
        out[NAT_REV[m.group(1)]][DOM_REV[m.group(2)]].append(int(m.group(3)))

final = {}
for nation, doms in out.items():
    final[nation] = {d: sorted(v) for d, v in doms.items()}

json.dump(final, open("/home/ubuntu/warroom/web/public/formations_all.json","w",encoding="utf-8"),
          ensure_ascii=False, indent=1)
print("生成 formations_all.json:")
for n in sorted(final):
    s = "  ".join(f"{d}({len(v)})" for d, v in final[n].items())
    print(f"  {n}: {s}")
