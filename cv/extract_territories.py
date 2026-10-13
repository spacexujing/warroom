#!/usr/bin/env python3
"""从原站 bundle 提取完整地块/海域数据库（含 adjacentTo 相邻关系）。

bundle 里每条记录形如：
  {code:"B1",name:"Great Britain",type:"land",stratValue:8,
   resources:{oil:0,iron:1,osr:2},embattledResources:{...},
   industrySlotsTotal:8,hasPort:!0,hasRailroad:!0,isCapital:!0,
   startingOwner:"britain",adjacentTo:["A6","A7","N9"]}
（!0/!1 是 true/false 的压缩写法）

输出: extracted/territories_full.json
"""
import re, json

SRC = "/home/ubuntu/warroom/site/index-BtF6H2JA.js"
js = open(SRC, encoding="utf-8", errors="replace").read()

# 找每条记录：从 {code:"XX" 开始，到相邻数组结束（"adjacentTo":[...]}）
# 用非贪婪匹配，尽量吃完整条对象。
rec_re = re.compile(
    r'\{code:"(?P<code>[^"]+)"(?P<body>.*?adjacentTo:\[(?P<adj>[^\]]*)\])',
    re.S,
)

def parse_val(v):
    v = v.strip()
    if v == "!0": return True
    if v == "!1": return False
    if v.startswith('"') and v.endswith('"'): return v[1:-1]
    try:
        return int(v)
    except ValueError:
        try:
            return float(v)
        except ValueError:
            return v

def parse_resources(s):
    # 形如 {oil:0,iron:1,osr:2}
    out = {}
    for k, v in re.findall(r'(\w+):([\-\d.]+)', s):
        out[k] = parse_val(v)
    return out

records = []
for m in rec_re.finditer(js):
    code = m.group("code")
    body = m.group("body")
    adj_raw = m.group("adj")
    # 解析 body 内各字段
    rec = {"code": code}
    for field, val in re.findall(r'(\w+):(\{.*?\}|"[^"]*"|!?[\d.]+)', body):
        if field == "resources":
            rec["resources"] = parse_resources(val)
        elif field == "embattledResources":
            rec["embattledResources"] = parse_resources(val)
        elif field in ("code",):
            continue
        else:
            rec[field] = parse_val(val)
    rec["adjacentTo"] = [a.strip().strip('"') for a in adj_raw.split(",") if a.strip()]
    records.append(rec)

# 去重（同 code 可能因嵌套匹配出现多次，保留字段最全的那条）
by_code = {}
for r in records:
    c = r["code"]
    if c not in by_code or len(r) > len(by_code[c]):
        by_code[c] = r

out = sorted(by_code.values(), key=lambda r: r["code"])
with open("/home/ubuntu/warroom/extracted/territories_full.json", "w", encoding="utf-8") as f:
    json.dump(out, f, ensure_ascii=False, indent=1)

print(f"提取到 {len(out)} 条记录")
print("字段示例:", json.dumps(out[0], ensure_ascii=False))
land = [r for r in out if r.get("type") == "land"]
sea  = [r for r in out if r.get("type") == "sea"]
print(f"  land={len(land)} sea={len(sea)}")
# 统计相邻条数
tot_adj = sum(len(r["adjacentTo"]) for r in out)
print(f"  相邻关系总数(单向): {tot_adj}")
