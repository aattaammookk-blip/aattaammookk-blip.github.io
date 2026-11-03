# -*- coding: utf-8 -*-
"""
【人相食主题总库】整篇原文导出。

输入：总库 assets/data.js 中全部记载的 file_path（原库 363 篇 ＋ 二库新增 116 篇）。
来源：素材库_原始_二十四史全库（与一库同一底本，逐字一致）。
输出：assets/texts/index.js 与 bNN.js，按史书拆分，点开才加载。
"""
import json
import os
import re
from collections import OrderedDict

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC_TEXTS = r"D:/workbuddy国内版工作空间/历史数据库-前期整理/人相食数据库_交付包/素材库_原始_二十四史全库/texts"
DST = os.path.join(ROOT, "assets", "texts")

BOOK_ORDER = ["史記", "漢書", "後漢書", "三國志", "晉書", "宋書", "南齊書", "梁書", "陳書", "魏書",
              "北齊書", "周書", "隋書", "南史", "北史", "舊唐書", "新唐書", "舊五代史", "新五代史",
              "宋史", "遼史", "金史", "元史", "明史", "清史稿"]


def main():
    s = open(os.path.join(ROOT, "assets", "data.js"), encoding="utf-8").read()
    db = json.loads(s[len("window.DB="):].strip().rstrip(";"))

    paths = []
    for e in db["events"]:
        for r in e["records"]:
            if r["file_path"] and r["file_path"] not in paths:
                paths.append(r["file_path"])
    for r in db["excluded"]:
        if r["file_path"] and r["file_path"] not in paths:
            paths.append(r["file_path"])

    by_book = OrderedDict()
    for p in paths:
        parts = p.split("/")
        by_book.setdefault(parts[1], []).append(p)
    order = [b for b in BOOK_ORDER if b in by_book] + [b for b in by_book if b not in BOOK_ORDER]

    os.makedirs(DST, exist_ok=True)
    for f in os.listdir(DST):
        if f.endswith(".js"):
            os.remove(os.path.join(DST, f))

    files = OrderedDict()
    total = 0
    for idx, book in enumerate(order, start=1):
        fid = "b%02d" % idx
        files[book] = fid
        chunks = ["window.TEXTS=window.TEXTS||{};"]
        for p in sorted(by_book[book]):
            parts = p.split("/")
            body = open(os.path.join(SRC_TEXTS, parts[1], parts[2]), encoding="utf-8").read()
            chunks.append("window.TEXTS[%s]=%s;" % (
                json.dumps(p, ensure_ascii=False), json.dumps(body, ensure_ascii=False)))
        js = "".join(chunks)
        with open(os.path.join(DST, fid + ".js"), "w", encoding="utf-8", newline="\n") as f:
            f.write(js)
        total += len(js.encode("utf-8"))
        print("%-5s %-10s %3d 篇 %7.1f KB" % (fid, book, len(by_book[book]), len(js.encode("utf-8")) / 1024))

    idx_js = "window.TEXT_FILES=" + json.dumps(files, ensure_ascii=False, separators=(",", ":")) + ";"
    with open(os.path.join(DST, "index.js"), "w", encoding="utf-8", newline="\n") as f:
        f.write(idx_js)

    print("---")
    print("共 %d 部、%d 篇，合计 %.2f MB" % (len(order), len(paths), total / 1048576))


if __name__ == "__main__":
    main()
