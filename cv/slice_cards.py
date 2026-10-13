#!/usr/bin/env python3
"""
切分地块卡拼版图 -> 单张卡 PNG + 生成 cards.json 映射。

拼版规则（用户确认）：
  · 使用 *_land_{front,back}_cn.jpg
  · 单卡尺寸 = 493 x 347（由最小的 Italy 图 1479x694 / 3x2 得出）
  · 每国左上角 = 该国 1 号，向右递增，满一行换下一行
  · 卡号 = 地块编号数字（G1..G18），与国家前缀组合

输出：
  web/public/cards/<Nation>_<num>_front.png   （正面）
  web/public/cards/<Nation>_<num>_back.png    （背面）
  web/public/cards.json                        （索引）
"""
import json
import os
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
ASSETS = os.path.join(HERE, "..", "web", "public", "assets")
OUT = os.path.join(HERE, "..", "web", "public", "cards")
os.makedirs(OUT, exist_ok=True)

CARD_W, CARD_H = 493, 347

# 拼版文件名前缀 -> (国家key, 地块前缀字母)
SHEETS = {
    "Britain": ("britain", "B"),
    "Germany": ("germany", "G"),
    "Japan":   ("japan",   "J"),
    "USA":     ("usa",     "U"),
    "Soviet":  ("soviet",  "R"),
    "Italy":   ("italy",   "T"),
    "China":   ("china",   "C"),
    "Neutral": ("neutral", "N"),
}


def slice_sheet(path, prefix, nation):
    """切分一张拼版图，返回 [{num, code, file}]"""
    im = Image.open(path).convert("RGB")
    W, H = im.size
    cols = round(W / CARD_W)
    rows = round(H / CARD_H)
    # 边界校验
    assert abs(cols * CARD_W - W) <= 2 and abs(rows * CARD_H - H) <= 2, \
        f"{path}: {W}x{H} 不能被 {CARD_W}x{CARD_H} 整除 ({cols}x{rows})"
    out = []
    for idx in range(cols * rows):
        r, c = divmod(idx, cols)
        box = (c * CARD_W, r * CARD_H, (c + 1) * CARD_W, (r + 1) * CARD_H)
        num = idx + 1
        code = f"{prefix}{num}"
        out.append({"num": num, "code": code, "row": r, "col": c, "box": box,
                    "cols": cols, "rows": rows})
    return out, im, cols, rows


def main():
    index = {}
    for sheet, (nation, prefix) in SHEETS.items():
        fpath = os.path.join(ASSETS, f"{sheet}_land_front_cn.jpg")
        bpath = os.path.join(ASSETS, f"{sheet}_land_back_cn.jpg")
        if not os.path.exists(fpath):
            print(f"[跳过] 缺文件 {fpath}")
            continue
        fmeta, fim, cols, rows = slice_sheet(fpath, prefix, nation)
        bmeta = None
        if os.path.exists(bpath):
            bmeta, bim, _, _ = slice_sheet(bpath, prefix, nation)
        index[nation] = {
            "prefix": prefix, "cols": cols, "rows": rows,
            "count": len(fmeta), "cards": [],
        }
        for i, m in enumerate(fmeta):
            num = m["num"]
            fn = f"{sheet}_{num}_front.png"
            fim.crop(m["box"]).save(os.path.join(OUT, fn))
            rec = {"num": num, "code": m["code"],
                   "row": m["row"], "col": m["col"],
                   "front": fn}
            if bmeta:
                bn = f"{sheet}_{num}_back.png"
                bim.crop(bmeta[i]["box"]).save(os.path.join(OUT, bn))
                rec["back"] = bn
            index[nation]["cards"].append(rec)
        print(f"{sheet:10s} {cols}x{rows} = {len(fmeta):2d} 张 "
              f"(地块前缀 {prefix}, 国家 {nation})")

    with open(os.path.join(HERE, "..", "web", "public", "cards.json"), "w") as f:
        json.dump(index, f, ensure_ascii=False, indent=1)
    total = sum(v["count"] for v in index.values())
    print(f"\n共 {total} 张卡，索引写入 web/public/cards.json")


if __name__ == "__main__":
    main()
