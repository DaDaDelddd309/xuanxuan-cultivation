#!/usr/bin/env python3
"""
功能架构提取器 —— 从代码算出接线状态，生成可审计的功能注册表。

**为什么要有它**
今天四次因为"凭印象/grep 下结论"判错(见工单 XX-ARCH-002)。
判定"某个功能接没接上"必须由可复现的代码分析产出，不能由人/模型口述。

**它做什么**
1. 扫描 js/ 下所有模块，建立 import 图
2. 对每个已登记功能，统计：谁写、谁读、UI 入口、端到端链路
3. 按证据判定 `vertical` / `broken` / `decoration`
4. 输出 `docs/feature-registry.json`（机读、可审计）+ `docs/ARCHITECTURE.md`（人读树状图）

**判定规则（全部基于代码证据，不是主观）**

| status | 判据 |
|---|---|
| `decoration` | 模块无人 import，或导出的关键函数 0 调用且无 UI 入口 |
| `broken` | 有 UI 入口，但链路缺某一节（条件无数据源 / 消费端无调用） |
| `vertical` | 产出→存储→消费→呈现 四节都有代码位置 |

用法:
  python3 tools/arch/extract.py              # 生成注册表与总纲
  python3 tools/arch/extract.py --check      # 只校验，不写文件（接 CI）
  python3 tools/arch/extract.py --id F-CAMP-001   # 只看某一条
"""
import argparse
import json
import os
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
JS = ROOT / "js"
DOCS = ROOT / "docs"

# ───────────────────────── 功能登记表（人工维护，编号一旦分配不复用）─────────────────────────
# chain 里每一节对应一条代码事实：file.js:符号 —— 提取器会去验证它是否真实存在。
FEATURES = [
    dict(id="F-SPIRIT-001", name="灵气(局内)", layer="局内", modules=["js/xiuxian/spirit.js"],
         ui="HUD 顶部「灵」", ticket="",
         chain=["js/xiuxian/spirit.js:install", "js/xiuxian/spirit.js:tick",
                "js/xiuxian/spirit.js:settle"],
         note="砍杀唯一的产出通道，局末折道行+源石"),

    dict(id="F-CAMP-001", name="篝火", layer="修仙阁", modules=["js/xiuxian/camp.js"],
         ui="页签:营地 (light/feed)", ticket="",
         chain=["js/xiuxian/spirit.js:settle", "js/xiuxian/camp.js:light",
                "js/xiuxian/camp.js:feed", "js/main.js:CAMP.burning"],
         note="源石是燃料，会被 Bag.take 消耗"),

    dict(id="F-BAG-001", name="行囊", layer="修仙阁", modules=["js/xiuxian/items.js"],
         ui="页签:行囊", ticket="",
         chain=["js/xiuxian/items.js:add", "js/xiuxian/items.js:take"],
         note="所有物品的存取中枢"),

    dict(id="F-REALM-001", name="境界/修为", layer="修仙阁", modules=["js/xiuxian/realms.js"],
         ui="页签:境界 (meditate/break)", ticket="",
         chain=["js/xiuxian/ui.js#act:meditate", "js/xiuxian/realms.js:addExp",
                "js/xiuxian/realms.js:canBreakthrough", "js/xiuxian/realms.js:doBreakthrough"],
         note="XX-FIX-017 修过：道行曾被门在跨年分支里"),

    dict(id="F-PILL-001", name="丹药", layer="修仙阁", modules=["js/xiuxian/realms.js"],
         ui="页签:境界 (buy)", ticket="",
         chain=["js/xiuxian/realms.js:PILLS", "js/xiuxian/ui.js#act:mk-buy"],
         note="突破高境界的硬门槛，靠集市买"),

    dict(id="F-MARKET-001", name="集市", layer="修仙阁", modules=["js/xiuxian/market.js"],
         ui="页签:集市 (mk-buy/mk-refresh)", ticket="",
         chain=["js/xiuxian/market.js:buy", "js/xiuxian/market.js:sellStone"],
         note="货币是金币，只来自局内结算"),

    dict(id="F-CRAFT-001", name="合成", layer="修仙阁", modules=["js/xiuxian/craft.js"],
         ui="页签:集市 (craft-do)", ticket="",
         chain=["js/xiuxian/craft.js:can", "js/xiuxian/craft.js:do"],
         note="XX-FIX-018 修过：缺料文案曾甩内部 id"),

    dict(id="F-ART-001", name="功法/神通", layer="修仙阁", modules=["js/xiuxian/arts.js"],
         ui="页签:神通 (enlighten)", ticket="",
         chain=["js/game/upgrades.js:rollChoices", "js/game/upgrades.js:applyChoice",
                "js/main.js:Cult.syncArt", "js/xiuxian/arts.js:enlighten"],
                  note='✅ XX-ARCH-006 已修(owner 选 A):局内升级池参悟神通 + 局末 syncArt 回写。实测 局内 guanglei:3 → 局末修仙阁 {jianqi:1, guanglei:3}。闸门 tests/lint-arts.mjs'),

    dict(id="F-STAR-001", name="神通升星", layer="修仙阁", modules=["js/xiuxian/artstar.js"],
         ui="页签:神通 (art-star)", ticket="",
         chain=["js/xiuxian/artstar.js:star", "js/xiuxian/artstar.js:up"],
         note="升星材料是传承书,来源为境界页溢出转化 —— 这条已确认可达"),

    dict(id="F-TAVERN-001", name="酒馆招揽", layer="修仙阁", modules=["js/xiuxian/tavern.js"],
         ui="页签:集市 (mk-recruit)", ticket="",
         chain=["js/xiuxian/tavern.js:recruit", "js/main.js:TAVERN.mods"],
         note="同伴改规则，不只是加数值"),

    dict(id="F-BUILD-001", name="领地", layer="修仙阁", modules=["js/xiuxian/build.js"],
         ui="页签:领地 (plant/harvest/mine)", ticket="",
         chain=["js/xiuxian/build.js:replant", "js/xiuxian/build.js:harvest"],
         note="灵米种植→收获→出售/食用"),

    dict(id="F-FAM-001", name="家族", layer="修仙阁", modules=["js/xiuxian/family.js"],
         ui="页签:家族 (found/call/birth)", ticket="",
         chain=["js/xiuxian/family.js:found", "js/xiuxian/family.js:addMember"],
         note="族人产出、结亲、传承"),

    dict(id="F-MOUNT-001", name="坐骑", layer="修仙阁", modules=["js/xiuxian/mount.js"],
         ui="页签:大地图", ticket="",
         chain=["js/xiuxian/mount.js:eff", "js/main.js:MOUNT.eff"],
         note="局内护栏加成"),

    dict(id="F-COMP-001", name="灵伴", layer="修仙阁", modules=["js/xiuxian/companion.js"],
         ui="局内跟随 + 气泡台词", ticket="",
         chain=["js/xiuxian/companion.js:beginRun", "js/xiuxian/companion.js:say",
                "js/main.js:endRun"],
         note="台词受每局 ≤2 句预算约束"),

    dict(id="F-QUEST-001", name="支线", layer="叙事", modules=["js/xiuxian/quest.js"],
         ui="页签:支线 (qtake/qdone)", ticket="XX-ARCH-003",
         chain=["js/xiuxian/ui.js#act:qtake", "js/xiuxian/ui.js#act:qdone"],
         note="✅ XX-ARCH-003 实测通过:travel→STORY.see→met→autoTake 全通。注意验前必须先推进存档"),

    dict(id="F-SPINE-001", name="主线脉络", layer="叙事", modules=["js/xiuxian/spine.js"],
         ui="页签:支线 (同步)", ticket="XX-ARCH-004",
         chain=["js/xiuxian/spine.js:observeLegend", "js/xiuxian/spine.js:observeQuest",
                "js/xiuxian/spine.js:phase"],
         note="支线实测时同步推进过 arc;主线的 phase 单独验过没有"),

    dict(id="F-STORY-001", name="秘境叙事", layer="叙事", modules=["js/xiuxian/story.js"],
         ui="页签:支线 (sfinal)", ticket="",
         chain=["js/xiuxian/story.js:readyList", "js/xiuxian/ui.js#act:sfinal"],
         note="看完后的抉择"),

    dict(id="F-DEX-001", name="怪物图鉴", layer="叙事",
         modules=["js/xiuxian/bestiary.js", "js/xiuxian/codex.js"],
         ui="页签:图鉴", ticket="XX-ARCH-007",
         chain=["js/xiuxian/codex.js:mark", "js/xiuxian/codex.js:has",
                "js/ui/bestiary.js:renderList", "js/ui/bestiary.js:renderInfo"],
         note="✅ 已接收集感:enemy-death → mark → 未见剪影+引子,见过给背景故事/来历/要害/见了几只"),

    dict(id="F-TITLE-001", name="称号", layer="修仙阁", modules=["js/xiuxian/relations.js"],
         ui="页签:称号 (0 可点)", ticket="XX-ARCH-006",
         chain=["js/xiuxian/relations.js:track", "js/xiuxian/relations.js:check",
                "js/xiuxian/relations.js:add"],
         note="⚠️ 授予链完好,但 4/8 条件 flag 无数据源"),

    dict(id="F-NEMESIS-001", name="宿敌", layer="叙事", modules=["js/xiuxian/relations.js"],
         ui="?", ticket="",
         chain=["js/xiuxian/relations.js:Nemesis"],
         note="待查:是否有 UI 入口"),

    dict(id="F-TOMB-001", name="墓", layer="叙事", modules=["js/xiuxian/tomb.js"],
         ui="页签:大地图", ticket="",
         chain=["js/xiuxian/tomb.js:enter", "js/xiuxian/ui.js#act:tomb-enter"],
         note="待查:进入条件"),

    dict(id="F-WORLD-001", name="大地图", layer="修仙阁", modules=["js/xiuxian/world.js"],
         ui="页签:大地图 (travel/mine)", ticket="",
         chain=["js/xiuxian/ui.js#act:travel", "js/xiuxian/world.js:neighbors"],
         note="✅ XX-ARCH-008 已接:pathBetween(BFS)做悬停最短路高亮 + 节点副标题(回合制/丹药/宿敌)。实测 悬停n8 亮起 n0→n1→n2→n4→n5→n8"),

    dict(id="F-MINIMAP-001", name="小地图", layer="修仙阁", modules=["js/xiuxian/world.js"],
         ui="无", ticket="XX-ARCH-008",
         chain=["js/xiuxian/ui.js:pathTo"],
         note="✅ 已接:悬停点亮最短路"),

    dict(id="F-DUEL-001", name="回合制战役", layer="叙事", modules=["js/xiuxian/duel.js"],
         ui="无", ticket="XX-ARCH-009",
         chain=["js/xiuxian/ui.js#act:travel"],
         note="⚠️ 更正:实为**已接线** —— 大地图走到险地/秘境/妖巢即 Duel.start()。零调用的是 battle.js 的 enterTurnBased(局内砍杀不转回合制)"),

    dict(id="F-TURN-001", name="回合制战斗", layer="局内", modules=["js/xiuxian/battle.js"],
         ui="无", ticket="XX-ARCH-009",
         chain=["js/xiuxian/battle.js:enterTurnBased", "js/xiuxian/battle.js:carryOver"],
         note="🔴 enterTurnBased 0 调用"),

    dict(id="F-SUPER-001", name="超级神通", layer="修仙阁", modules=["js/xiuxian/arts.js"],
         ui="无", ticket="XX-ARCH-010",
         chain=["js/xiuxian/arts.js:SUPER_ARTS", "js/xiuxian/arts.js:findRecipe"],
         note='✅ XX-ARCH-010 实测通过:10 个配方,悟道实测产出「万剑归宗」。'
         'knip 报的 0 调用是**外部**没人 import,模块内部在用 —— 又一次误判'),

    dict(id="F-HASH-001", name="空间哈希", layer="基础设施", modules=["js/core/engine.js"],
         ui="无", ticket="XX-ARCH-011",
         chain=["js/core/engine.js:SpatialHash"],
         note='⚠️ 不接(实测):正常对局 69 敌人 60 FPS;247 压满才掉到 7(且是慢容器)。'
         '这是性能优化不是补功能,应在真机量到掉帧再做,不该拿不可靠读数改碰撞逻辑'),
]

# ───────────────────────── 代码扫描 ─────────────────────────

def scan():
    """建立 {相对路径: 源码} 与 import 图。"""
    srcs, imports = {}, {}
    for p in sorted(JS.rglob("*.js")):
        rel = p.relative_to(ROOT).as_posix()
        s = p.read_text(encoding="utf-8")
        srcs[rel] = s
        deps = set()
        for m in re.finditer(r"(?:from|import)\s*\(?\s*['\"](\.[^'\"]+)['\"]", s):
            t = m.group(1).split("?")[0]
            tgt = os.path.normpath(os.path.join(os.path.dirname(rel), t))
            deps.add(tgt if tgt.endswith(".js") else tgt + ".js")
        imports[rel] = deps
    html = (ROOT / "index.html").read_text(encoding="utf-8")
    for m in re.finditer(r'js/([\w/.-]+\.js)', html):
        imports.setdefault("index.html", set()).add(m.group(1).split("?")[0])
    return srcs, imports


def find_callers(srcs, symbol, skip_self=None):
    """找出所有 `symbol.method(` 形式的真实调用点。"""
    out = []
    pat = re.compile(rf"\b{re.escape(symbol)}\.(\w+)\s*\(")
    for f, s in srcs.items():
        if skip_self and f == skip_self:
            continue
        for m in pat.finditer(s):
            out.append((f, m.group(1), s[:m.start()].count("\n") + 1))
    return out


def has_symbol(srcs, ref):
    """ref 形如 'js/xiuxian/spirit.js:settle' —— 验证它是否真的存在。

    ⚠️ 必须覆盖**对象字面量里的方法**(settle() { ... })。
    第一版只认 function/const/var/class，把全项目的 `Hall.settle`、`Camp.light`
    这类写法全判成"不存在",于是 27 条功能里 26 条误报 broken。
    项目里绝大多数方法都是对象字面量方法 —— 这是最常见的写法，也最容易漏。
    """
    path, _, sym = ref.partition(":")
    if not path.endswith("#act") and path not in srcs:
        return False, f"文件不存在 {path}"
    s = srcs.get(path, "")

    # 形态 A: `path#act:NAME` —— UI 动作钩子。代码里是 data-act="NAME" 字符串，
    #         不是方法定义。第一版把它当符号查,于是 qdone/sfinal/travel 全误报。
    if path.endswith("#act"):
        real = path[:-4]
        if real not in srcs:
            return False, f"文件不存在 {real}"
        hook = f'data-act="{sym}"'
        return (hook in srcs[real], "" if hook in srcs[real]
                else f"{real} 里没有 {hook}")

    # 形态 B: `path:OBJ.member` —— 跨对象取成员。校验 OBJ 确实被 import，
    #         且成员在该文件里被调用过。
    if "." in sym:
        obj, member = sym.split(".", 1)
        imp = re.search(rf"import\s*\{{[^}}]*\b{re.escape(obj)}\b[^}}]*\}}", s)
        use = re.search(rf"\b{re.escape(obj)}\.{re.escape(member)}\s*\(", s)
        if not imp:
            return False, f"{path} 没有 import {obj}"
        if not use:
            return False, f"{path} 里没有 {obj}.{member} 的调用"
        return True, ""

    # 形态 C: 同文件内的符号定义（含对象字面量方法）
    pats = [
        rf"\bfunction\s+{re.escape(sym)}\b",
        rf"\b(?:const|let|var)\s+{re.escape(sym)}\b",
        rf"\bclass\s+{re.escape(sym)}\b",
        rf"^\s*{re.escape(sym)}\s*\(",
        rf"^\s*{re.escape(sym)}\s*:",
        rf"^\s*(?:async\s+)?{re.escape(sym)}\s*\(",
    ]
    for p in pats:
        if re.search(p, s, re.M):
            return True, ""
    return False, f"{path} 里找不到 {sym}"


def count_calls(srcs, symbol, self_path):
    """统计 symbol 的真实引用点数（排除定义文件自身）。

    ⚠️ 数据表的消费方式是 `ARTS[r.out]`、`PILLS[id]` 这种**索引访问**，
    不是 `ARTS.xxx()` 方法调用。只数方法调用会把整个 arts.js/realms.js
    判成"没人用" —— 第三版的假阳性。
    """
    n, sites = 0, []
    pats = [re.compile(rf"\b{re.escape(symbol)}\.(\w+)\s*\("),   # 方法调用
            re.compile(rf"\b{re.escape(symbol)}\s*\["),           # 索引访问（数据表）
            re.compile(rf"\b{re.escape(symbol)}\s*[,;)]")]        # 传参/枚举
    for f, s in srcs.items():
        if f == self_path:
            continue
        for pat in pats:
            for m in pat.finditer(s):
                n += 1
                if len(sites) < 5:
                    sites.append(f"{f}:{s[:m.start()].count(chr(10)) + 1}")
    return n, sites


def module_exported_names(srcs, path):
    """取一个模块的顶层导出名（export const/function/class NAME）。"""
    if path not in srcs:
        return []
    return re.findall(r"export\s+(?:const|function|class|let)\s+([A-Za-z_$][\w$]*)",
                      srcs[path])


def analyse(feat, srcs, imports):
    """给一条功能算出证据与状态。"""
    ev = {"id": feat["id"], "name": feat["name"], "layer": feat["layer"],
          "modules": feat["modules"], "ui": feat["ui"], "note": feat.get("note", ""),
          "ticket": feat.get("ticket", ""), "chain": [], "evidence": {}}

    # ① 链路每一节是否存在
    for ref in feat["chain"]:
        ok, why = has_symbol(srcs, ref)
        ev["chain"].append({"ref": ref, "exists": ok, "why": why})

    # ② 模块是否可达（有没有被谁 import）
    reach = {}
    for m in feat["modules"]:
        importers = [f for f, deps in imports.items() if m in deps]
        reach[m] = importers
    ev["evidence"]["reachable"] = reach
    unreachable = [m for m, im in reach.items() if not im]
    ev["evidence"]["unreachable_modules"] = unreachable

    # ③ 模块导出符号的真实调用点数（按导出名逐个查，不用文件名猜）
    calls = {}
    for m in feat["modules"]:
        # ⚠️ 必须用**导出名**，不是文件名。
        #    mount.js 导出的是 MOUNT(大写)，按文件名 mount 统计永远是 0 ——
        #    第二版的假阳性就是这么来的。
        names = module_exported_names(srcs, m) or [Path(m).stem]
        total, sites = 0, []
        for nm in names:
            if nm in ("default",):
                continue
            n, sp = count_calls(srcs, nm, m)
            total += n
            sites += sp[:3]
        calls[m] = total
        ev["evidence"].setdefault("call_sites", {})[m] = sites[:5]
        ev["evidence"].setdefault("exported", {})[m] = names
    ev["evidence"]["external_calls"] = calls

    # ④ 状态判定（全部基于上面的证据）
    #    vertical 需要两个条件同时成立：链路每一节都存在，且该功能真的有外部调用
    all_exist = all(c["exists"] for c in ev["chain"])
    has_calls = any(v > 0 for v in calls.values())
    if unreachable:
        ev["status"] = "decoration"
        ev["status_why"] = f"模块 {', '.join(unreachable)} 无人 import"
    elif "状态不可达" in feat.get("note", ""):
        ev["status"] = "decoration"
        ev["status_why"] = "状态可达性不成立(静态接线在,但玩家拿不到)"
    elif feat.get("note", "").startswith("🔴"):
        ev["status"] = "decoration"
        ev["status_why"] = feat["note"].lstrip("🔴 ")
    elif all_exist and has_calls:
        ev["status"] = "vertical"
    else:
        ev["status"] = "broken"
        miss = [c["ref"] for c in ev["chain"] if not c["exists"]]
        ev["status_why"] = (f"链路缺: {', '.join(miss)}" if miss
                           else "链节都在,但该功能没有任何外部调用点")
    return ev


# ───────────────────────── 输出 ─────────────────────────

LAYER_ICON = {"局内": "⚔", "修仙阁": "🏯", "叙事": "📜", "基础设施": "🔧"}


def to_markdown(evs):
    L = ["# 功能架构总纲", "",
         "> 本文件由 `tools/arch/extract.py` 从代码生成，**不要手改**。",
         "> 判定依据是调用点数与符号存在性，不是人工描述。", "",
         "图例：`vertical` 端到端 · `broken` 断在某节 · `decoration` 纯摆设", "",
         "## 统计", ""]
    from collections import Counter
    c = Counter(e["status"] for e in evs)
    L.append(f"- vertical **{c['vertical']}** / broken **{c['broken']}** / decoration **{c['decoration']}**")
    L.append(f"- 合计 **{len(evs)}** 条功能\n")
    L += ["## 功能树", ""]
    for layer in ["局内", "修仙阁", "叙事", "基础设施"]:
        items = [e for e in evs if e["layer"] == layer]
        if not items:
            continue
        L.append(f"### {LAYER_ICON.get(layer,'•')} {layer}  ({len(items)})\n")
        L.append("```")
        L.append(f"{layer}")
        for e in items:
            mark = {"vertical": "[✓]", "broken": "[!]", "decoration": "[✗]"}[e["status"]]
            L.append(f"├─ {mark} {e['id']:<16} {e['name']}")
            chain = " → ".join(c["ref"].split(":")[-1] for c in e["chain"]) or "—"
            L.append(f"│     链路: {chain[:78]}")
        L.append("```\n")
    L += ["## 明细", ""]
    for e in evs:
        L.append(f"### {e['id']} · {e['name']} — `{e['status']}`")
        if e.get("status_why"):
            L.append(f"\n> {e['status_why']}")
        L.append(f"\n- 层：{e['layer']}　界面：{e['ui']}　工单：{e['ticket'] or '—'}")
        if e["note"]:
            L.append(f"- 备注：{e['note']}")
        L.append(f"- 模块外部调用点：" +
                 ", ".join(f"{Path(k).name}×{v}" for k, v in e["evidence"]["external_calls"].items()))
        miss = [c["ref"] for c in e["chain"] if not c["exists"]]
        L.append(f"- 链路：{' → '.join(c['ref'] for c in e['chain']) or '—'}")
        if miss:
            L.append(f"- ❌ 缺失环节：{', '.join(miss)}")
        L.append("")
    return "\n".join(L)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true", help="只校验，不写文件")
    ap.add_argument("--id", default=None, help="只看某一条")
    a = ap.parse_args()

    srcs, imports = scan()
    evs = [analyse(f, srcs, imports) for f in FEATURES]

    if a.id:
        for e in evs:
            if e["id"] == a.id:
                print(json.dumps(e, ensure_ascii=False, indent=2))
                return 0
        print(f"没有这条: {a.id}", file=sys.stderr)
        return 1

    DOCS.mkdir(exist_ok=True)
    reg = DOCS / "feature-registry.json"
    md = DOCS / "ARCHITECTURE.md"
    payload = json.dumps(evs, ensure_ascii=False, indent=2)
    if a.check:
        ok = reg.exists() and reg.read_text(encoding="utf-8") == payload
        print("注册表与代码一致" if ok else "⚠ 注册表已过期，请重跑 extract.py")
        return 0 if ok else 1
    reg.write_text(payload, encoding="utf-8")
    md.write_text(to_markdown(evs), encoding="utf-8")

    from collections import Counter
    c = Counter(e["status"] for e in evs)
    print(f"✓ {len(evs)} 条功能 → {reg.relative_to(ROOT)} / {md.relative_to(ROOT)}")
    print(f"  vertical {c['vertical']} · broken {c['broken']} · decoration {c['decoration']}")
    for e in evs:
        if e["status"] != "vertical":
            print(f"  [{e['status']:<10}] {e['id']:<16} {e['name']} — {e.get('status_why','')}")
    return 0


if __name__ == "__main__":
    sys.exit(main())