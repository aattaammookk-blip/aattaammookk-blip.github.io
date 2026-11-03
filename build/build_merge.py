# -*- coding: utf-8 -*-
"""
【人相食主题总库】数据合并脚本（2026-11-03）

只读：原库 assets/data.js、assets/places.js；二库 data.json；素材库原文。
写出：总库 assets/data.js、assets/places.js、build/merge_report.json。

合并口径（详见 docs/09_二库并入说明.md）：
  1. 原库 201 事件 / 311 记载 / 210 排除材料原样保留，仅向 14 个宿主事件追加二库挂靠记载。
  2. 二库 61 事件中，EV2017 与一库 EV0044 同篇同句，剔除；EV2049 与一库 EV0110 同
     一事而异书，降为挂靠记载。其余 59 条并入，编号沿用 EV2001–EV2061。
  3. 二库 21 条挂靠记载全部并入宿主事件；另将 EV2049 的记载转为 EV0110 挂靠（共 22 条）。
  4. 二库史书名为繁体，统一改为一库简体书名（旧唐书、新唐书、旧五代史……）。
  5. 二库 30 条排除材料的句位只锚定 2–4 字关键词（割股类），按底本扩为整句；
     其中 3 条锚点错位（刘泽清、洪氏、皆农家）按原文重锚，刘泽清并由「割股类」
     改归「毁尸·刑罚」。
  6. 全部二库记载的 full / hs / he / full_sim / pua 依一库同一算法从底本重算，
     保证「史料卡」显示的是底本原文段落，而非二手过渡文本。
  7. 地点索引、人物索引、meta 统计全部按合并后事件重算。
"""
import json
import os
import re
import sys
from collections import Counter, OrderedDict

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))   # 总库/
BASE = os.path.dirname(ROOT)                                        # 工作区（原库根）
ORIG_DB = os.path.join(BASE, "assets", "data.js")
ORIG_PLACES = os.path.join(BASE, "assets", "places.js")
KU2 = os.path.join(BASE, "二库", "data.json")
SRC_TEXTS = r"D:/workbuddy国内版工作空间/历史数据库-前期整理/人相食数据库_交付包/素材库_原始_二十四史全库/texts"
OUT_DB = os.path.join(ROOT, "assets", "data.js")
OUT_PLACES = os.path.join(ROOT, "assets", "places.js")
REPORT = os.path.join(ROOT, "build", "merge_report.json")

# ---------------------------------------------------------------- 基础工具

def load_js_json(path, marker):
    s = open(path, encoding="utf-8").read()
    i = s.index(marker) + len(marker)
    # 截到下一个 "\nwindow." 或结尾
    j = s.find("\nwindow.", i)
    body = s[i:j] if j > 0 else s[i:]
    return json.loads(body.strip().rstrip(";"))


ORIG = load_js_json(ORIG_DB, "window.DB=")
ORIG_GEO = load_js_json(ORIG_PLACES, "window.PLACE_GEO=")
ORIG_EPL = load_js_json(ORIG_PLACES, "window.EVENT_PLACE=")
ORIG_EPLS = load_js_json(ORIG_PLACES, "window.EVENT_PLACES=")
K2 = json.load(open(KU2, encoding="utf-8"))

_TEXTS = {}
def src_text(path):
    if path not in _TEXTS:
        parts = path.split("/")
        _TEXTS[path] = open(os.path.join(SRC_TEXTS, parts[1], parts[2]), encoding="utf-8").read()
    return _TEXTS[path]


def clean_para(p):
    p = p.replace("\u3000", " ")
    p = re.sub(r"[ \t]+", " ", p)
    return p.strip("\n").strip()


def para_bounds(text, a, b, maxlen=1200):
    """与一库 build_data.py 完全一致"""
    ps = text.rfind("\n", 0, a)
    ps = 0 if ps < 0 else ps + 1
    pe = text.find("\n", b)
    pe = len(text) if pe < 0 else pe
    if pe - ps <= maxlen:
        return ps, pe
    ends = "。！？；"
    k, cnt = a, 0
    while k > 0 and cnt < 2:
        k -= 1
        if text[k] in ends:
            cnt += 1
    s2 = k + 1 if cnt else 0
    k2, cnt = b, 0
    while k2 < len(text) and cnt < 1:
        if text[k2] in ends:
            cnt += 1
        k2 += 1
    e2 = k2 if cnt else len(text)
    if e2 - s2 > maxlen * 2:
        s2, e2 = max(0, a - 300), min(len(text), b + 300)
    return s2, e2


try:
    from opencc import OpenCC
    _CC = OpenCC("t2s")
except Exception:
    _CC = None


def rebuild_full(rec, stats):
    """按底本重算 full / hs / he / full_sim / pua，返回是否改写"""
    t = src_text(rec["file_path"])
    a, b = int(rec["sent_start"]), int(rec["sent_end"])
    ps, pe = para_bounds(t, a, b)
    raw = t[ps:pe]
    full = clean_para(raw)
    lead = len(raw) - len(raw.lstrip("\n"))
    anchor = t[a:b]
    # 规范化可能压缩空白，先按预期位置落点，再在 ±40 字内校正
    hs = a - ps - lead
    pos = full.find(anchor, max(0, hs - 40)) if anchor else -1
    if pos >= 0 and pos <= hs + 40:
        hs = pos
    he = hs + len(anchor)
    if not (0 <= hs < he <= len(full)) or full[hs:he] != anchor:
        stats["full_unaligned"].append([rec.get("_who", ""), rec["book"], rec["pian"], a, b])
        hs, he = max(0, min(hs, len(full))), max(0, min(he, len(full)))
    rec["full"] = full
    rec["hs"] = hs
    rec["he"] = he
    rec["full_sim"] = _CC.convert(full) if _CC else ""
    rec["pua"] = sum(1 for ch in full if 0xE000 <= ord(ch) <= 0xF8FF)


def sentence_bounds(t, a, b):
    ends = "。！？"
    s = a
    while s > 0 and t[s - 1] not in ends and t[s - 1] != "\n":
        s -= 1
    while s < a and t[s] in " \u3000":
        s += 1
    e = b
    while e < len(t) and t[e - 1] not in ends and t[e] != "\n":
        e += 1
    return s, e


# ---------------------------------------------------------------- 史书名归一

BOOK_SIMP = {
    "舊五代史": "旧五代史", "舊唐書": "旧唐书", "新唐書": "新唐书", "北齊書": "北齐书",
    "隋書": "隋书", "梁書": "梁书", "宋書": "宋书", "後漢書": "后汉书", "晉書": "晋书",
    "遼史": "辽史", "史記": "史记", "漢書": "汉书", "三國志": "三国志", "魏書": "魏书",
    "周書": "周书", "陳書": "陈书", "南齊書": "南齐书",
}
for b in ["元史", "北史", "南史", "宋史", "明史", "金史", "清史稿", "新五代史"]:
    BOOK_SIMP[b] = b


def simp_book(b):
    return BOOK_SIMP.get(b, b)


# ---------------------------------------------------------------- 新地点定位表
# name: (今地, 经度, 纬度, 精度, 说明, 区域, 层级)

GEO_NEW = {
    "东郡": ("河南濮阳", 115.03, 35.76, "county", "秦汉东郡治濮阳", "河洛", "州县"),
    "中原": ("黄河中下游平原", 113.60, 34.60, "region", "泛称，取示意中心", "通语", "区域"),
    "中都": ("北京", 116.40, 39.90, "county", "金中都", "河北", "州县"),
    "云南": ("云南中部（昆明一带）", 102.70, 25.05, "region", "元代云南行省，取示意中心", "巴蜀", "区域"),
    "八番": ("贵州惠水一带", 106.65, 26.13, "region", "元代八番顺元宣慰司", "巴蜀", "区域"),
    "信州": ("江西上饶", 117.97, 28.45, "county", "元信州路治上饶", "江南", "州县"),
    "卫州": ("河南卫辉", 114.06, 35.40, "county", "唐宋卫州治汲县", "河洛", "州县"),
    "卫辉": ("河南卫辉", 114.06, 35.40, "county", "元卫辉路治汲县", "河洛", "州县"),
    "古田": ("福建古田", 118.75, 26.58, "county", "", "江南", "州县"),
    "叱日岭": ("河北井陉县微水镇西青泉岭", 114.10, 38.03, "county", "即赤日岭，今河北井陉县微水镇西青泉岭", "河北", "州县"),
    "合州": ("重庆合川", 106.28, 30.00, "county", "唐宋合州治石镜", "巴蜀", "州县"),
    "同州": ("陕西大荔", 109.94, 34.80, "county", "唐宋同州治冯翊", "关中", "州县"),
    "华州": ("陕西华县", 109.76, 34.51, "county", "唐宋华州治郑县", "关中", "州县"),
    "嘉州": ("四川乐山", 103.76, 29.58, "county", "唐宋嘉州治龙游", "巴蜀", "州县"),
    "大藤峡": ("广西桂平", 110.08, 23.40, "region", "黔江大藤峡，明代瑶乱要地", "岭南", "区域"),
    "宁晋": ("河北宁晋", 114.92, 37.62, "county", "", "河北", "州县"),
    "安庆": ("安徽安庆", 117.05, 30.52, "county", "宋安庆府", "江淮", "州县"),
    "宣威城": ("青海西宁湟中一带", 101.78, 36.62, "county", "宋湟州宣威城", "陇右", "州县"),
    "建业": ("江苏南京", 118.78, 32.06, "county", "六朝建业", "江南", "州县"),
    "开封": ("河南开封", 114.31, 34.80, "county", "", "河洛", "州县"),
    "成都": ("四川成都", 104.07, 30.57, "county", "", "巴蜀", "州县"),
    "新会": ("广东新会", 113.03, 22.46, "county", "", "岭南", "州县"),
    "朗州": ("湖南常德", 111.69, 29.03, "county", "唐宋朗州治武陵", "荆楚", "州县"),
    "永从": ("贵州黎平县永从镇", 109.05, 25.95, "county", "古县名，明永从县治今贵州黎平县永从镇", "巴蜀", "州县"),
    "汝州": ("河南汝州", 112.84, 34.17, "county", "唐宋汝州治梁县（今汝州）", "河洛", "州县"),
    "浑春": ("吉林珲春", 130.37, 42.86, "county", "「浑春」即珲春", "塞北", "州县"),
    "淮安": ("江苏淮安", 119.02, 33.60, "county", "宋元淮安州／路，明清淮安府", "江淮", "州县"),
    "龙溪": ("福建漳州", 117.65, 24.51, "county", "唐以来龙溪县为漳州治", "江南", "州县"),
    "真定": ("河北正定", 114.57, 38.15, "county", "唐宋真定府／元真定路", "河北", "州县"),
    "秦州": ("甘肃天水", 105.72, 34.58, "county", "唐宋秦州治成纪", "陇右", "州县"),
    "缙云": ("浙江缙云", 120.09, 28.66, "county", "唐缙云县属处州", "江南", "州县"),
    "舒州": ("安徽潜山", 116.58, 30.63, "county", "唐宋舒州治怀宁（今潜山）", "江淮", "州县"),
    "即墨": ("山东即墨", 120.45, 36.39, "county", "即墨县", "齐鲁", "州县"),
    "海盐": ("浙江海盐", 120.95, 30.53, "county", "海盐县", "江南", "州县"),
    "并州": ("山西太原", 112.55, 37.87, "county", "并州治晋阳（今太原）", "河东", "州县"),
    "甘肃": ("甘肃（兰州一带）", 103.80, 36.00, "region", "取示意中心", "陇右", "区域"),
    "邺": ("河北临漳", 114.62, 36.35, "county", "邺城", "河北", "州县"),
    "郢城": ("湖北武汉武昌", 114.31, 30.55, "county", "南北朝郢州治江夏（今武汉武昌）", "荆楚", "州县"),
    "鄜州": ("陕西富县", 109.38, 35.99, "county", "唐宋鄜州治洛交", "关中", "州县"),
    "酒泉": ("甘肃酒泉", 98.49, 39.73, "county", "", "陇右", "州县"),
    "镇州": ("河北正定", 114.57, 38.15, "county", "唐镇州治真定", "河北", "州县"),
    "阆州": ("四川阆中", 105.97, 31.58, "county", "唐宋阆州治阆中", "巴蜀", "州县"),
    "阳城": ("河南登封告成", 113.03, 34.46, "county", "汉阳城县，今登封告成镇", "河洛", "州县"),
    "成皋": ("河南荥阳汜水", 113.22, 34.83, "county", "汉成皋县，今荥阳汜水镇", "河洛", "州县"),
    "项城": ("河南项城", 114.90, 33.44, "county", "", "河洛", "州县"),
    "项": ("河南沈丘", 115.07, 33.42, "county", "汉项县，今沈丘一带", "河洛", "州县"),
    "苦县": ("河南鹿邑", 115.49, 33.86, "county", "汉苦县，今鹿邑", "河洛", "州县"),
}

# 多条并列需拆分为单点的事件（与一库 place_split 同口径）
SPLIT = {
    "司、冀": ["司州", "冀州"],
    "河内、河南": ["河内", "河南"],
    "同州、华州": ["同州", "华州"],
    "关中、京兆": ["关中", "京兆"],
    "阳城、成皋": ["阳城", "成皋"],
    "项至苦县": ["项", "苦县"],
    "云南、八番": ["云南", "八番"],
}

# 地名 → 索引使用的基名（默认去括注）
NAME_FIX = {
    "京师（长安）": "长安",
    "宣威城（湟州）": "宣威城",
    "缙云（处州）": "缙云",
    "叱日岭（镇州）": "叱日岭",
    "金光门（长安）": "长安",
}

# 一库既有地名的定位订正（2026-11-03，按用户指认）
GEO_OVERRIDES = {
    "三桥": ["陕西西安三桥镇", 108.86, 34.30, "county", "今西安三桥镇"],
    "凉州": ["甘肃武威", 102.63, 37.93, "county", "凉州治姑臧（今武威）"],
}

# 事件级订正：地点、类型、人物（应用到合并后的 events，再重建地点/人物索引）
PLACE_OVERRIDES = {
    "EV2046": "金光门（长安）",   # 金光门为长安（非洛阳）城门，只保留城市
    "EV2058": "淮安",             # 原「淮安杨村桥」定为淮安
    "EV2025": "汝州",             # 原「汝州郏城」简写为汝州
    "EV2022": "即墨",             # 原「莱州即墨」简写为即墨
    "EV2057": "龙溪",             # 原「漳州龙溪」简写为龙溪
    "EV0121": "海盐",             # 原「秀州海盐」简写为海盐
}
TYPE_OVERRIDES = {
    "EV2019": "习俗仪式型",        # 石邃食尼
    "EV2040": "习俗仪式型",        # 朱有熺掠食生人
}
PERSON_OVERRIDES = {
    "EV0073": "婆多利",            # 原「林邑（国）」订正为婆多利
}
# 一库事件新增的逐地拆分（并入 EVENT_PLACES）
EV_SPLIT_ADD = {
    "EV0023": ["并州", "凉州"],     # 并凉二州 → 并州（太原）、凉州（武威）
    "EV0194": ["陕西", "甘肃"],     # 陕甘 → 陕西、甘肃
}
# 因 GEO_OVERRIDES 改变定位而需重算的一库事件
GEO_RECOMPUTE = {"EV0089"}  # 三桥（京西）

# 二库剔除与降级（理由见报告）
DROP_EVENTS = {
    "EV2017": "与一库 EV0044 同出《晋书·载记第七 石季龙下》同一句（底本 7691–7705），属重复立目",
}
DEMOTE_EVENTS = {
    "EV2049": ("EV0110", "与一库 EV0110（刘信镇许州，脔割令自食）为同一事，《旧五代史》卷一百五此条应作挂靠记载，不另立事件"),
}

PLACEHOLDER_PERSON = ("不详", "无（志体不系人）", "无（本纪不系人）", "无（城守）", "无")

stats = {"full_rewritten": 0, "full_unaligned": [], "span_fixed": [], "reclass": []}


# ---------------------------------------------------------------- 二库记载转换

def conv_record(r, seq, who):
    rec = OrderedDict()
    rec["seq"] = str(seq)
    rec["book"] = simp_book(r["book"])
    rec["pian"] = r["pian"]
    rec["pian_class"] = r.get("pian_class", "")
    rec["person"] = r.get("person", "")
    rec["year"] = r.get("year", "")
    rec["year_prec"] = r.get("year_prec", "")
    rec["year_text"] = r.get("year_text", "")
    rec["place"] = r.get("place", "")
    rec["event_place"] = r.get("event_place", r.get("place", ""))
    rec["type"] = r.get("type", "")
    rec["verdict"] = r.get("verdict", "纳入")
    rec["quote"] = r.get("quote", "")
    rec["hit_preview"] = r.get("hit_preview", "")
    rec["place_fix"] = ""
    rec["note"] = "" if r.get("note") in ("二库新增事件", "二库新增") else r.get("note", "")
    rec["audit"] = ""
    rec["explain"] = r.get("explain", "")
    rec["reason"] = r.get("reason", "")
    rec["excl_type"] = r.get("excl_type", "")
    rec["rank"] = ""
    rec["reclass"] = ""
    rec["file_path"] = r["file_path"]
    rec["sent_start"] = int(r["sent_start"])
    rec["sent_end"] = int(r["sent_end"])
    rec["full"] = ""
    rec["full_sim"] = ""
    rec["hs"] = 0
    rec["he"] = 0
    rec["pua"] = 0
    rec["_who"] = who
    if r.get("linked_event"):
        rec["linked_event"] = r["linked_event"]
    return rec


def fix_span(rec, target=None):
    """短句位扩为整句；target 给出正确锚句时先重锚"""
    t = src_text(rec["file_path"])
    a, b = rec["sent_start"], rec["sent_end"]
    old = (a, b)
    if target:
        lo = max(0, a - 3000)
        idx = t.find(target, lo)
        if idx < 0:
            idx = t.find(target)
        if idx >= 0:
            a, b = idx, idx + len(target)
    if b - a < 8 or target:
        a, b = sentence_bounds(t, a, b)
    rec["sent_start"], rec["sent_end"] = a, b
    stats["span_fixed"].append([rec.get("_who", ""), rec["book"], rec["pian"], old[0], old[1], a, b])


# ---------------------------------------------------------------- 1. 二库事件

k2_events = {e["id"]: e for e in K2["events"]}
k2_by_key = {e["key"]: e["id"] for e in K2["events"]}

new_events = []
dropped = []
for e in K2["events"]:
    if e["id"] in DROP_EVENTS:
        dropped.append([e["id"], e["place"], e["year_text"], DROP_EVENTS[e["id"]]])
        continue
    if e["id"] in DEMOTE_EVENTS:
        dropped.append([e["id"], e["place"], e["year_text"], DEMOTE_EVENTS[e["id"]][1]])
        continue
    ev = OrderedDict()
    ev["id"] = e["id"]
    ev["kind"] = "event"
    ev["year"] = e["year"] if e["year"] not in ("", None) else None
    ev["year_text"] = e["year_text"]
    ev["prec"] = e["prec"]
    ev["dynasty"] = e["dynasty"]
    ev["place"] = e["place"]
    ev["type"] = e["type"]
    ev["n_records"] = 0
    ev["n_indep"] = int(e.get("n_indep") or len(e["records"]))
    ev["main_src"] = ""
    ev["overview"] = e["overview"]
    ev["note"] = ""
    ev["audit"] = ""
    ev["rank"] = ""
    y = ev["year"]
    ev["century"] = "" if y is None else (str((y - 1) // 100 + 1) + "世纪" if y > 0 else "前" + str(((-y) - 1) // 100 + 1) + "世纪")
    ev["same_source"] = []
    ev["reclass"] = ""
    ev["records"] = [conv_record(r, i + 1, e["id"]) for i, r in enumerate(e["records"])]
    ev["_key"] = e["key"]
    new_events.append(ev)

# 二库排除材料：句位重锚与改判
# 键 (书, 篇, 原 sent_start, 人物)，值为 (正确锚句, 新类别或 None)
ANCHOR_FIX = {
    ("明史", "列傳第一百六十一", 11228, "刘泽清"): ("剜其腦及心肝", "毁尸·刑罚"),
    ("明史", "列傳第一百九十　列女二", 9645, "洪氏怀"): ("剜乳肉", None),
    ("清史稿", "列傳二百九十八", 11992, "皆农家"): ("嘗割臂", None),
    # 同篇两条记录被二库锚到同一处，按各自传文重锚（原为重复句位）
    ("清史稿", "列傳二百九十五", 10968, "林经妻"): ("經病，刲股", None),
    ("清史稿", "列傳二百九十五", 10968, "林云铭"): ("剜臂肉入藥", None),
    ("清史稿", "列傳二百九十六", 15976, "王前洛"): ("林潛刲股入藥", None),
    ("清史稿", "列傳二百九十六", 15976, "林国奎"): ("刲肝雜糜進", None),
    ("清史稿", "列傳二百九十八", 22248, "田养民"): ("年十二，母病，刲股", None),
    ("明史", "列傳第一百八十五　孝義二", 7944, "唐俨全"): ("潛割臂肉進之", None),
    ("清史稿", "列傳二百八十四", 1648, "奚缉营"): ("母病，刲臂以療", None),
}

# ---------------------------------------------------------------- 2. 挂靠记载

extras = []
for r in K2["extras"]:
    tgt = r["linked_event"]
    if tgt not in k2_events:
        tgt = k2_by_key.get(tgt, tgt)
    extras.append((tgt, r))

# EV2049 由事件降为挂靠
e2049 = k2_events["EV2049"]
for r in e2049["records"]:
    extras.append(("EV0110", r))

print("挂靠记载 %d 条（含 EV2049 降级 1 条）" % len(extras))

# ---------------------------------------------------------------- 3. 合并事件

events = []
by_id = {}
for e in ORIG["events"]:
    ev = json.loads(json.dumps(e, ensure_ascii=False), object_pairs_hook=OrderedDict)
    events.append(ev)
    by_id[ev["id"]] = ev
for ev in new_events:
    events.append(ev)
    by_id[ev["id"]] = ev

# 追加挂靠
extra_log = []
for tgt, r in extras:
    ev = by_id.get(tgt)
    if ev is None:
        print("[warn] 挂靠目标不存在", tgt)
        continue
    seq = len(ev["records"]) + 1
    rec = conv_record(r, seq, tgt)
    rec["linked_event"] = tgt
    rec["verdict"] = "纳入"
    rec["type"] = r.get("type") or ev["type"]
    ev["records"].append(rec)
    extra_log.append([tgt, rec["book"], rec["pian"], r.get("quote", "")[:40]])

# 宿主事件统计重算
for ev in events:
    if ev["id"] in [x[0] for x in extra_log]:
        n_new = len([1 for x in extra_log if x[0] == ev["id"]])
        ev["n_records"] = len(ev["records"])
        ev["n_indep"] = int(ev.get("n_indep") or 0) + n_new
        seen = []
        for r in ev["records"]:
            if r["book"] and r["book"] not in seen:
                seen.append(r["book"])
        ev["main_src"] = "、".join(seen)

# 二库事件的 n_records / main_src
for ev in events:
    if ev["id"].startswith("EV2"):
        ev["n_records"] = len(ev["records"])
        seen = []
        for r in ev["records"]:
            if r["book"] and r["book"] not in seen:
                seen.append(r["book"])
        ev["main_src"] = "、".join(seen)

print("事件 %d 条（原库 %d ＋ 二库 %d）" % (len(events), len(ORIG["events"]), len(new_events)))
print("记载 %d 条" % sum(len(e["records"]) for e in events))

# ---------------------------------------------------------------- 4. 排除材料

excluded = []
for r in ORIG["excluded"]:
    excluded.append(json.loads(json.dumps(r, ensure_ascii=False), object_pairs_hook=OrderedDict))

seq = len(excluded)
for r in K2["excluded"]:
    seq += 1
    rec = conv_record(r, seq, "EX")
    rec["type"] = r.get("excl_type", "")
    rec["event_place"] = r.get("place", "")
    rec["verdict"] = "非事件之记载条目"
    rec["_eid"] = "EX%04d" % seq
    rec["seq"] = str(seq)
    key = (rec["book"], rec["pian"], int(r["sent_start"]), rec["person"])
    if key in ANCHOR_FIX:
        target, newtype = ANCHOR_FIX[key]
        fix_span(rec, target)
        rec["quote"] = src_text(rec["file_path"])[rec["sent_start"]:rec["sent_end"]].lstrip("」』】）) ")
        rec["hit_preview"] = rec["quote"].strip("「」『』【】（）()。，、；：！？…")
        if newtype:
            old = rec["excl_type"]
            rec["excl_type"] = newtype
            rec["type"] = newtype
            rec["explain"] = "命取囚扑死阶下，剜其脑及心肝置瓯中和酒，属酷刑毁尸，非割股疗亲，亦非食人；原列割股类，合并时改归。"
            rec["reclass"] = "原二库「%s」，2026-11-03 合并时改归「%s」" % (old, newtype)
            stats["reclass"].append([rec["book"], rec["pian"], rec["person"], old, newtype])
    elif rec["sent_end"] - rec["sent_start"] < 8:
        fix_span(rec)
    excluded.append(rec)

print("排除材料 %d 条（原库 210 ＋ 二库 113）" % len(excluded))

# ---------------------------------------------------------------- 5. 重算 full

for ev in events:
    for r in ev["records"]:
        if not r.get("full"):
            rebuild_full(r, stats)
            stats["full_rewritten"] += 1
for r in excluded:
    if not r.get("full"):
        rebuild_full(r, stats)
        stats["full_rewritten"] += 1
print("按底本重算原文段落 %d 条" % stats["full_rewritten"])

# ---------------------------------------------------------------- 6. 地点

# ---- 用户订正：地点 / 类型 / 人物（2026-11-03）----
for ev in events:
    if ev["id"] in PLACE_OVERRIDES:
        ev["place"] = PLACE_OVERRIDES[ev["id"]]
    if ev["id"] in TYPE_OVERRIDES:
        ev["type"] = TYPE_OVERRIDES[ev["id"]]
        for r in ev["records"]:
            r["type"] = TYPE_OVERRIDES[ev["id"]]
    if ev["id"] in PERSON_OVERRIDES:
        for r in ev["records"]:
            r["person"] = PERSON_OVERRIDES[ev["id"]]

# 原库事件定位表原样保留
EPL = OrderedDict((k, v) for k, v in ORIG_EPL.items())
EPLS = OrderedDict((k, v) for k, v in ORIG_EPLS.items())

GEO_ALL = OrderedDict()
for k, v in ORIG_GEO.items():
    GEO_ALL[k] = v
for k, v in GEO_NEW.items():
    GEO_ALL[k] = [v[0], v[1], v[2], v[3], v[4]]
for k, v in GEO_OVERRIDES.items():
    GEO_ALL[k] = v

LEVEL_REGION = {}
for p in ORIG["place_index"]:
    LEVEL_REGION[p["name"]] = (p["level"], p["region"])
LEVEL_REGION["大都"] = ("州县", "塞北")
for k, v in GEO_NEW.items():
    LEVEL_REGION[k] = (v[6], v[5])
LEVEL_REGION["长安"] = ("州县", "关中")
LEVEL_REGION["三桥"] = ("州县", "关中")
LEVEL_REGION["凉州"] = ("州县", "陇右")

unresolved = []


def resolve_one(place, evid):
    nm = NAME_FIX.get(place)
    if nm is None:
        nm = re.sub(r"[（(][^）)]*[)）]", "", place).strip()
    g = GEO_ALL.get(nm)
    if g is None:
        par = re.search(r"[（(]([^）)]*)[)）]", place)
        if par and par.group(1) in GEO_ALL:
            nm = par.group(1)
            g = GEO_ALL[nm]
    if g is None or g[1] is None:
        unresolved.append((evid, place, nm))
        return [OrderedDict([("n", nm), ("m", ""), ("x", None), ("y", None), ("p", "unknown"), ("note", "未定位")])]
    return [OrderedDict([("n", nm), ("m", g[0]), ("x", g[1]), ("y", g[2]), ("p", g[3]), ("note", g[4])])]


dirty = set(PLACE_OVERRIDES) | set(EV_SPLIT_ADD) | set(GEO_RECOMPUTE)
for ev in events:
    if not (ev["id"].startswith("EV2") or ev["id"] in dirty):
        continue
    place = ev["place"]
    sub = EV_SPLIT_ADD.get(ev["id"]) or (SPLIT.get(place) if ev["id"].startswith("EV2") else None)
    if sub:
        refs = []
        for nm in sub:
            g = GEO_ALL.get(nm)
            if not g or g[1] is None:
                unresolved.append((ev["id"], place, nm))
                continue
            refs.append(OrderedDict([("n", nm), ("m", g[0]), ("x", g[1]), ("y", g[2]), ("p", g[3]), ("note", g[4])]))
        if refs:
            EPLS[ev["id"]] = refs
            EPL[ev["id"]] = refs[:1]
    else:
        EPL[ev["id"]] = resolve_one(place, ev["id"])

if unresolved:
    print("[warn] 未定位：", unresolved)

# 基准名集合
names = []
for ev in events:
    a = EPLS.get(ev["id"]) or EPL.get(ev["id"]) or []
    for r in a:
        if r["n"] not in names:
            names.append(r["n"])

# place_index 重建（名称取实际定位名，与原库 204 条一一对应，另加新地名）
pcount = Counter()
pev = OrderedDict()
pvar = OrderedDict()
for ev in events:
    refs = EPLS.get(ev["id"]) or EPL.get(ev["id"]) or []
    for r in refs:
        pcount[r["n"]] += 1
        pev.setdefault(r["n"], []).append(ev["id"])
        if ev["place"] != r["n"] and ev["place"] not in pvar.setdefault(r["n"], []):
            pvar[r["n"]].append(ev["place"])

place_index = []
for name, cnt in pcount.most_common():
    lv, rg = LEVEL_REGION.get(name, ("", "其他"))
    place_index.append(OrderedDict([
        ("name", name), ("level", lv), ("region", rg), ("count", cnt),
        ("events", pev[name]), ("variants", pvar.get(name, [])),
    ]))

# ---------------------------------------------------------------- 7. 人物

persons = Counter()
pevents = OrderedDict()
prec_count = Counter()
for ev in events:
    seen = []
    for r in ev["records"]:
        p = r.get("person", "")
        if not p or p in PLACEHOLDER_PERSON or p.startswith("无（"):
            continue
        for one in re.split(r"[、，,]", p):
            one = one.strip()
            if not one or one in PLACEHOLDER_PERSON:
                continue
            prec_count[one] += 1
            if one in seen:
                continue
            seen.append(one)
            persons[one] += 1
            pevents.setdefault(one, []).append(ev["id"])
person_index = [OrderedDict([("name", n), ("count", c), ("records", prec_count[n]), ("events", pevents[n])])
                for n, c in persons.most_common()]

# ---------------------------------------------------------------- 8. meta

DYN_ORDER = ORIG["meta"]["dynasty_order"]
TYPE_ORDER = ORIG["meta"]["type_order"]


def dist(seq_, order=None):
    c = Counter(seq_)
    if order:
        out = OrderedDict((k, c[k]) for k in order if c[k])
        for k, v in c.items():
            if k not in out:
                out[k] = v
        return out
    return OrderedDict(c.most_common())


real_rec = sum(len(e["records"]) for e in events)
counts = OrderedDict([
    ("events", len(events)),
    ("nonevents", 0),
    ("excluded", len(excluded)),
    ("records", real_rec),
    ("records_events", real_rec),
    ("records_nonevents", 0),
    ("records_all", real_rec),
    ("places", len(place_index)),
    ("persons", len(person_index)),
    ("books", len({r["book"] for e in events for r in e["records"]})),
])

meta = OrderedDict([
    ("title", "人相食主题总库"),
    ("subtitle", "二十四史（含《清史稿》）人相食相关记载的搜集、整理与考辨"),
    ("source", "二十四史（含《清史稿》）"),
    ("updated", "2026-11-03"),
    ("built", "2026-11-03"),
    ("counts", counts),
    ("dynasty", dist([e["dynasty"] for e in events], DYN_ORDER)),
    ("type", dist([e["type"] for e in events], TYPE_ORDER)),
    ("prec", dist([e["prec"] for e in events])),
    ("century", dist([e["century"] for e in events])),
    ("book", dist([r["book"] for e in events for r in e["records"]])),
    ("excl_type", dist([r["excl_type"] for r in excluded])),
    ("dynasty_order", DYN_ORDER),
    ("type_order", TYPE_ORDER),
])

out = OrderedDict([
    ("meta", meta),
    ("bands", ORIG["bands"]),
    ("scale_pts", ORIG["scale_pts"]),
    ("type_colors", ORIG["type_colors"]),
    ("events", events),
    ("nonevents", []),
    ("excluded", excluded),
    ("place_index", place_index),
    ("person_index", person_index),
    ("place_audit", ORIG["place_audit"]),
])

# 清理内部字段
for ev in events:
    ev.pop("_key", None)
    for r in ev["records"]:
        r.pop("_who", None)
for r in excluded:
    r.pop("_who", None)

with open(OUT_DB, "w", encoding="utf-8", newline="\n") as f:
    f.write("window.DB=" + json.dumps(out, ensure_ascii=False, separators=(",", ":")) + ";\n")

# places.js
geo_out = OrderedDict()
for n in pcount:
    g = GEO_ALL.get(n)
    if g is None:
        geo_out[n] = ["", None, None, "unknown", "未定位"]
    else:
        geo_out[n] = g

js = ("window.PLACE_GEO=" + json.dumps(geo_out, ensure_ascii=False, separators=(",", ":")) + ";\n"
      + "window.EVENT_PLACE=" + json.dumps(EPL, ensure_ascii=False, separators=(",", ":")) + ";\n"
      + "window.EVENT_PLACES=" + json.dumps(EPLS, ensure_ascii=False, separators=(",", ":")) + ";\n")
with open(OUT_PLACES, "w", encoding="utf-8", newline="\n") as f:
    f.write(js)

report = OrderedDict([
    ("built", "2026-11-03"),
    ("counts", counts),
    ("dropped_events", dropped),
    ("extras", extra_log),
    ("span_fixed", stats["span_fixed"]),
    ("reclass", stats["reclass"]),
    ("full_rewritten", stats["full_rewritten"]),
    ("full_unaligned", stats["full_unaligned"]),
    ("new_places", list(GEO_NEW.keys())),
    ("split_events", SPLIT),
    ("place_index", len(place_index)),
    ("person_index", len(person_index)),
])
with open(REPORT, "w", encoding="utf-8", newline="\n") as f:
    json.dump(report, f, ensure_ascii=False, indent=1)

print("---")
print("事件 %d / 记载 %d / 排除 %d / 地点 %d / 人物 %d / 史书 %d" % (
    counts["events"], counts["records"], counts["excluded"], counts["places"], counts["persons"], counts["books"]))
print("data.js %.2f MB, places.js %.1f KB" % (
    os.path.getsize(OUT_DB) / 1048576, os.path.getsize(OUT_PLACES) / 1024))
print("未对齐 %d 条，句位修订 %d 条，改判 %d 条" % (
    len(stats["full_unaligned"]), len(stats["span_fixed"]), len(stats["reclass"])))
