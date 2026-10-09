"""【已执行完毕的一次性修补脚本 —— 不要重跑】

⚠️ 2026-10-10 警告(XX-AUDIT-021):
   本脚本的 s4() **缺幂等判断**(其它四步都有 `if ... return '已存在'`),
   重跑会**重复插入**同一段 HTML。
   实测复现:2026-10-10 误跑一次,ui.js:1561 被插入了第二份「还需 N 道行」提示
   (已 git checkout 还原)。

   补丁**已全部落地**(跑一次 5/5 显示「已存在」),
   其断言已由 tests/lint-hints.mjs 接管为**会红的门禁**。

   所以:本脚本现在只是**历史记录**,不再是可执行工具。
   要改那 5 处提示,请直接改源码,别跑这个。

原说明:门禁提示:把「点了才弹的失败 toast」改成「旁边就写着还差多少」。

依据 REACH-AUDIT.md:
  招族人 需财力 500,但财力只能靠守家攒 → 玩家不知道差多少
  缔同盟 需道行 800,约 1300 杀        → 按钮按不动,不知道还差多少

原则:不新增任何玩法逻辑,只把已有门禁条件前置成可见文本。
用法: python3 apply_hints.py [--write]
"""
import io, os, sys, re

ROOT = os.getcwd().rstrip('/') + '/'
WRITE = '--write' in sys.argv

OK, FAIL = [], []
def step(n, fn):
    try:
        r = fn(); OK.append(n); print(f'  ✅ {n}' + (f' — {r}' if r else ''))
    except Exception as e:
        FAIL.append(f'{n}: {e}'); print(f'  ❌ {n}\n      {type(e).__name__}: {e}')

def rd(p): return io.open(ROOT + p, encoding='utf-8').read()
def wr(p, s): io.open(ROOT + p, 'w', encoding='utf-8').write(s)


# ===== 1. family.js: 暴露缺口数值(只读,不改门禁逻辑)=====
def s1():
    p = 'js/xiuxian/family.js'
    s = rd(p)
    if 'raiseGap()' in s: return '已存在'
    a = """  canRaise() {
    const cap = this._cap || 40;"""
    assert a in s, 'canRaise 锚点未匹配'
    b = """  // V0.99:招人缺口 —— 只读,不参与判定。
  // 目的是让玩家在按钮旁边就看见「还差多少」,而不是点了才知道。
  raiseGap() {
    const cap = this._cap || 40;
    const room = cap - this.s.members.length;
    const lack = Math.max(0, 500 - this.s.wealth);
    return { room, lack, full: room <= 0, ok: room > 0 && lack === 0 };
  },
  canRaise() {
    const cap = this._cap || 40;"""
    wr(p, s.replace(a, b, 1))
    return 'raiseGap() 已加'

step('1. family.js 加 raiseGap', s1)


# ===== 2. build.js: 同盟缺口 =====
def s2():
    p = 'js/xiuxian/build.js'
    s = rd(p)
    if 'pactGap()' in s: return '已存在'
    a = "  signPact(name) {"
    assert a in s, 'signPact 锚点未匹配'
    b = """  // V0.99:缔约缺口 —— 只读,不参与判定。
  pactGap() {
    const cost = 800 + this.s.pacts.signed * 600;
    const lack = Math.max(0, cost - Cult.get().dao);
    return { cost, lack, full: !this.canPact(), ok: this.canPact() && lack === 0 };
  },
  signPact(name) {"""
    wr(p, s.replace(a, b, 1))
    return 'pactGap() 已加'

step('2. build.js 加 pactGap', s2)


# ===== 3. ui.js: 招人按钮旁写缺口 =====
def s3():
    p = 'js/xiuxian/ui.js'
    s = rd(p)
    if '还需' in s: return '已存在'
    old = """        <div class="xx-grid3">
          ${FAMILY.RAISED.map(k=>`<button class="xx-btn" style="margin:0;padding:10px;font-size:12px;letter-spacing:1px"
            data-act="raise" data-v="${k.key}">${k.name}</button>`).join('')}
        </div>"""
    assert old in s, '招人按钮区块未匹配'
    g = "${(()=>{const _g=FAMILY.raiseGap();return _g.ok?'<div class=\"xx-hintok\">资财已足,可招</div>'"
    g += ":(_g.full?'<div class=\"xx-hint\">族人已满 · 议事堂可扩容</div>'"
    g += ":`<div class=\"xx-hint\">还需 <b>${_g.lack}</b> 资产</div>`);})()}"
    new = old.replace('</div>', '</div>\n        ' + g, 1)
    wr(p, s.replace(old, new, 1))
    return '招人缺口提示已加'

step('3. ui.js 招人提示', s3)


# ===== 4. ui.js: 同盟按钮旁写缺口 =====
def s4():
    p = 'js/xiuxian/ui.js'
    s = rd(p)
    a = """        <button class="xx-btn" data-act="pact" ${BUILD.canPact()?'':'disabled'}>缔 结 同 盟</button>"""
    if a not in s:
        m = re.search(r'<button class="xx-btn" data-act="pact"[^>]*>缔 结 同 盟</button>', s)
        assert m, '同盟按钮未匹配'
        a = m.group(0)
    g = "${(()=>{const _g=BUILD.pactGap();return _g.full?'<div class=\"xx-hint\">契约已满(3/3)</div>'"
    g += ":(_g.ok?'<div class=\"xx-hintok\">道行已足,可缔约</div>'"
    g += ":`<div class=\"xx-hint\">还需 <b>${_g.lack}</b> 道行(需 ${_g.cost})</div>`);})()}"
    new = a + '\n        ' + g
    wr(p, s.replace(a, new, 1))
    return '同盟缺口提示已加'

step('4. ui.js 同盟提示', s4)


# ===== 5. CSS: 提示样式 =====
def s5():
    p = 'css/xiuxian.css'
    s = rd(p)
    if '.xx-hint' in s: return '已存在'
    css = """

/* ===== 门禁提示(V0.99)=====
   「还差多少」直接写出来,玩家不必点了才知道。
   这不是新功能,是把已有门禁条件前置显示。 */
.xx-hint {
  margin-top: 7px; font-size: 12px; letter-spacing: .5px;
  color: var(--xx-paper-faint);
}
.xx-hint b {
  color: var(--xx-gold); font-weight: 400;
  font-size: 14px; padding: 0 2px;
}
.xx-hintok {
  margin-top: 7px; font-size: 12px; letter-spacing: .5px;
  color: var(--xx-jade);
}
"""
    io.open(ROOT + p, 'a', encoding='utf-8').write(css)
    return '提示样式已加'

step('5. xiuxian.css 提示样式', s5)


print()
print(f'{"已写入" if WRITE else "dry-run"}：成功 {len(OK)} / 失败 {len(FAIL)}')
if FAIL:
    print('失败项:')
    for f in FAIL: print('  -', f)
    sys.exit(1)